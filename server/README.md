# Medication social demo

Single-user FastAPI server. SQLite stores two medicine slots and one connected
account per provider (X and Instagram). A connected account is assigned to
notifications by default; `PATCH /accounts/{provider}` toggles assignment.
The app uploads each successfully broadcast medicine schedule to this server.
It does not read schedules back from the ESP32 or infer whether medicine was taken.
Calling the notification endpoint explicitly publishes the missed-dose message.

## App synchronization

### Connecting social accounts in the mobile app

The home screen's **Social accounts** card connects X/Instagram, displays the
server's connected usernames, toggles notification assignment, and disconnects
accounts with confirmation. It never publishes a post just by connecting.
Use a native development build with the existing `pilldispenser` URL scheme;
Expo Go and the web preview are not supported for this mobile OAuth return flow.

Configure provider credentials and a phone-reachable HTTPS `PUBLIC_URL` in the
server `.env`. Register `${PUBLIC_URL}/auth/x/callback` and
`${PUBLIC_URL}/auth/instagram/callback` in the respective provider dashboards.
The frontend uses the same server URL/key documented below. Restart the server
after updating it; reload the app. OAuth access tokens and client secrets remain
server-side. Instagram needs a professional account and the required approved
permissions. Provider approval/access restrictions still apply.

The app requests an authenticated, two-minute, single-use browser handoff URL.
Opening it establishes the browser cookie before redirecting to the provider.
The server validates the callback, stores tokens, then returns only a status via
`pilldispenser://oauth-return`. The app refreshes `/accounts` to verify connection.
Cancelled/failed sign-ins do not fabricate a connected account. Use Refresh if
you return manually. Keep access logging disabled to avoid logging handoff URLs.
Disconnect deletes local tokens; revoke consent on the provider separately.

Add these to `pill-dispenser-app/.env.local` (keep existing entries):

```dotenv
EXPO_PUBLIC_SERVER_API_URL=https://your-server-or-tunnel.example
EXPO_PUBLIC_SERVER_API_KEY=the-same-value-as-server-API_KEY
```

Use a URL reachable from the phone, not the phone's `localhost`. Prefer HTTPS.
For LAN development bind Uvicorn with `--host 0.0.0.0` and use the computer's LAN
IP on the phone; native platform cleartext restrictions may require HTTPS.
Restart Expo and fully reload the app after changing environment variables.
The API key is bundled publicly for this single-user demo, not production-grade
authentication. Never put social OAuth client secrets in the Expo environment.

The shared frontend `sendMedicine` path writes BLE first, then calls authenticated
`PUT /medicines/{id}/schedule` with `{medicine,id,data:[{time:"HH:MM UTC",dose:2}]}`.
Success requires both operations. Missing configuration fails before BLE writes;
network failures/timeouts report that BLE already succeeded. There is no automatic
BLE retry or offline queue. A failed/uncertain server write can be retried directly
through the idempotent HTTP PUT without broadcasting the BLE packets again.
Deleting medicine on the board is not yet synchronized by this upload path.

All doses are retained in SQLite; updates replace the server schedule for that ID.
GET medicine responses include `data` and `timezone:"UTC"` for app-uploaded records.
Legacy `time_to_take` is the first entry's HH:MM for these records, in UTC, not the
server default timezone. Legacy single-time writes still work and clear any prior
full schedule. Existing databases migrate automatically without deleting records.
For multi-dose records, pass zero-based `dose_index` to `notify-missed` to select
which scheduled time to publish; ambiguous requests are rejected.

## Run (Python 3.10+)

