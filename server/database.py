import json
import sqlite3
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
from pathlib import Path


class Database:
    def __init__(self, path):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS medicines (
                    id INTEGER PRIMARY KEY CHECK (id IN (0, 1)),
                    name TEXT NOT NULL, time_to_take TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS accounts (
                    provider TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL, username TEXT NOT NULL,
                    token TEXT NOT NULL, assigned INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS oauth_states (
                    state TEXT PRIMARY KEY, provider TEXT NOT NULL,
                    browser_hash TEXT NOT NULL, verifier TEXT NOT NULL,
                    expires_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS app_state (
                    key TEXT PRIMARY KEY, value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS dose_history (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    medicine_id INTEGER NOT NULL CHECK(medicine_id IN (0, 1)),
                    medicine_name TEXT NOT NULL,
                    scheduled_for TEXT NOT NULL,
                    quantity INTEGER NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('upcoming','late','missed','taken','cancelled')),
                    taken INTEGER NOT NULL DEFAULT 0,
                    taken_at TEXT,
                    UNIQUE(medicine_id, scheduled_for)
                );
            """)
            columns = {row[1] for row in db.execute("PRAGMA table_info(medicines)")}
            if "schedule" not in columns:
                db.execute("ALTER TABLE medicines ADD COLUMN schedule TEXT")
            if "mobile" not in {row[1] for row in db.execute("PRAGMA table_info(oauth_states)")}:
                db.execute("ALTER TABLE oauth_states ADD COLUMN mobile INTEGER NOT NULL DEFAULT 0")
            db.execute("""CREATE TABLE IF NOT EXISTS oauth_handoffs (
                ticket_hash TEXT PRIMARY KEY, provider TEXT NOT NULL, expires_at REAL NOT NULL)""")
            db.execute("INSERT OR IGNORE INTO app_state(key,value) VALUES('history_started_at',?)",
                       (datetime.now(timezone.utc).isoformat(),))

    def refresh_dose_history(self, now=None):
        now = now or datetime.now(timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        now = now.astimezone(timezone.utc)
        with self.connect() as db:
            started = datetime.fromisoformat(db.execute(
                "SELECT value FROM app_state WHERE key='history_started_at'").fetchone()[0]).astimezone(timezone.utc)
            medicines = db.execute("SELECT id,name,schedule FROM medicines WHERE schedule IS NOT NULL").fetchall()
            for medicine in medicines:
                schedule = json.loads(medicine["schedule"])
                for day_offset in (-1, 0, 1):
                    day = (now + timedelta(days=day_offset)).date()
                    for dose in schedule:
                        hour, minute = map(int, dose["time"][:5].split(":"))
                        scheduled = datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc)
                        if scheduled < started:
                            continue
                        delta = (now - scheduled).total_seconds()
                        status = "upcoming" if delta < 0 else "missed" if delta >= 3600 else "late" if delta >= 30 else "upcoming"
                        db.execute("""INSERT OR IGNORE INTO dose_history
                            (medicine_id,medicine_name,scheduled_for,quantity,status)
                            VALUES(?,?,?,?,?)""",
                            (medicine["id"], medicine["name"], scheduled.isoformat(), dose["dose"], status))
                        if delta >= 30:
                            overdue_status = "missed" if delta >= 3600 else "late"
                            db.execute("""UPDATE dose_history SET status=?
                                WHERE medicine_id=? AND scheduled_for=? AND taken=0 AND status IN ('upcoming','late')""",
                                (overdue_status, medicine["id"], scheduled.isoformat()))

    def cancel_upcoming_doses(self, medicine_id):
        now = datetime.now(timezone.utc).isoformat()
        with self.connect() as db:
            db.execute("""UPDATE dose_history SET status='cancelled'
                WHERE medicine_id=? AND taken=0 AND status='upcoming' AND scheduled_for>?""",
                (medicine_id, now))

    def dose_history(self, limit=300):
        self.refresh_dose_history()
        since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        with self.connect() as db:
            rows = db.execute("""SELECT event_id,medicine_id,medicine_name,scheduled_for,
                quantity,status,taken,taken_at FROM dose_history
                WHERE scheduled_for>=? ORDER BY scheduled_for DESC LIMIT ?""", (since, limit)).fetchall()
        return [{**dict(row), "taken": bool(row["taken"])} for row in rows]

    def mark_dose_taken(self, event_id):
        now = datetime.now(timezone.utc)
        with self.connect() as db:
            row = db.execute("SELECT * FROM dose_history WHERE event_id=?", (event_id,)).fetchone()
            if row is None:
                return None
            if row["status"] == "cancelled":
                raise ValueError("This dose was cancelled when its schedule changed.")
            if not row["taken"]:
                scheduled = datetime.fromisoformat(row["scheduled_for"]).astimezone(timezone.utc)
                if now < scheduled:
                    raise ValueError("This dose is not due yet.")
                status = "taken" if (now - scheduled).total_seconds() < 30 else "late"
                db.execute("UPDATE dose_history SET taken=1,taken_at=?,status=? WHERE event_id=?",
                           (now.isoformat(), status, event_id))
            updated = db.execute("SELECT * FROM dose_history WHERE event_id=?", (event_id,)).fetchone()
        return {**dict(updated), "taken": bool(updated["taken"])}

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def account(self, provider):
        with self.connect() as db:
            row = db.execute("SELECT * FROM accounts WHERE provider=?", (provider,)).fetchone()
        if row is None:
            return None
        account = dict(row)
        account["token"] = json.loads(account["token"])
        return account

    def save_account(self, provider, account_id, username, token):
        with self.connect() as db:
            db.execute("""INSERT INTO accounts(provider,account_id,username,token)
                VALUES(?,?,?,?) ON CONFLICT(provider) DO UPDATE SET
                account_id=excluded.account_id,username=excluded.username,token=excluded.token""",
                (provider, account_id, username, json.dumps(token)))

    def save_token(self, provider, token):
        with self.connect() as db:
            db.execute("UPDATE accounts SET token=? WHERE provider=?", (json.dumps(token), provider))
