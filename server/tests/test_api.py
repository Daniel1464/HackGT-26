import base64
import hashlib
import json
import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi.testclient import TestClient

from config import Settings
from main import create_app


class DemoTests(unittest.TestCase):
    def test_mobile_oauth_handoff(self):
        for provider in ("x", "instagram"):
            result = self.client.post(f"/auth/{provider}/mobile")
            self.assertEqual(result.status_code, 200)
            browser_url = result.json()["browser_url"]
            self.assertNotIn("test-key", browser_url)
            opened = self.client.get(browser_url, follow_redirects=False)
            self.assertEqual(opened.status_code, 303)
            self.assertIn(f"oauth_{provider}=", opened.headers["set-cookie"])
            self.assertEqual(self.client.get(browser_url, follow_redirects=False).status_code, 400)
            state = parse_qs(urlparse(opened.headers["location"]).query)["state"][0]
            callback = f"/auth/{provider}/callback?state={state}&code=code"
            with TestClient(create_app(self.settings, httpx.MockTransport(self.provider))) as stranger:
                self.assertEqual(stranger.get(callback, follow_redirects=False).status_code, 400)
            finished = self.client.get(callback, follow_redirects=False)
            self.assertEqual(finished.status_code, 303)
            self.assertEqual(finished.headers["location"], "pilldispenser://oauth-return?status=success")
            self.assertEqual(self.client.get(callback, follow_redirects=False).status_code, 400)
        self.assertEqual(len(self.client.get("/accounts").json()["accounts"]), 2)

    def test_mobile_handoff_expiry_and_denial(self):
        browser_url = self.client.post("/auth/x/mobile").json()["browser_url"]
        with self.app.state.db.connect() as db:
            db.execute("UPDATE oauth_handoffs SET expires_at=0")
        self.assertEqual(self.client.get(browser_url, follow_redirects=False).status_code, 400)
        browser_url = self.client.post("/auth/x/mobile").json()["browser_url"]
        opened = self.client.get(browser_url, follow_redirects=False)
        state = parse_qs(urlparse(opened.headers["location"]).query)["state"][0]
        denied = self.client.get(f"/auth/x/callback?state={state}&error=access_denied", follow_redirects=False)
        self.assertEqual(denied.headers["location"], "pilldispenser://oauth-return?status=error")
        self.assertEqual(self.client.get("/accounts").json()["accounts"], [])

    def test_full_schedule_sync(self):
        value = {"medicine": "Vitamin B", "id": 1,
                 "data": [{"time": "12:30 UTC", "dose": 2}, {"time": "22:00 UTC", "dose": 1}]}
        self.assertEqual(self.client.put("/medicines/1/schedule", json=value).status_code, 200)
        stored = self.client.get("/medicines/1").json()
        self.assertEqual(stored["data"], value["data"])
        self.assertEqual(stored["timezone"], "UTC")
        self.assertEqual(self.client.post("/medicines/1/notify-missed", json={}).status_code, 422)
        self.assertEqual(self.client.put("/medicines/0/schedule", json=value).status_code, 422)
        self.assertEqual(self.client.put("/medicines/1/schedule", json={**value, "data": []}).status_code, 422)
        with TestClient(create_app(self.settings)) as restarted:
            self.assertEqual(restarted.get("/medicines/1", headers={"X-API-Key": "test-key"}).json(), stored)
        value["data"] = [{"time": "09:00 UTC", "dose": 3}]
        self.assertEqual(self.client.put("/medicines/1/schedule", json=value).status_code, 200)
        self.assertEqual(self.client.get("/medicines/1").json()["data"], value["data"])
        self.assertEqual(self.client.delete("/medicines/1").status_code, 204)
        self.assertEqual(self.client.get("/medicines/1").status_code, 404)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(database=str(Path(self.temp.name) / "test.sqlite3"), api_key="test-key",
                                 public_url="http://testserver", x_client_id="x-id", x_client_secret="x-secret",
                                 instagram_client_id="ig-id", instagram_client_secret="ig-secret")
        self.requests = []
        self.fail_x = False
        self.ig_processing = "FINISHED"
        self.app = create_app(self.settings, httpx.MockTransport(self.provider))
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.client.headers["X-API-Key"] = "test-key"

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def provider(self, request):
        self.requests.append(request)
        host, path = request.url.host, request.url.path
        if host == "api.x.com":
            if path == "/2/oauth2/token":
                data = parse_qs(request.content.decode())
                self.assertTrue(request.headers["authorization"].startswith("Basic "))
                self.assertIn(data["grant_type"][0], ("authorization_code", "refresh_token"))
                return httpx.Response(200, json={"access_token": "x-token", "refresh_token": "x-refresh", "expires_in": 7200})
            if path == "/2/users/me":
                return httpx.Response(200, json={"data": {"id": "x-user", "username": "demo-x"}})
            if path == "/2/tweets":
                self.assertEqual(json.loads(request.content)["text"], "I haven't taken Vitamin A medicine at 10:00 time")
                return httpx.Response(429 if self.fail_x else 201, json={"data": {"id": "post-x"}})
        if host == "api.instagram.com" and path == "/oauth/access_token":
            return httpx.Response(200, json={"access_token": "ig-short", "user_id": "ig-user"})
        if host == "graph.instagram.com":
            if path in ("/access_token", "/refresh_access_token"):
                return httpx.Response(200, json={"access_token": "ig-token", "expires_in": 5184000})
            if path.endswith("/me"):
                return httpx.Response(200, json={"user_id": "ig-user", "username": "demo-ig"})
            if path.endswith("/media"):
                self.assertEqual(parse_qs(request.content.decode())["caption"][0],
                                 "I haven't taken Vitamin A medicine at 10:00 time")
                return httpx.Response(200, json={"id": "container"})
            if path.endswith("/container"):
                return httpx.Response(200, json={"status_code": self.ig_processing})
            if path.endswith("/media_publish"):
                return httpx.Response(200, json={"id": "post-ig"})
        raise AssertionError(f"Unexpected provider request: {request.method} {host}{path}")

    def login(self, provider):
        response = self.client.get(f"/auth/{provider}/login")
        self.assertEqual(response.status_code, 200)
        query = parse_qs(urlparse(response.json()["authorization_url"]).query)
        result = self.client.get(f"/auth/{provider}/callback", params={"state": query["state"][0], "code": "test-code"})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertNotIn("access_token", result.text)
        return query

    def add(self):
        self.assertEqual(self.client.post("/medicines", json={
            "id": 0, "name": "Vitamin A", "time_to_take": "10:00"}).status_code, 201)

    def test_crud_validation_and_restart_persistence(self):
        for invalid in (2, -1, True, "0"):
            self.assertEqual(self.client.post("/medicines", json={
                "id": invalid, "name": "A", "time_to_take": "10:00"}).status_code, 422)
        for bad_time in ("24:00", "9:30", "10:99"):
            self.assertEqual(self.client.post("/medicines", json={
                "id": 0, "name": "A", "time_to_take": bad_time}).status_code, 422)
        self.add()
        self.assertEqual(self.client.post("/medicines", json={
            "id": 0, "name": "B", "time_to_take": "11:00"}).status_code, 409)
        with TestClient(create_app(self.settings)) as other:
            self.assertEqual(other.get("/medicines/0", headers={"X-API-Key": "test-key"}).json()["name"], "Vitamin A")
        self.assertEqual(self.client.put("/medicines/0", json={
            "id": 0, "name": "A changed", "time_to_take": "11:00"}).status_code, 200)
        self.assertEqual(self.client.delete("/medicines/0").status_code, 204)
        self.assertEqual(self.client.get("/medicines/0").status_code, 404)

    def test_auth_required_and_no_tokens_exposed(self):
        self.assertEqual(self.client.get("/medicines", headers={"X-API-Key": "wrong"}).status_code, 401)
        self.assertEqual(self.client.get("/auth/x/login", headers={"X-API-Key": "wrong"}).status_code, 401)
        self.login("x")
        body = self.client.get("/accounts").json()
        self.assertTrue(body["accounts"][0]["assigned"])
        self.assertNotIn("token", json.dumps(body))

    def test_oauth_pkce_cookie_binding_and_replay(self):
        query = self.login("x")
        exchange = next(r for r in self.requests if r.url.path == "/2/oauth2/token")
        verifier = parse_qs(exchange.content.decode())["code_verifier"][0]
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        self.assertEqual(query["code_challenge"], [challenge])
        self.assertEqual(self.client.get("/auth/x/callback", params={"state": query["state"][0], "code": "replay"}).status_code, 400)
        state = parse_qs(urlparse(self.client.get("/auth/x/login").json()["authorization_url"]).query)["state"][0]
        self.client.cookies.clear()
        self.assertEqual(self.client.get("/auth/x/callback", params={"state": state, "code": "stolen"}).status_code, 400)

    def test_oauth_expiry_and_denial(self):
        state = parse_qs(urlparse(self.client.get("/auth/x/login").json()["authorization_url"]).query)["state"][0]
        with self.app.state.db.connect() as db:
            db.execute("UPDATE oauth_states SET expires_at=0")
        self.assertEqual(self.client.get("/auth/x/callback", params={"state": state, "code": "late"}).status_code, 400)
        state = parse_qs(urlparse(self.client.get("/auth/x/login").json()["authorization_url"]).query)["state"][0]
        self.assertEqual(self.client.get("/auth/x/callback", params={"state": state, "error": "access_denied"}).status_code, 400)
        self.assertEqual(self.requests, [])

    def test_publish_to_both_assigned_accounts(self):
        self.add()
        self.login("x")
        self.login("instagram")
        result = self.client.post("/medicines/0/notify-missed", json={"image_url": "https://example.com/demo.jpg"}).json()
        self.assertTrue(result["success"], result)
        self.assertEqual({r["post_id"] for r in result["results"]}, {"post-x", "post-ig"})

    def test_partial_failure_no_automatic_retry(self):
        self.add()
        self.login("x")
        self.login("instagram")
        result = self.client.post("/medicines/0/notify-missed", json={}).json()
        self.assertFalse(result["success"])
        results = {r["provider"]: r for r in result["results"]}
        self.assertTrue(results["x"]["success"])
        self.assertIn("JPEG", results["instagram"]["error"])
        self.assertEqual(sum(r.url.path == "/2/tweets" for r in self.requests), 1)

    def test_unassigned_accounts_and_no_accounts(self):
        self.add()
        self.assertEqual(self.client.post("/medicines/0/notify-missed", json={}).status_code, 409)
        self.login("x")
        self.client.patch("/accounts/x", json={"assigned": False})
        result = self.client.post("/medicines/0/notify-missed", json={"providers": ["x"]}).json()
        self.assertFalse(result["success"])
        self.assertFalse(any(r.url.path == "/2/tweets" for r in self.requests))

    def test_x_refresh_and_provider_failure(self):
        self.add()
        self.login("x")
        account = self.app.state.db.account("x")
        account["token"]["expires_at"] = time.time() - 1
        self.app.state.db.save_token("x", account["token"])
        self.fail_x = True
        result = self.client.post("/medicines/0/notify-missed", json={}).json()
        self.assertFalse(result["success"])
        self.assertIn("429", result["results"][0]["error"])
        grants = [parse_qs(r.content.decode())["grant_type"][0]
                  for r in self.requests if r.url.path == "/2/oauth2/token"]
        self.assertEqual(grants, ["authorization_code", "refresh_token"])

    def test_instagram_processing_error_does_not_publish(self):
        self.add()
        self.login("instagram")
        self.ig_processing = "ERROR"
        result = self.client.post("/medicines/0/notify-missed", json={"image_url": "https://example.com/demo.jpg"}).json()
        self.assertFalse(result["success"])
        self.assertFalse(any(r.url.path.endswith("/media_publish") for r in self.requests))


if __name__ == "__main__":
    unittest.main()
