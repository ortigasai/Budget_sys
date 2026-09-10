import { PrismaClient, DepartmentType, RoleType } from "@prisma/client";
import { importExpenseLineItems } from "./importExpenseLineItems";
import { importEmployees, testPasswordHash } from "./importEmployees";

const prisma = new PrismaClient();

const FISCAL_YEAR = 2027;

// Real centralized departments from the Expense Line Items catalog, plus
// Corporate Finance/Legal kept from the functional spec even though the
// (still-incomplete) real catalog doesn't reference them yet.
const CENTRALIZED_DEPARTMENTS = [
  "Admin Services",
  "Corporate Marketing",
  "Human Resources",
  "IS & IT",
  "Tax",
  "TSG",
  "Corporate Finance",
  "Legal",
];

async function main() {
  console.log("Seeding...");

  // Notes_6: every demo/role user shares the same testing password.
  const passwordHash = await testPasswordHash();

  const departments = await Promise.all(
    [
      { name: "Sales", type: DepartmentType.REQUESTING },
      { name: "Operations", type: DepartmentType.REQUESTING },
      { name: "Marketing", type: DepartmentType.REQUESTING },
      ...CENTRALIZED_DEPARTMENTS.map((name) => ({ name, type: DepartmentType.CENTRALIZED })),
    ].map((d) =>
      prisma.department.upsert({
        where: { name: d.name },
        update: {},
        create: d,
      })
    )
  );

  const byName = Object.fromEntries(departments.map((d) => [d.name, d]));

  const budgetOfficer = await prisma.user.upsert({
    where: { email: "budget.officer@ortigas.com.ph" },
    update: { passwordHash },
    create: {
      name: "Bea Officer",
      email: "budget.officer@ortigas.com.ph",
      departmentId: byName["Corporate Finance"].id,
      passwordHash,
    },
  });

  const bcaHead = await prisma.user.upsert({
    where: { email: "bca.head@ortigas.com.ph" },
    update: { passwordHash },
    create: {
      name: "Carlos BCA",
      email: "bca.head@ortigas.com.ph",
      departmentId: byName["Corporate Finance"].id,
      passwordHash,
    },
  });

  const cfo = await prisma.user.upsert({
    where: { email: "cfo@ortigas.com.ph" },
    update: { passwordHash },
    create: {
      name: "Cesar CFO",
      email: "cfo@ortigas.com.ph",
      departmentId: byName["Corporate Finance"].id,
      passwordHash,
    },
  });
  await prisma.roleAssignment.upsert({
    where: {
      departmentId_roleType_userId: {
        departmentId: byName["Corporate Finance"].id,
        roleType: RoleType.CFO,
        userId: cfo.id,
      },
    },
    update: {},
    create: {
      departmentId: byName["Corporate Finance"].id,
      roleType: RoleType.CFO,
      userId: cfo.id,
      assignedById: budgetOfficer.id,
    },
  });

  // One requestor + dept head per requesting department, one preparer + L1
  // reviewer + head per centralized department.
  const requestingUsers: Record<string, { requestor: any; head: any }> = {};
  for (const deptName of ["Sales", "Operations", "Marketing"]) {
    const dept = byName[deptName];
    const requestor = await prisma.user.upsert({
      where: { email: `${deptName.toLowerCase()}.requestor@ortigas.com.ph` },
      update: { passwordHash },
      create: {
        name: `${deptName} Requestor`,
        email: `${deptName.toLowerCase()}.requestor@ortigas.com.ph`,
        departmentId: dept.id,
        passwordHash,
      },
    });
    const head = await prisma.user.upsert({
      where: { email: `${deptName.toLowerCase()}.head@ortigas.com.ph` },
      update: { passwordHash },
      create: {
        name: `${deptName} Head`,
        email: `${deptName.toLowerCase()}.head@ortigas.com.ph`,
        departmentId: dept.id,
        passwordHash,
      },
    });
    await prisma.roleAssignment.upsert({
      where: {
        departmentId_roleType_userId: {
          departmentId: dept.id,
          roleType: RoleType.DEPARTMENT_HEAD,
          userId: head.id,
        },
      },
      update: {},
      create: {
        departmentId: dept.id,
        roleType: RoleType.DEPARTMENT_HEAD,
        userId: head.id,
        assignedById: budgetOfficer.id,
      },
    });
    requestingUsers[deptName] = { requestor, head };
  }

  const centralizedUsers: Record<string, { preparer: any; l1: any; head: any }> = {};
  for (const deptName of CENTRALIZED_DEPARTMENTS) {
    const dept = byName[deptName];
    const slug = deptName.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const preparer = await prisma.user.upsert({
      where: { email: `${slug}.preparer@ortigas.com.ph` },
      update: { passwordHash },
      create: {
        name: `${deptName} Preparer`,
        email: `${slug}.preparer@ortigas.com.ph`,
        departmentId: dept.id,
        passwordHash,
      },
    });
    const l1 = await prisma.user.upsert({
      where: { email: `${slug}.reviewer@ortigas.com.ph` },
      update: { passwordHash },
      create: {
        name: `${deptName} L1 Reviewer`,
        email: `${slug}.reviewer@ortigas.com.ph`,
        departmentId: dept.id,
        passwordHash,
      },
    });
    const head = await prisma.user.upsert({
      where: { email: `${slug}.head@ortigas.com.ph` },
      update: { passwordHash },
      create: {
        name: `${deptName} Head`,
        email: `${slug}.head@ortigas.com.ph`,
        departmentId: dept.id,
        passwordHash,
      },
    });

    await prisma.roleAssignment.upsert({
      where: {
        departmentId_roleType_userId: {
          departmentId: dept.id,
          roleType: RoleType.CENTRALIZED_BUDGET_PREPARER,
          userId: preparer.id,
        },
      },
      update: {},
      create: {
        departmentId: dept.id,
        roleType: RoleType.CENTRALIZED_BUDGET_PREPARER,
        userId: preparer.id,
        assignedById: budgetOfficer.id,
      },
    });
    await prisma.roleAssignment.upsert({
      where: {
        departmentId_roleType_userId: {
          departmentId: dept.id,
          roleType: RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER,
          userId: l1.id,
        },
      },
      update: {},
      create: {
        departmentId: dept.id,
        roleType: RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER,
        userId: l1.id,
        assignedById: budgetOfficer.id,
      },
    });
    await prisma.roleAssignment.upsert({
      where: {
        departmentId_roleType_userId: {
          departmentId: dept.id,
          roleType: RoleType.CENTRALIZED_DEPARTMENT_HEAD,
          userId: head.id,
        },
      },
      update: {},
      create: {
        departmentId: dept.id,
        roleType: RoleType.CENTRALIZED_DEPARTMENT_HEAD,
        userId: head.id,
        assignedById: budgetOfficer.id,
      },
    });

    centralizedUsers[deptName] = { preparer, l1, head };
  }

  // HR Analyst — owns Additional Headcount Request's middle review step and
  // is the sole user of the Manpower Budgeting module. "HR Head" for both
  // workflows reuses Human Resources' CENTRALIZED_DEPARTMENT_HEAD above.
  const hrAnalyst = await prisma.user.upsert({
    where: { email: "hr.analyst@ortigas.com.ph" },
    update: { passwordHash },
    create: {
      name: "Hannah Analyst",
      email: "hr.analyst@ortigas.com.ph",
      departmentId: byName["Human Resources"].id,
      passwordHash,
    },
  });
  await prisma.roleAssignment.upsert({
    where: {
      departmentId_roleType_userId: {
        departmentId: byName["Human Resources"].id,
        roleType: RoleType.HR_ANALYST,
        userId: hrAnalyst.id,
      },
    },
    update: {},
    create: {
      departmentId: byName["Human Resources"].id,
      roleType: RoleType.HR_ANALYST,
      userId: hrAnalyst.id,
      assignedById: budgetOfficer.id,
    },
  });

  await prisma.roleAssignment.upsert({
    where: {
      departmentId_roleType_userId: {
        departmentId: byName["Corporate Finance"].id,
        roleType: RoleType.BCA_HEAD,
        userId: bcaHead.id,
      },
    },
    update: {},
    create: {
      departmentId: byName["Corporate Finance"].id,
      roleType: RoleType.BCA_HEAD,
      userId: bcaHead.id,
      assignedById: budgetOfficer.id,
    },
  });
  await prisma.roleAssignment.upsert({
    where: {
      departmentId_roleType_userId: {
        departmentId: byName["Corporate Finance"].id,
        roleType: RoleType.BUDGET_OFFICER,
        userId: budgetOfficer.id,
      },
    },
    update: {},
    create: {
      departmentId: byName["Corporate Finance"].id,
      roleType: RoleType.BUDGET_OFFICER,
      userId: budgetOfficer.id,
      assignedById: budgetOfficer.id,
    },
  });

  // Real expense line item catalog (Company rows + ~230 ExpenseLineItem rows
  // with category/company/GL-CC/additional-field parsing). Re-runnable as
  // the source file grows.
  await importExpenseLineItems(prisma, budgetOfficer.id);

  await prisma.growthRateConfig.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", defaultValue: 5, editedBy: budgetOfficer.id },
  });

  await prisma.growthRateOverride.upsert({
    where: { departmentId: byName["IS & IT"].id },
    update: {},
    create: {
      departmentId: byName["IS & IT"].id,
      value: 8,
      editedBy: budgetOfficer.id,
    },
  });

  await prisma.documentationThresholdConfig.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", amount: 100000 },
  });

  for (const label of [
    "Insufficient Documentation",
    "Unrealistic 2026 Forecast",
    "Incorrect Expense Item Selection",
  ]) {
    await prisma.reasonCode.upsert({
      where: { label },
      update: {},
      create: { label },
    });
  }

  // Budget Code prefixes: GAE's Centralized Department abbreviations
  // (import-time fallback only - GAE codes are normally pre-computed in the
  // source catalog file) and NPC's Head-per-SBU abbreviations (used by the
  // NPC request form's Head picker).
  const CENTRALIZED_DEPARTMENT_CODES: [string, string][] = [
    ["Admin Services", "AS"],
    ["Corporate Finance", "CF"],
    ["External Affairs", "EA"],
    ["Human Resources", "HR"],
    ["IS & IT", "IT"],
    ["Legal", "LG"],
    ["Office of the CFO", "CF"],
    ["Tax", "TX"],
    ["Budget, Controls & Analysis", "BCA"],
    ["Corporate Marketing", "CM"],
    ["OMD Operations", "OM"],
    ["Procurement", "PR"],
  ];
  const NPC_HEAD_CODES: [string, string][] = [
    ["Malls GH", "JLC"],
    ["Malls NonGH", "RFT"],
    ["Estates", "BCB"],
    ["Offices", "WPD"],
    ["Corporate IT", "RBQ"],
    ["Corporate HR", "MGM"],
    ["Corporate Admin", "LPA"],
  ];
  for (const [kind, entries] of [
    ["CENTRALIZED_DEPARTMENT", CENTRALIZED_DEPARTMENT_CODES],
    ["NPC_HEAD", NPC_HEAD_CODES],
  ] as const) {
    for (const [label, code] of entries) {
      await prisma.budgetCodePrefix.upsert({
        where: { kind_label: { kind, label } },
        update: { code },
        create: { kind, label, code },
      });
    }
  }

  // Mobile phone rank -> monthly budget-limit tiers (notes item 7). Over the
  // limit for the requestor's rank routes the request through CFO_APPROVAL.
  const existingMobileTiers = await prisma.mobilePhonePolicyTier.count();
  if (existingMobileTiers === 0) {
    await prisma.mobilePhonePolicyTier.createMany({
      data: [
        { minRank: 11, maxRank: 12, budgetLimit: 2500 },
        { minRank: 10, maxRank: 10, budgetLimit: 1800 },
        { minRank: 8, maxRank: 9, budgetLimit: 1499 },
        { minRank: 5, maxRank: 7, budgetLimit: 999 },
        { minRank: 3, maxRank: 4, budgetLimit: 300 },
      ],
    });
  }

  await prisma.fiscalCycleConfig.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", asOfMonth2026: 9, updatedBy: budgetOfficer.id },
  });

  // Historical actuals reference data (SAP stand-in), keyed by department +
  // a synthetic GL-CC for departments without a real catalog entry yet
  // (Corporate Finance, Legal), or a real catalog GL-CC where one exists.
  const historicalRows: {
    department: string;
    glAccount: string;
    costCenter: string;
    glDescription: string;
    actuals2025: number;
    approved2026: number;
    ytd2026: number;
  }[] = [
    { department: "Admin Services", glAccount: "52111101", costCenter: "81123102", glDescription: "Office Supplies - Toner", actuals2025: 300000, approved2026: 320000, ytd2026: 250000 },
    { department: "Admin Services", glAccount: "61111201", costCenter: "80123102", glDescription: "Fuel & Lubricants - Fleet", actuals2025: 450000, approved2026: 500000, ytd2026: 480000 },
    { department: "Corporate Marketing", glAccount: "52551201", costCenter: "81314101", glDescription: "Communications, Branding & Events", actuals2025: 900000, approved2026: 950000, ytd2026: 700000 },
    { department: "Human Resources", glAccount: "81111101", costCenter: "52121401", glDescription: "Company Events", actuals2025: 600000, approved2026: 650000, ytd2026: 400000 },
    { department: "Human Resources", glAccount: "81122101", costCenter: "52121502", glDescription: "Trainings & Seminars", actuals2025: 350000, approved2026: 400000, ytd2026: 300000 },
    { department: "Tax", glAccount: "PENDING", costCenter: "TAX-GEN", glDescription: "Taxes & Licenses", actuals2025: 550000, approved2026: 580000, ytd2026: 400000 },
    { department: "TSG", glAccount: "61041101", costCenter: "80123102", glDescription: "Electricity & Water", actuals2025: 1200000, approved2026: 1250000, ytd2026: 1250000 },
    { department: "Corporate Finance", glAccount: "603100", costCenter: "CC-CF-01", glDescription: "External Audit Fees", actuals2025: 1200000, approved2026: 1250000, ytd2026: 1250000 },
    { department: "Legal", glAccount: "605100", costCenter: "CC-LEG-01", glDescription: "Outside Legal Counsel", actuals2025: 700000, approved2026: 720000, ytd2026: 500000 },
  ];

  for (const row of historicalRows) {
    await prisma.historicalActuals.upsert({
      where: {
        departmentId_glAccount_costCenter_fiscalYear: {
          departmentId: byName[row.department].id,
          glAccount: row.glAccount,
          costCenter: row.costCenter,
          fiscalYear: FISCAL_YEAR,
        },
      },
      update: {},
      create: {
        departmentId: byName[row.department].id,
        glAccount: row.glAccount,
        costCenter: row.costCenter,
        fiscalYear: FISCAL_YEAR,
        glDescription: row.glDescription,
        actuals2025: row.actuals2025,
        approvedBudget2026: row.approved2026,
        ytdActuals2026: row.ytd2026,
      },
    });
  }

  const existingBoardBudget = await prisma.boardApprovedBudget.findFirst({ where: { fiscalYear: FISCAL_YEAR } });
  if (!existingBoardBudget) {
    await prisma.boardApprovedBudget.create({
      data: {
        fiscalYear: FISCAL_YEAR,
        amount: 15000000,
        setBy: budgetOfficer.id,
      },
    });
  }

  // Manpower Budgeting: the 19 fixed pay-component rows from the Manpower
  // workbook. isHeadcountDriven / appliesMeritIncrease / forecastSource per
  // Notes_4's roster-upload rules (Amendment 3) - only Basic Pay, Guaranteed
  // Bonus, and the 3 Government Contributions are auto-filled from the
  // uploaded Manpower Template roster; "Leave Encashment - Excess of 90
  // days" (an Amendment-1-era HR Portal component) is no longer auto-filled
  // and must stay MANUAL so it remains editable in the UI.
  const HR_PORTAL_COMPONENTS = new Set([
    "Basic Pay",
    "Guaranteed Bonus",
    "Government Contributions (ER) - SSS",
    "Government Contributions (ER) - Pag-Ibig",
    "Government Contributions (ER) - Philhealth",
  ]);
  const HEADCOUNT_DRIVEN_COMPONENTS = HR_PORTAL_COMPONENTS;
  // Merit Increase eligibility per the "Manpower Budget Report" tab's ground
  // truth (Notes_6): only the Salary section (Basic Pay, Guaranteed Bonus)
  // is merit-eligible - OT Pay and OT Meal Reimbursement moved to "Other
  // Employee Benefits", which the same file marks "N/A - should be Zero"
  // for Merit Increase (supersedes Amendment 3's wider set that included
  // them), excluding the Outsourced company.
  const MERIT_INCREASE_COMPONENTS = new Set(["Basic Pay", "Guaranteed Bonus"]);

  const payComponentNames = [
    "Basic Pay",
    "Guaranteed Bonus",
    "Leave Encashment - Excess of 90 days",
    "Leave Encashment - Separated Employees",
    "OT Pay",
    "OT Meal Reimbursement",
    "Government Contributions (ER) - SSS",
    "Government Contributions (ER) - Pag-Ibig",
    "Government Contributions (ER) - Philhealth",
    "Gas Allowance",
    "Medical Allowance",
    "Uniform Allowance",
    "Rice Subsidy",
    "OBT Meal",
    "OBT Gas",
    "Accident Insurance",
    "Life Insurance",
    "Medical Exam / Executive Check-up (incl. dependents)",
    "HMO (incl. dependents)",
  ];

  for (let i = 0; i < payComponentNames.length; i++) {
    const name = payComponentNames[i];
    const fields = {
      sortOrder: i,
      isHeadcountDriven: HEADCOUNT_DRIVEN_COMPONENTS.has(name),
      appliesMeritIncrease: MERIT_INCREASE_COMPONENTS.has(name),
      forecastSource: HR_PORTAL_COMPONENTS.has(name) ? ("HR_PORTAL" as const) : ("MANUAL" as const),
    };
    await prisma.payComponent.upsert({
      where: { name },
      // Re-seeding must converge these flags to the current rule sets above
      // (e.g. Amendment 3 changed which components are merit-eligible) -
      // an empty `update` would silently leave stale flags on existing rows.
      update: fields,
      create: { name, ...fields },
    });
  }

  await prisma.manpowerBudgetSubmission.upsert({
    where: { fiscalYear: FISCAL_YEAR },
    update: {},
    create: { fiscalYear: FISCAL_YEAR },
  });

  // Notes_4: single global Merit Increase Rate (Budget Officer/HR Analyst
  // editable), replacing the old per-cell rate.
  await prisma.manpowerMeritRateConfig.upsert({
    where: { fiscalYear: FISCAL_YEAR },
    update: {},
    create: { fiscalYear: FISCAL_YEAR, ratePercent: 0 },
  });

  // Global (non-per-department) stage due dates — Notes_2 item 6. Defaults
  // are placeholders spanning the run-up to the 2027 cycle; Budget Officer
  // edits these via the admin console.
  const stageDueDates: { stage: string; dueDate: string }[] = [
    { stage: "FINALIZE_FORECAST", dueDate: "2026-09-15" },
    { stage: "REQUEST_AND_AUTHORIZATION", dueDate: "2026-09-30" },
    { stage: "CENTRALIZED_L1_REVIEW", dueDate: "2026-10-15" },
    { stage: "CENTRALIZED_HEAD_REVIEW", dueDate: "2026-10-31" },
    { stage: "BCA_AND_FINALIZATION", dueDate: "2026-11-15" },
  ];
  for (const s of stageDueDates) {
    await prisma.workflowStageConfig.upsert({
      where: { stage: s.stage as any },
      update: {},
      create: { stage: s.stage as any, dueDate: new Date(s.dueDate), configuredBy: budgetOfficer.id },
    });
  }

  // Real employee directory (Notes_2 item 4) — the pool the Budget Officer
  // assigns roles from.
  await importEmployees(prisma);

  // Notes_2 item 5: "Assign the Budget Officer role to me, Princess Vera P.
  // Jumalon." She's employee #2409969 in the real list; her real email
  // (from this session's context) replaces the synthesized one.
  const princess = await prisma.user.update({
    where: { employeeIdNumber: 2409969 },
    data: { email: "jumalonpvp@ortigas.com.ph", departmentId: byName["Corporate Finance"].id },
  });
  await prisma.roleAssignment.upsert({
    where: {
      departmentId_roleType_userId: {
        departmentId: byName["Corporate Finance"].id,
        roleType: RoleType.BUDGET_OFFICER,
        userId: princess.id,
      },
    },
    update: {},
    create: {
      departmentId: byName["Corporate Finance"].id,
      roleType: RoleType.BUDGET_OFFICER,
      userId: princess.id,
      assignedById: budgetOfficer.id,
    },
  });

  console.log("Seed complete.");
  console.log("Demo users:");
  console.log(`  Budget Officer:            ${budgetOfficer.email}`);
  console.log(`  BC&A Head:                 ${bcaHead.email}`);
  console.log(`  CFO:                       ${cfo.email}`);
  console.log(`  HR Analyst:                ${hrAnalyst.email}`);
  for (const [name, u] of Object.entries(requestingUsers)) {
    console.log(`  ${name} Requestor:         ${u.requestor.email}`);
    console.log(`  ${name} Dept Head:         ${u.head.email}`);
  }
  for (const [name, u] of Object.entries(centralizedUsers)) {
    console.log(`  ${name} Preparer:          ${u.preparer.email}`);
    console.log(`  ${name} L1 Reviewer:       ${u.l1.email}`);
    console.log(`  ${name} Centralized Head:  ${u.head.email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