From `server/`, in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(32))"
# Put the generated value in API_KEY in .env; fill provider credentials below.
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 6767 --reload --no-access-log
```

Open `/docs` on your server origin. Click **Authorize** and enter API_KEY.
Requests to medicine, account, notification and OAuth-start endpoints require
the `X-API-Key` header. OAuth callbacks use browser-bound, expiring, one-use
state instead. The example disables access logging to avoid logging OAuth codes.
The API key protects the single user's records; OAuth connects posting accounts,
not multiple application users.

Medicine times are daily 24-hour `HH:MM` in `TIMEZONE` (America/New_York by default).
No automatic scheduler is included. SQLite lives in `server/data/demo.sqlite3`.
Tokens are stored locally in this ignored database in plaintext for the demo;
do not commit/share it. `.env` is also ignored.

## OAuth setup

Use an HTTPS tunnel for real callbacks. Set PUBLIC_URL to its origin, e.g.
`https://your-demo.example`, and open **that origin's** `/docs` before starting
OAuth so the browser cookie returns to the same host. Keep one sign-in attempt
per provider open at a time.

### X

Create an X developer app, enable OAuth 2.0 with user-context posting access,
and set X_CLIENT_ID and X_CLIENT_SECRET. Register this exact callback:
`PUBLIC_URL/auth/x/callback`. The server requests `tweet.read tweet.write
users.read offline.access` and uses PKCE S256. The developer account needs API
access/credits permitting `POST /2/tweets`. Public clients may omit the secret;
web/confidential clients must supply it. Expiring tokens are refreshed.

### Instagram

Configure **Instagram API with Instagram Login** in a Meta developer app;
use its Instagram app ID/secret for INSTAGRAM_CLIENT_ID/INSTAGRAM_CLIENT_SECRET.
Register `PUBLIC_URL/auth/instagram/callback` exactly. Use an Instagram
**Business or Creator account** and grant `instagram_business_basic` and
`instagram_business_content_publish`. In development mode, configure and accept
the required tester/app roles; other accounts may require app review.

Instagram cannot publish this message as a text-only feed post. Supply a
public JPEG URL in INSTAGRAM_IMAGE_URL or in each notification's `image_url`.
The API publishes that image with the missed-dose message as its caption.
The URL must be accessible to Meta without cookies or authorization. The server
creates a media container, waits for FINISHED, and then publishes it.
This implementation posts to the user's own feed; it does not send DMs.

### Connect accounts

In authorized `/docs`, execute `GET /auth/x/login` or
`GET /auth/instagram/login`, then open the returned `authorization_url` in the
same browser. Complete provider sign-in/consent. The callback returns account
identity only; access/refresh tokens never appear in API responses.
Check `GET /accounts`. Disconnecting with DELETE removes the local tokens;
provider-side app authorization can be revoked in that provider's settings.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/medicines` | Add a new slot; 409 if occupied |
| PUT | `/medicines/{0 or 1}` | Add or replace a slot |
| GET | `/medicines` | List medicines and timezone |
| GET | `/medicines/{0 or 1}` | Read one medicine |
| DELETE | `/medicines/{0 or 1}` | Remove a slot |
| GET | `/auth/{x or instagram}/login` | Get OAuth authorization URL |
| GET | `/auth/{x or instagram}/callback` | Provider callback |
| GET | `/accounts` | List connected accounts without secrets |
| PATCH | `/accounts/{x or instagram}` | Set `{"assigned": true}` or false |
| DELETE | `/accounts/{x or instagram}` | Disconnect local account |
| POST | `/medicines/{0 or 1}/notify-missed` | Publish to assigned accounts |

Add a medicine using this JSON:

```json
{"id": 0, "name": "Vitamin A", "time_to_take": "10:00"}
```

Notify with `{}` to use all assigned accounts and the configured Instagram image,
or select accounts and supply an image:

```json
{"providers": ["x", "instagram"], "image_url": "https://your-site.example/reminder.jpg"}
```

The published text is `I haven't taken Vitamin A medicine at 10:00 time`.
The response includes `success` and a `results` entry for every requested provider,
with a real post ID on success or an error on failure. Mixed outcomes are reported
explicitly. Publishing is not retried automatically and is not idempotent:
repeating the endpoint creates another post. After partial success, retry only
failed providers; after a network timeout, check the account before retrying.

## Checks

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Tests use temporary SQLite databases and mocked HTTP providers. They never post
to real social accounts. Live OAuth/posting requires your registered apps and consent.

References: [X OAuth PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code),
[Meta's Instagram API collection](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api),
[Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/).
