"""NPC's fixed 8-value SBU list - mirrors backend/src/lib/npcSbu.ts exactly.
Kept as a small standalone module (not part of models_phase1.py) since it's
plain reference data, not a DB-backed model.
"""

NPC_SBU_LABELS: dict[str, str] = {
    "MALLS": "Malls",
    "OFFICES": "Offices",
    "ESTATES": "Estates",
    "RESIDENTIAL": "Residential",
    "LEISURE": "Leisure",
    "CORPORATE_IT": "Corporate IT",
    "CORPORATE_HR": "Corporate HR",
    "CORPORATE_ADMIN": "Corporate Admin",
}
