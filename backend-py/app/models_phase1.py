"""Read-only shadow models for tables owned by the Node/Prisma backend
(`backend/prisma/schema.prisma`). Never written to from here, and never part
of Alembic's autogenerate scope (see alembic/env.py) - Prisma's own migration
history is the only thing that ever changes these tables' shape.

Field names deliberately mirror Prisma's exact camelCase column names (e.g.
`departmentId`, not `department_id`) rather than following PEP8, since these
are 1:1 mirrors of an externally-owned schema, not idiomatic Python domain
models. Table/column casing was confirmed against the live dev database
(`\\d "BudgetRequest"`) - Prisma quotes every identifier, so Postgres
preserves exact case; SQLAlchemy auto-quotes any non-lowercase identifier the
same way, so no explicit name overrides are needed except where noted below.
"""

# Python 3.14 made annotations lazy by default (PEP 649), which the
# pydantic/SQLModel versions available at build time don't yet handle -
# every field raises "requires a type annotation" without this. Needed in
# every module that defines a SQLModel/pydantic class; drop it once
# pydantic ships real 3.14 support.
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import registry as sa_registry
from sqlmodel import Field, SQLModel

# Separate registry/metadata from the Phase 2 models (app/models_phase2.py) -
# this is what keeps these tables structurally invisible to Alembic, which is
# only ever pointed at the Phase 2 registry's metadata.
phase1_registry = sa_registry()

# Prisma-created Postgres enum columns (currentStage, roleType, etc.) read
# back fine as plain strings (Postgres serializes enums as text over the
# wire), so these fields are declared as bare `str` below - no custom column
# type needed for SELECT. WHERE-clause comparisons need one extra step
# though: Postgres won't compare a native enum column against a plain
# varchar bind param. Query call sites handle that with
# `sqlalchemy.cast(Model.col, String) == "VALUE"` (see enum_eq() in
# app/db.py) rather than this file hardcoding every enum's member list,
# which would just be a second copy of schema.prisma to keep in sync.


class Phase1Model(SQLModel, registry=phase1_registry):
    pass


class Department(Phase1Model, table=True):
    __tablename__ = "Department"

    id: str = Field(primary_key=True)
    name: str
    # `type` shadows the Python builtin - renamed on the Python side only,
    # still maps to the real "type" column.
    type_: str = Field(sa_column=Column("type", String))
    createdAt: datetime
    # Spec item 13: which NPC SBU this department belongs to (Node-owned,
    # admin-assigned - see backend/src/routes/admin.ts's PATCH
    # /admin/departments/:id). Drives Budget Utilization Tracking's NPC view
    # scoping (routers/utilization.py).
    sbu: Optional[str] = None


class User(Phase1Model, table=True):
    __tablename__ = "User"

    id: str = Field(primary_key=True)
    name: str
    email: str
    passwordHash: Optional[str] = None
    employeeIdNumber: Optional[int] = None
    departmentId: Optional[str] = None
    createdAt: datetime


class RoleAssignment(Phase1Model, table=True):
    __tablename__ = "RoleAssignment"

    id: str = Field(primary_key=True)
    departmentId: str
    roleType: str
    userId: str
    assignedById: Optional[str] = None
    effectiveDate: datetime
    createdAt: datetime


class SbuRoleAssignment(Phase1Model, table=True):
    __tablename__ = "SbuRoleAssignment"

    id: str = Field(primary_key=True)
    sbu: str
    roleType: str
    userId: str
    assignedById: Optional[str] = None
    effectiveDate: datetime
    createdAt: datetime


class Company(Phase1Model, table=True):
    __tablename__ = "Company"

    id: str = Field(primary_key=True)
    code: str
    name: str


