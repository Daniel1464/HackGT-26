"""Single-user demo. Run from server/ with uvicorn main:app --port 6767."""
import asyncio
import base64
import hashlib
import json
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from urllib.parse import urlencode

import httpx
from fastapi import Depends, FastAPI, HTTPException, Path, Request, Response
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator

from config import Settings
from database import Database
from social import ProviderError, Social

Provider = Literal["x", "instagram"]
Slot = Annotated[int, Path(ge=0, le=1)]
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


class Medicine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int = Field(strict=True, ge=0, le=1)
    name: str = Field(min_length=1, max_length=80)
    time_to_take: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")

    @field_validator("name")
    @classmethod
    def valid_name(cls, value):
        value = value.strip()
        if not value or any(ord(char) < 32 for char in value):
            raise ValueError("Name must be non-empty text without control characters.")
        return value


class Notification(BaseModel):
    model_config = ConfigDict(extra="forbid")
    providers: list[Provider] | None = Field(default=None, min_length=1, max_length=2)
    image_url: HttpUrl | None = None
    dose_index: int | None = Field(default=None, strict=True, ge=0)


class ScheduledDose(BaseModel):
    model_config = ConfigDict(extra="forbid")
    time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d UTC$")
    dose: int = Field(strict=True, ge=1, le=2147483647)


class MedicineSchedule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int = Field(strict=True, ge=0, le=1)
    medicine: str = Field(min_length=1, max_length=80)
    data: list[ScheduledDose] = Field(min_length=1, max_length=32)

    @field_validator("medicine")
    @classmethod
    def valid_name(cls, value):
        return Medicine.valid_name(value)


class Assignment(BaseModel):
    assigned: bool


