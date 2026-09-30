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

# The User Management workbook's own labels for the NPC group's scope (its
# "NPC SBU" column) -> the 8 codes above.
NPC_GROUP_SCOPE_TO_SBU: dict[str, str] = {
    "Malls": "MALLS",
    "Offices": "OFFICES",
    "Estates": "ESTATES",
    "Residential": "RESIDENTIAL",
    "Leisure": "LEISURE",
    "Corporate - IT": "CORPORATE_IT",
    "Corporate - HR": "CORPORATE_HR",
    "Corporate - Admin": "CORPORATE_ADMIN",
}
