import { Router } from "express";
import ExcelJS from "exceljs";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../httpError";
import { submitRequest } from "../services/workflowService";

export const bulkUploadRouter = Router();

bulkUploadRouter.use(requireAuth);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HEADER = ["Expense Line Item", ...MONTHS, "Business Justification", "Other Required Fields (JSON)"];

// Bulk upload is capped well below the exceljs/archiver DoS advisory's blast
// radius (see plan notes) — small spreadsheets only, never arbitrary blobs.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

bulkUploadRouter.get(
  "/bulk-upload/template",
  asyncHandler(async (req, res) => {
    const fiscalYear = Number(req.query.fiscalYear ?? 2027);
    const items = await prisma.expenseLineItem.findMany({ where: { status: "STANDARD" }, orderBy: { name: "asc" } });

    const workbook = new ExcelJS.Workbook();
    const refSheet = workbook.addWorksheet("Reference", { state: "veryHidden" });
    items.forEach((item, i) => {
      refSheet.getCell(i + 1, 1).value = item.name;
    });

    const sheet = workbook.addWorksheet(`Budget Requests ${fiscalYear}`);
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
    res.setHeader("Content-Disposition", `attachment; filename="budget-request-template-${fiscalYear}.xlsx"`);
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
    const departmentId = req.user!.departmentId;
    if (!departmentId) throw new HttpError(400, "Your account has no assigned department.");

    const fiscalYear = Number(req.body.fiscalYear ?? 2027);

    const workbook = new ExcelJS.Workbook();
    // exceljs's bundled Buffer type predates the current @types/node Buffer
    // generic; the value itself is a plain Node Buffer at runtime.
    await workbook.xlsx.load(req.file.buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets.find((w) => w.state !== "veryHidden");
    if (!sheet) throw new HttpError(400, "No usable worksheet found in the uploaded file.");

    const standardItems = await prisma.expenseLineItem.findMany({ where: { status: "STANDARD" } });
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
          throw new Error("2027 Proposed Amount must be greater than 0.");
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

        const requestRecord = await prisma.budgetRequest.create({
          data: {
            departmentId,
            fiscalYear,
            expenseLineItemId: lineItem.id,
            monthlyAmounts,
            proposedAmount,
            businessJustification,
            otherRequiredFields,
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
