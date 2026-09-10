from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolved relative to this file (not the process's cwd) so settings load
# correctly regardless of where uvicorn is launched from - e.g. a launcher
# that runs from the repo root with --app-dir backend-py, where a bare
# ".env" would otherwise resolve to the repo root instead of backend-py/.env.
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    database_url: str
    port: int = 8000
    jwt_secret: str
    # Phase 3 transfer-request attachments (FR-3.1) - local disk storage,
    # same convention as the Node backend's multer-based uploads.
    upload_dir: str = "./uploads"

    # SAP Requirements integration - Ortigas's own SAP data broker (see
    # app/services/sap_broker.py), same broker/base-URL Node's
    # lib/sapBroker.ts talks to, with its own set of per-report API keys.
    sap_broker_base_url: str = "https://paba.ortigasland.com.ph/api/v1"
    fbl3n_api_key: str = ""
    kssb_v2_api_key: str = ""
    salr_api_key: str = ""


settings = Settings()
