import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent


@dataclass
class Settings:
    database: str = str(ROOT / "data" / "demo.sqlite3")
    public_url: str = "http://127.0.0.1:6767"
    timezone: str = "America/New_York"
    x_client_id: str = ""
    x_client_secret: str = ""
    instagram_client_id: str = ""
    instagram_client_secret: str = ""
    instagram_verify_token: str = ""
    instagram_api_version: str = "v24.0"
    instagram_image_url: str = ""

    @classmethod
    def from_env(cls):
        load_dotenv(ROOT / ".env")
        return cls(**{key: os.getenv(key.upper(), getattr(cls, key))
                      for key in cls.__dataclass_fields__})

    def callback(self, provider):
        return f"{self.public_url.rstrip('/')}/auth/{provider}/callback"
