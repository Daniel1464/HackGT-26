import json
import sqlite3
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
            """)
            columns = {row[1] for row in db.execute("PRAGMA table_info(medicines)")}
            if "schedule" not in columns:
                db.execute("ALTER TABLE medicines ADD COLUMN schedule TEXT")

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
