from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers.dash_flow import router as dash_flow_router
from .routers.internal_orders import router as internal_orders_router
from .routers.reports import router as reports_router
from .routers.transfers import router as transfers_router
from .routers.utilization import router as utilization_router

app = FastAPI(title="Budgeting System - Phase 2/3 (Utilization Tracking / Transfer & Reallocation)")

# Matches the Node backend's app.ts: wide-open CORS for local dev (both
# backends sit behind the same Vite dev proxy anyway - see /api2 in
# frontend/vite.config.ts).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


app.include_router(utilization_router)
app.include_router(transfers_router)
app.include_router(internal_orders_router)
app.include_router(reports_router)
app.include_router(dash_flow_router)