def create_app(settings=None, transport=None):
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app):
        app.state.db = Database(settings.database)
        async with httpx.AsyncClient(timeout=20, transport=transport) as http:
            app.state.social = Social(settings, app.state.db, http)
            app.state.publish_lock = asyncio.Lock()
            yield

    app = FastAPI(title="Medication social demo", lifespan=lifespan)

    def authorized(key: str | None = Depends(api_key_header)):
        if not settings.api_key:
            raise HTTPException(503, "Set API_KEY in server/.env before using the demo.")
        if not key or not secrets.compare_digest(key, settings.api_key):
            raise HTTPException(401, "Invalid X-API-Key.")

    protected = [Depends(authorized)]

    def serialize_medicine(row):
        result = dict(row)
        schedule = result.pop("schedule")
        if schedule is not None:
            result.update(data=json.loads(schedule), timezone="UTC")
        return result

    def medicine(slot):
        with app.state.db.connect() as db:
            row = db.execute("SELECT * FROM medicines WHERE id=?", (slot,)).fetchone()
        if row is None:
            raise HTTPException(404, "Medicine slot is empty.")
        return serialize_medicine(row)

    @app.get("/")
    def root():
        return {"message": "Medication demo API", "docs": "/docs"}

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/medicines", dependencies=protected)
    def list_medicines():
        with app.state.db.connect() as db:
            rows = db.execute("SELECT * FROM medicines ORDER BY id").fetchall()
        return {"medicines": [serialize_medicine(row) for row in rows], "timezone": settings.timezone}

    @app.get("/medicines/{medicine_id}", dependencies=protected)
    def get_medicine(medicine_id: Slot):
        return medicine(medicine_id)

    @app.post("/medicines", status_code=201, dependencies=protected)
    def add_medicine(value: Medicine):
        try:
            with app.state.db.connect() as db:
                db.execute("INSERT INTO medicines(id,name,time_to_take) VALUES(?,?,?)", (value.id, value.name, value.time_to_take))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Slot already contains a medicine. Use PUT to update it.")
        return value

    @app.put("/medicines/{medicine_id}", dependencies=protected)
    def update_medicine(medicine_id: Slot, value: Medicine):
        if value.id != medicine_id:
            raise HTTPException(422, "Body id must match the URL id.")
        with app.state.db.connect() as db:
            db.execute("""INSERT INTO medicines(id,name,time_to_take) VALUES(?,?,?) ON CONFLICT(id)
                DO UPDATE SET name=excluded.name,time_to_take=excluded.time_to_take,schedule=NULL""",
                (value.id, value.name, value.time_to_take))
        return value

    @app.put("/medicines/{medicine_id}/schedule", dependencies=protected)
    def sync_schedule(medicine_id: Slot, value: MedicineSchedule):
        if value.id != medicine_id:
            raise HTTPException(422, "Body id must match the URL id.")
        with app.state.db.connect() as db:
            db.execute("""INSERT INTO medicines(id,name,time_to_take,schedule) VALUES(?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET name=excluded.name,
                time_to_take=excluded.time_to_take,schedule=excluded.schedule""",
                (value.id, value.medicine, value.data[0].time[:5],
                 json.dumps([entry.model_dump() for entry in value.data])))
        return {"success": True, **value.model_dump()}

    @app.delete("/medicines/{medicine_id}", status_code=204, dependencies=protected)
    def remove_medicine(medicine_id: Slot):
        with app.state.db.connect() as db:
            if db.execute("DELETE FROM medicines WHERE id=?", (medicine_id,)).rowcount == 0:
                raise HTTPException(404, "Medicine slot is empty.")
        return Response(status_code=204)

    @app.get("/accounts", dependencies=protected)
    def accounts():
        with app.state.db.connect() as db:
            rows = db.execute("SELECT provider,account_id,username,assigned FROM accounts ORDER BY provider").fetchall()
        return {"accounts": [{**dict(row), "assigned": bool(row["assigned"])} for row in rows]}

    @app.patch("/accounts/{provider}", dependencies=protected)
    def assign_account(provider: Provider, value: Assignment):
        with app.state.db.connect() as db:
            if not db.execute("UPDATE accounts SET assigned=? WHERE provider=?", (int(value.assigned), provider)).rowcount:
                raise HTTPException(404, "Connect this account first.")
        return {"provider": provider, "assigned": value.assigned}

    @app.delete("/accounts/{provider}", status_code=204, dependencies=protected)
    def disconnect(provider: Provider):
        with app.state.db.connect() as db:
            db.execute("DELETE FROM accounts WHERE provider=?", (provider,))
        return Response(status_code=204)

    @app.get("/auth/{provider}/login", dependencies=protected)
    def login(provider: Provider, response: Response):
        client_id = getattr(settings, f"{provider}_client_id")
        if not client_id or (provider == "instagram" and not settings.instagram_client_secret):
            raise HTTPException(503, f"Configure {provider} OAuth credentials in server/.env.")
        state, browser, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(64)
        with app.state.db.connect() as db:
            db.execute("DELETE FROM oauth_states WHERE expires_at<?", (time.time(),))
            db.execute("INSERT INTO oauth_states VALUES(?,?,?,?,?)", (
                state, provider, hashlib.sha256(browser.encode()).hexdigest(), verifier, time.time() + 600))
        response.set_cookie(f"oauth_{provider}", browser, max_age=600, httponly=True, samesite="lax",
                            secure=settings.public_url.startswith("https://"), path=f"/auth/{provider}")
        params = {"response_type": "code", "client_id": client_id,
                  "redirect_uri": settings.callback(provider), "state": state}
        if provider == "x":
            params.update(scope="tweet.read tweet.write users.read offline.access", code_challenge_method="S256",
                          code_challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode())
            url = "https://x.com/i/oauth2/authorize"
        else:
            params.update(scope="instagram_business_basic,instagram_business_content_publish", enable_fb_login="0")
            url = "https://www.instagram.com/oauth/authorize"
        return {"authorization_url": f"{url}?{urlencode(params)}"}

    @app.get("/auth/{provider}/callback")
    async def callback(provider: Provider, request: Request, response: Response,
                       state: str, code: str | None = None, error: str | None = None):
        browser = request.cookies.get(f"oauth_{provider}", "")
        with app.state.db.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM oauth_states WHERE state=? AND provider=?", (state, provider)).fetchone()
            if (not row or row["expires_at"] < time.time() or not browser or
                    not secrets.compare_digest(row["browser_hash"], hashlib.sha256(browser.encode()).hexdigest())):
                raise HTTPException(400, "Invalid or expired OAuth state. Start sign-in again in the same browser.")
            db.execute("DELETE FROM oauth_states WHERE state=?", (state,))
        response.delete_cookie(f"oauth_{provider}", path=f"/auth/{provider}")
        if error or not code:
            raise HTTPException(400, "Social sign-in was denied or returned no authorization code.")
        try:
            account = await app.state.social.connect(provider, code, row["verifier"])
        except ProviderError as exc:
            raise HTTPException(502, str(exc)) from exc
        return {"success": True, "account": account}

    @app.post("/medicines/{medicine_id}/notify-missed", dependencies=protected)
    async def notify(medicine_id: Slot, value: Notification):
        record = medicine(medicine_id)
        scheduled_time = record['time_to_take']
        if "data" in record:
            if len(record["data"]) > 1 and value.dose_index is None:
                raise HTTPException(422, "Specify dose_index for a multi-dose schedule.")
            index = value.dose_index if value.dose_index is not None else 0
            if index >= len(record["data"]):
                raise HTTPException(422, "dose_index is outside the stored schedule.")
            scheduled_time = record["data"][index]["time"]
        elif value.dose_index not in (None, 0):
            raise HTTPException(422, "This medicine has only one stored time.")
        message = f"I haven't taken {record['name']} medicine at {scheduled_time} time"
        with app.state.db.connect() as db:
            assigned = [row[0] for row in db.execute("SELECT provider FROM accounts WHERE assigned=1 ORDER BY provider")]
        providers = list(dict.fromkeys(value.providers if value.providers is not None else assigned))
        if not providers:
            raise HTTPException(409, "Connect and assign at least one social account first.")
        image_url = str(value.image_url) if value.image_url else settings.instagram_image_url
        results = []
        async with app.state.publish_lock:
            for provider in providers:
                account = app.state.db.account(provider)
                if not account or not account["assigned"]:
                    results.append({"provider": provider, "success": False, "error": "Account is not connected and assigned."})
                    continue
                try:
                    post_id = await app.state.social.publish(account, message, image_url)
                    results.append({"provider": provider, "success": True, "post_id": post_id})
                except ProviderError as exc:
                    results.append({"provider": provider, "success": False, "error": str(exc)})
        return {"success": all(item["success"] for item in results), "medicine_id": medicine_id,
                "message": message, "timezone": record.get("timezone", settings.timezone), "results": results}

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=6767, reload=True)