class ExpenseLineItem(Phase1Model, table=True):
    __tablename__ = "ExpenseLineItem"

    id: str = Field(primary_key=True)
    name: str
    category: str
    description: Optional[str] = None
    glAccount: str
    costCenter: str
    ownerDepartmentId: str
    companyId: Optional[str] = None
    requiresMobilePolicy: bool
    sampleCharges: Optional[str] = None
    spendGridComputation: Optional[str] = None
    spendGridFrequency: Optional[str] = None
    visibleToDepartmentId: Optional[str] = None
    isCustom: bool
    status: str
    extraFieldsConfig: list = Field(sa_column=Column("extraFieldsConfig", JSONB))
    # GAE's pre-computed "CD-YY-Num" Budget Code (see lib/budgetCode.ts on
    # the Node side) - the reconciliation matching key, along with GL-CC.
    budgetCode: Optional[str] = None
    managedBy: Optional[str] = None
    createdAt: datetime
    updatedAt: datetime


class HistoricalActuals(Phase1Model, table=True):
    """Forecast module's per-line-item reference row (Node-owned). Field
    names are frozen to whichever Target Calendar Year the cycle was built
    for (e.g. `ytdActuals2026`) rather than being genuinely year-keyed -
    Phase 4's report treats these as "this row's current-cycle forecast",
    not a real point in a multi-year series (see routers/reports.py).
    """

    __tablename__ = "HistoricalActuals"

    id: str = Field(primary_key=True)
    departmentId: str
    fiscalYear: int
    expenseLineItemId: Optional[str] = None
    glAccount: str
    costCenter: str
    glDescription: str
    budgetCode: Optional[str] = None
    expenseCategory: Optional[str] = None
    requestCategory: str
    actuals2025: float
    approvedBudget2026: float
    ytdActuals2026: float
    monthlyRemainingForecast2026: dict = Field(sa_column=Column("monthlyRemainingForecast2026", JSONB))
    forecastCompletedAt: Optional[datetime] = None
    updatedAt: datetime


class BudgetRequest(Phase1Model, table=True):
    __tablename__ = "BudgetRequest"

    id: str = Field(primary_key=True)
    departmentId: str
    fiscalYear: int
    expenseLineItemId: str
    monthlyAmounts: list = Field(sa_column=Column("monthlyAmounts", JSONB))
    proposedAmount: float
    businessJustification: str
    otherRequiredFields: dict = Field(sa_column=Column("otherRequiredFields", JSONB))
    currentStage: str
    status: str
    budgetCutAmount: float
    isOverBudget: bool
    requiresCfoApproval: bool
    requestCategory: str
    sbu: Optional[str] = None
    npcHeadCode: Optional[str] = None
    # NPC (spec item 12 revision) fields - see backend/prisma/schema.prisma.
    npcSbu: Optional[str] = None
    npcLocation: Optional[str] = None
    projectTitle: Optional[str] = None
    projectStartDate: Optional[datetime] = None
    projectEndDate: Optional[datetime] = None
    # DOE/NPC's generated "SBU-YY-Num" Budget Code - null for GAE (use the
    # line item's own budgetCode instead) and Revenue.
    budgetCode: Optional[str] = None
    reasonCode: Optional[str] = None
    sapDocumentNumber: Optional[str] = None
    createdById: str
    bulkUploadBatchId: Optional[str] = None
    createdAt: datetime
    updatedAt: datetime


class FinalizedBudgetLine(Phase1Model, table=True):
    """Note 11 - the one place every 'what's the approved/current budget for
    this CC-GL' reader in this service now queries (see
    services/budget_balance.py, routers/utilization.py, routers/reports.py),
    replacing the old BudgetRequest(currentStage=APPROVED) + ExpenseLineItem
    join. Node-owned (written by workflowService.ts's finalizeAtStep5 /
    revenueBatchDecision), mirrored read-only here like every other
    Phase-1 table.
    """

    __tablename__ = "FinalizedBudgetLine"

    id: str = Field(primary_key=True)
    budgetRequestId: str
    fiscalYear: int
    requestCategory: str
    sbu: Optional[str] = None
    npcSbu: Optional[str] = None
    glAccount: str
    costCenter: str
    amount: float
    sapDocumentNumber: Optional[str] = None
    finalizedAt: datetime
    finalizedById: str
