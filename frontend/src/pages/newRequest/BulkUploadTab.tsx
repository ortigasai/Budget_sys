import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";

interface BulkUploadResult {
  batch: { id: string; rowCount: number; status: string };
  created: number;
  errors: { row: number; error: string }[];
}

const FISCAL_YEAR = 2027;

export function BulkUploadTab() {
  const [result, setResult] = useState<BulkUploadResult | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("fiscalYear", String(FISCAL_YEAR));
      return (await api.post<BulkUploadResult>("/budget-requests/bulk-upload", form)).data;
    },
    onSuccess: setResult,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
        Download the template, fill in your requests offline, then upload it here. Rows follow the same
        validation rules as manually created requests — a bad row is rejected individually and doesn't block the
        rest of the batch.
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <a
          href={`/api/budget-requests/bulk-upload/template?fiscalYear=${FISCAL_YEAR}`}
          className="inline-block rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
        >
          Download {FISCAL_YEAR} Template (.xlsx)
        </a>

        <label className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
          Upload completed template
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && uploadMutation.mutate(e.target.files[0])}
          />
        </label>
      </div>

      {uploadMutation.isPending && <div className="text-sm text-slate-500">Processing…</div>}

      {result && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="inline-block rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-800">
            {result.created} of {result.batch.rowCount} row(s) created successfully
          </div>
          {result.errors.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-red-700">Row errors:</div>
              <ul className="list-inside list-disc text-red-700">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
