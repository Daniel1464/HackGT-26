"""Provider calls; publishing is never automatically retried."""
import asyncio
import time

import httpx


class ProviderError(Exception):
    pass


class Social:
    def __init__(self, settings, db, http):
        self.settings, self.db, self.http = settings, db, http

    async def request(self, method, url, **kwargs):
        try:
            response = await self.http.request(method, url, **kwargs)
        except httpx.RequestError as exc:
            raise ProviderError("Provider connection failed. Check the account before retrying a publish whose result is unknown.") from exc
        if response.is_error:
            # Do not echo URLs or provider bodies, which may contain tokens.
            raise ProviderError(f"Provider returned HTTP {response.status_code}. Check authorization, permissions and API access.")
        try:
            data = response.json()
            if not isinstance(data, dict) or data.get("error"):
                raise ValueError()
            return data
        except ValueError as exc:
            raise ProviderError("Provider returned an invalid response.") from exc

    @staticmethod
    def require(data, key):
        if not isinstance(data, dict) or data.get(key) is None:
            raise ProviderError(f"Provider response is missing {key}.")
        return data[key]

    def graph(self, path):
        return f"https://graph.instagram.com/{self.settings.instagram_api_version}/{path}"

    async def x_token(self, data):
        s = self.settings
        auth = httpx.BasicAuth(s.x_client_id, s.x_client_secret) if s.x_client_secret else None
        return await self.request("POST", "https://api.x.com/2/oauth2/token",
                                  data={"client_id": s.x_client_id, **data}, auth=auth)

    @staticmethod
    def timed_token(data, previous=None):
        token = {**(previous or {}), **data}
        if "expires_in" in data:
            token["expires_at"] = time.time() + int(data["expires_in"])
        token["issued_at"] = time.time()
        if not token.get("access_token"):
            raise ProviderError("Provider did not return an access token.")
        return token

    async def connect(self, provider, code, verifier):
        s = self.settings
        if provider == "x":
            token = self.timed_token(await self.x_token({
                "grant_type": "authorization_code", "code": code,
                "redirect_uri": s.callback(provider), "code_verifier": verifier,
            }))
            profile = await self.request("GET", "https://api.x.com/2/users/me",
                                        headers={"Authorization": f"Bearer {token['access_token']}"})
            user = self.require(profile, "data")
            account_id = str(self.require(user, "id"))
        else:
            short = await self.request("POST", "https://api.instagram.com/oauth/access_token", data={
                "client_id": s.instagram_client_id, "client_secret": s.instagram_client_secret,
                "grant_type": "authorization_code", "redirect_uri": s.callback(provider), "code": code,
            })
            token = self.timed_token(await self.request("GET", "https://graph.instagram.com/access_token", params={
                "grant_type": "ig_exchange_token", "client_secret": s.instagram_client_secret,
                "access_token": self.require(short, "access_token"),
            }))
            user = await self.request("GET", self.graph("me"), params={"fields": "user_id,username"},
                                      headers={"Authorization": f"Bearer {token['access_token']}"})
            account_id = str(self.require(user, "user_id"))
        username = str(self.require(user, "username"))
        self.db.save_account(provider, account_id, username, token)
        return {"provider": provider, "account_id": account_id, "username": username}

    async def access_token(self, account):
        token, provider = account["token"], account["provider"]
        expiry = token.get("expires_at", 0)
        if expiry <= time.time() and provider == "instagram":
            raise ProviderError("Instagram authorization expired. Connect the account again.")
        refresh_window = 300 if provider == "x" else 7 * 86400
        if expiry <= time.time() + refresh_window:
            if provider == "x":
                if not token.get("refresh_token"):
                    raise ProviderError("X authorization expired. Connect again with offline.access.")
                data = await self.x_token({"grant_type": "refresh_token", "refresh_token": token["refresh_token"]})
            else:
                if time.time() - token.get("issued_at", 0) < 86400:
                    return token["access_token"]
                data = await self.request("GET", "https://graph.instagram.com/refresh_access_token", params={
                    "grant_type": "ig_refresh_token", "access_token": token["access_token"],
                })
            token = self.timed_token(data, token)
            self.db.save_token(provider, token)
        return token["access_token"]

    async def publish(self, account, message, image_url):
        provider = account["provider"]
        if provider == "instagram" and not image_url:
            raise ProviderError("Instagram requires a public JPEG URL. Supply image_url or configure INSTAGRAM_IMAGE_URL.")
        token = await self.access_token(account)
        headers = {"Authorization": f"Bearer {token}"}
        if provider == "x":
            data = await self.request("POST", "https://api.x.com/2/tweets", headers=headers, json={"text": message})
            return str(self.require(self.require(data, "data"), "id"))
        container = await self.request("POST", self.graph(f"{account['account_id']}/media"), headers=headers,
                                       data={"image_url": image_url, "caption": message})
        container_id = self.require(container, "id")
        for attempt in range(15):
            status = await self.request("GET", self.graph(container_id), headers=headers, params={"fields": "status_code"})
            code = status.get("status_code")
            if code == "FINISHED":
                break
            if code in ("ERROR", "EXPIRED"):
                raise ProviderError(f"Instagram image processing failed ({code}).")
            await asyncio.sleep(1)
        else:
            raise ProviderError("Instagram image processing did not finish in time; no publish request was made.")
        post = await self.request("POST", self.graph(f"{account['account_id']}/media_publish"), headers=headers,
                                  data={"creation_id": container_id})
        return str(self.require(post, "id"))
