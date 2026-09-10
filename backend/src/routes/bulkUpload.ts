import { Router } from "express";
import ExcelJS from "exceljs";
import multer from "multer";
import { Prisma, RequestCategory, Sbu } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../httpError";
import { assertCycleOpen, submitRequest } from "../services/workflowService";
import { getFiscalCycle } from "../lib/fiscalCycle";
import { nextBudgetCode, sbuBudgetCodePrefix } from "../lib/budgetCode";
import { NPC_LOCATION_VALUES, NPC_SBU_VALUES, npcSbuBudgetCodePrefix, type NpcLocation, type NpcSbu } from "../lib/npcSbu";

export const bulkUploadRouter = Router();

bulkUploadRouter.use(requireAuth);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HEADER = ["Expense Line Item", ...MONTHS, "Business Justification", "Other Required Fields (JSON)"];

// Bulk upload is capped well below the exceljs/archiver DoS advisory's blast
// radius (see plan notes) — small spreadsheets only, never arbitrary blobs.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Note 11 §6 - "Open Spreadsheet Template" for GAE/DOE (spec's other two
// categories, NPC and Revenue, have their own distinct shapes - see
// routes/npcTemplate.ts and revenueTemplate.ts respectively). `category`
// defaults to GAE (this route predates Note 11 and only ever produced GAE
// requests); DOE additionally requires `sbu`, tagged onto every row created
// from this same sheet (one sheet -> one department -> one SBU, same as
// Revenue's per-batch SBU). The line item list is filtered to this
// requestor's own visible catalog (Notes_7), same rule StandardRequestTab.tsx
// applies client-side for the manual form.
async function visibleLineItemsForRequest(departmentId: string) {
  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  const applyVisibilityFilter = department?.name !== "Budget";
  return prisma.expenseLineItem.findMany({
    where: {
      status: "STANDARD",
      category: { not: "Manpower - Salary" },
      ...(applyVisibilityFilter ? { OR: [{ visibleToDepartmentId: null }, { visibleToDepartmentId: departmentId }] } : {}),
    },
    orderBy: { name: "asc" },
  });
}

bulkUploadRouter.get(
  "/bulk-upload/template",
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);
    const category = (req.query.category as string | undefined) === "DOE" ? RequestCategory.DOE : RequestCategory.GAE;
    const sbu = req.query.sbu as string | undefined;
    if (category === RequestCategory.DOE && !sbu) {
      throw new HttpError(400, "Select an SBU before downloading the DOE template.");
    }
    const departmentId = req.user!.departmentId;
    if (!departmentId) throw new HttpError(400, "Your account has no assigned department.");

    const items = await visibleLineItemsForRequest(departmentId);

    const workbook = new ExcelJS.Workbook();
    const refSheet = workbook.addWorksheet("Reference", { state: "veryHidden" });
    items.forEach((item, i) => {
      refSheet.getCell(i + 1, 1).value = item.name;
    });

    const sheetTitle = category === RequestCategory.DOE ? `${sbu} DOE Requests ${fiscalYear}` : `Budget Requests ${fiscalYear}`;
    const sheet = workbook.addWorksheet(sheetTitle.slice(0, 31));
    sheet.addRow(HEADER);
    sheet.getRow(1).font = { bold: true };

    for (let row = 2; row <= 201; row++) {
      sheet.getCell(`A${row}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`Reference!$A$1:$A$${items.length}`],
      };
    }

    sheet.columns.forEach((col) => {
      col.width = 20;
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="budget-request-template-${category.toLowerCase()}-${fiscalYear}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

interface RowError {
  row: number;
  error: string;
}

bulkUploadRouter.post(
  "/bulk-upload",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded.");
    await assertCycleOpen();
    const departmentId = req.user!.departmentId;
    if (!departmentId) throw new HttpError(400, "Your account has no assigned department.");

    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.body.fiscalYear ?? targetCalendarYear);
    const category = req.body.category === "DOE" ? RequestCategory.DOE : RequestCategory.GAE;
    let sbu: Sbu | undefined;
    if (category === RequestCategory.DOE) {
      if (!Object.values(Sbu).includes(req.body.sbu)) {
        throw new HttpError(400, "Select a valid SBU for this DOE upload.");
      }
      sbu = req.body.sbu as Sbu;
    }

    const workbook = new ExcelJS.Workbook();
    // exceljs's bundled Buffer type predates the current @types/node Buffer
    // generic; the value itself is a plain Node Buffer at runtime.
    await workbook.xlsx.load(req.file.buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets.find((w) => w.state !== "veryHidden");
    if (!sheet) throw new HttpError(400, "No usable worksheet found in the uploaded file.");

    const standardItems = await visibleLineItemsForRequest(departmentId);
    const itemsByName = new Map(standardItems.map((i) => [i.name.trim().toLowerCase(), i]));

    const batch = await prisma.bulkUploadBatch.create({
      data: {
        uploadedById: req.user!.id,
        departmentId,
        fiscalYear,
        sourceFileRef: req.file.originalname,
        rowCount: 0,
        status: "PROCESSING",
      },
    });

    const errors: RowError[] = [];
    let created = 0;
    let rowCount = 0;

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const lineItemName = String(row.getCell(1).value ?? "").trim();
      if (!lineItemName) continue; // blank row, not counted

      rowCount++;

      try {
        const lineItem = itemsByName.get(lineItemName.toLowerCase());
        if (!lineItem) {
          throw new Error(`Expense line item "${lineItemName}" is not in the standard catalog.`);
        }

        const monthlyAmounts: number[] = [];
        for (let m = 0; m < 12; m++) {
          const raw = row.getCell(2 + m).value;
          const num = Number(raw ?? 0);
          if (Number.isNaN(num) || num < 0) {
            throw new Error(`${MONTHS[m]} amount must be a non-negative number.`);
          }
          monthlyAmounts.push(num);
        }
        const proposedAmount = monthlyAmounts.reduce((a, b) => a + b, 0);
        if (proposedAmount <= 0) {
          throw new Error(`${targetCalendarYear} Proposed Amount must be greater than 0.`);
        }

        const businessJustification = String(row.getCell(14).value ?? "").trim();
        if (!businessJustification) {
          throw new Error("Business Justification is mandatory.");
        }

        let otherRequiredFields: Record<string, string> = {};
        const rawOther = row.getCell(15).value;
        if (rawOther) {
          try {
            otherRequiredFields = JSON.parse(String(rawOther));
          } catch {
            throw new Error("Other Required Fields (JSON) column is not valid JSON.");
          }
        }
        const extraFieldsConfig = (lineItem.extraFieldsConfig as { label: string; required: boolean }[]) ?? [];
        for (const field of extraFieldsConfig) {
          if (field.required && !otherRequiredFields[field.label]?.trim()) {
            throw new Error(`Field "${field.label}" is required for "${lineItem.name}".`);
          }
        }

        // DOE gets a fresh Budget Code per row, same as one manual DOE
        // submission via the Save Draft form (lib/budgetCode.ts) - this
        // sheet is many independent DOE requests, not one batch total.
        const budgetCode = sbu ? await nextBudgetCode(sbuBudgetCodePrefix(sbu), targetCalendarYear) : undefined;

        const requestRecord = await prisma.budgetRequest.create({
          data: {
            departmentId,
            fiscalYear,
            expenseLineItemId: lineItem.id,
            monthlyAmounts,
            proposedAmount,
            businessJustification,
            otherRequiredFields,
            requestCategory: category,
            sbu,
            budgetCode,
            createdById: req.user!.id,
            bulkUploadBatchId: batch.id,
          },
        });

        try {
          await submitRequest(requestRecord.id);
        } catch (submitErr) {
          // Attachment-threshold rows can't auto-submit (no attachment
          // mechanism in the spreadsheet) — leave as a draft the Requestor
          // finishes manually rather than failing the whole row.
          if (!(submitErr instanceof HttpError) || !submitErr.message.includes("attachments")) {
            throw submitErr;
          }
        }

        created++;
      } catch (err) {
        errors.push({ row: rowNumber, error: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    const status = errors.length === 0 ? "COMPLETED" : created > 0 ? "COMPLETED_WITH_ERRORS" : "FAILED";
    const updatedBatch = await prisma.bulkUploadBatch.update({
      where: { id: batch.id },
      data: { rowCount, validationErrors: errors as unknown as Prisma.InputJsonValue, status },
    });

    res.status(201).json({ batch: updatedBatch, created, errors });
  })
);

// Note 11 §6 - NPC's "Open Spreadsheet Template". NPC's required-fields set
// is entirely different from GAE/DOE (spec item 12 - no expense line item
// picker, spend grid, or Business Justification; see NpcRequestTab.tsx/
// budgetRequestsRouter's NPC branch), so this is its own sheet shape, not a
// variant of the one above. `npcSbu` and fiscal year are one-per-sheet
// (passed at download and re-supplied at upload), like DOE's `sbu` above;
// Location and every other field are per-row.
const NPC_HEADER = ["Location", "Project Title", "Project Start (YYYY-MM-DD)", "Project End (YYYY-MM-DD)", "Cost Center", "Amount (VAT exclusive)"];

bulkUploadRouter.get(
  "/npc-template",
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);
    const npcSbu = req.query.npcSbu as string | undefined;
    if (!npcSbu || !(NPC_SBU_VALUES as readonly string[]).includes(npcSbu)) {
      throw new HttpError(400, "Select a valid NPC SBU before downloading the template.");
    }

    const workbook = new ExcelJS.Workbook();
    const refSheet = workbook.addWorksheet("Reference", { state: "veryHidden" });
    NPC_LOCATION_VALUES.forEach((loc, i) => {
      refSheet.getCell(i + 1, 1).value = loc;
    });

    const sheet = workbook.addWorksheet(`${npcSbu} NPC Requests ${fiscalYear}`.slice(0, 31));
    sheet.addRow(NPC_HEADER);
    sheet.getRow(1).font = { bold: true };

    for (let row = 2; row <= 201; row++) {
      sheet.getCell(`A${row}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`Reference!$A$1:$A$${NPC_LOCATION_VALUES.length}`],
      };
      sheet.getCell(`C${row}`).numFmt = "yyyy-mm-dd";
      sheet.getCell(`D${row}`).numFmt = "yyyy-mm-dd";
      sheet.getCell(`F${row}`).numFmt = "#,##0.00";
    }
    sheet.columns.forEach((col) => {
      col.width = 22;
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="npc-request-template-${npcSbu.toLowerCase()}-${fiscalYear}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

bulkUploadRouter.post(
  "/npc-template-upload",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded.");
    await assertCycleOpen();
    const departmentId = req.user!.departmentId;
    if (!departmentId) throw new HttpError(400, "Your account has no assigned department.");

    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.body.fiscalYear ?? targetCalendarYear);
    const npcSbu = req.body.npcSbu as string | undefined;
    if (!npcSbu || !(NPC_SBU_VALUES as readonly string[]).includes(npcSbu)) {
      throw new HttpError(400, "Select a valid NPC SBU for this upload.");
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets.find((w) => w.state !== "veryHidden");
    if (!sheet) throw new HttpError(400, "No usable worksheet found in the uploaded file.");

    const batch = await prisma.bulkUploadBatch.create({
      data: {
        uploadedById: req.user!.id,
        departmentId,
        fiscalYear,
        sourceFileRef: req.file.originalname,
        rowCount: 0,
        status: "PROCESSING",
      },
    });

    const errors: RowError[] = [];
    let created = 0;
    let rowCount = 0;

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const projectTitle = String(row.getCell(2).value ?? "").trim();
      if (!projectTitle) continue; // blank row, not counted

      rowCount++;

      try {
        const location = String(row.getCell(1).value ?? "").trim();
        if (!(NPC_LOCATION_VALUES as readonly string[]).includes(location)) {
          throw new Error(`Location "${location}" is not one of ${NPC_LOCATION_VALUES.join("/")}.`);
        }
        const startRaw = row.getCell(3).value;
        const endRaw = row.getCell(4).value;
        const projectStartDate = startRaw instanceof Date ? startRaw : new Date(String(startRaw ?? ""));
        const projectEndDate = endRaw instanceof Date ? endRaw : new Date(String(endRaw ?? ""));
        if (Number.isNaN(projectStartDate.getTime()) || Number.isNaN(projectEndDate.getTime())) {
          throw new Error("Project Start and Project End must be valid dates.");
        }
        const costCenter = String(row.getCell(5).value ?? "").trim();
        if (!costCenter) throw new Error("Cost Center is mandatory.");
        const amount = Number(row.getCell(6).value ?? 0);
        if (Number.isNaN(amount) || amount <= 0) throw new Error("Amount must be a positive number.");

        const budgetCode = await nextBudgetCode(npcSbuBudgetCodePrefix(npcSbu as NpcSbu), targetCalendarYear);
        const expenseLineItem = await prisma.expenseLineItem.create({
          data: {
            name: projectTitle,
            glAccount: "PENDING",
            costCenter,
            category: "Non-Project Capex",
            ownerDepartmentId: departmentId,
            isCustom: true,
            status: "PENDING_REFINEMENT",
          },
        });
        const monthlyAmounts = Array(12).fill(0);
        monthlyAmounts[0] = amount;

        const requestRecord = await prisma.budgetRequest.create({
          data: {
            departmentId,
            fiscalYear,
            expenseLineItemId: expenseLineItem.id,
            monthlyAmounts,
            proposedAmount: amount,
            businessJustification: `NPC Project: ${projectTitle}`,
            otherRequiredFields: {},
            requestCategory: "NPC",
            npcSbu,
            npcLocation: location as NpcLocation,
            projectTitle,
            projectStartDate,
            projectEndDate,
            budgetCode,
            createdById: req.user!.id,
            bulkUploadBatchId: batch.id,
          },
        });

        try {
          await submitRequest(requestRecord.id);
        } catch (submitErr) {
          if (!(submitErr instanceof HttpError) || !submitErr.message.includes("attachments")) {
            throw submitErr;
          }
        }

        created++;
      } catch (err) {
        errors.push({ row: rowNumber, error: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    const status = errors.length === 0 ? "COMPLETED" : created > 0 ? "COMPLETED_WITH_ERRORS" : "FAILED";
    const updatedBatch = await prisma.bulkUploadBatch.update({
      where: { id: batch.id },
      data: { rowCount, validationErrors: errors as unknown as Prisma.InputJsonValue, status },
    });

    res.status(201).json({ batch: updatedBatch, created, errors });
  })
);
