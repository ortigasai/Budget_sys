import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, downloadFile, type Department } from "../../api/client";
import { useFiscalYear } from "../../lib/fiscalCycle";

interface ForecastUploadResult {
  created: number;
  updated: number;
  errors?: { row: number; error: string }[];
}

interface LastUpload {
  uploadedAt: string;
  fileName: string;
  uploadedByName: string;
  created: number;
  updated: number;
  skipped: number;
}

// The GAE Forecast's Approved Budget / YTD Actuals / Remaining Months
// Forecast workbook - one company-wide file covering every department,
// uploaded by the Budget Officer here (moved off the Forecast page, same as
// the NPC Monitoring Import). Rows that validate are imported even when
// others don't; the skipped ones are listed with the reason.
export function GaeForecastImportTab() {
  const { forecastYear, targetYear } = useFiscalYear();
  const queryClient = useQueryClient();

  const { data: lastUpload } = useQuery({
    queryKey: ["admin", "gae-forecast-upload-status"],
    queryFn: async () => (await api.get<LastUpload | null>("/admin/historical-actuals/upload-status")).data,
  });

  const [uploadStatus, setUploadStatus] = useState<{ ok: boolean; message: string; errors?: { row: number; error: string }[] } | null>(null);
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return (await api.post<ForecastUploadResult>("/admin/historical-actuals/upload", form)).data;
    },
    onSuccess: (data) => {
      const skipped = data.errors?.length ?? 0;
      setUploadStatus({
        ok: true,
        message: `Uploaded: ${data.created} created, ${data.updated} updated.${skipped > 0 ? ` ${skipped} row(s) skipped.` : ""}`,
        errors: data.errors,
      });
      queryClient.invalidateQueries({ queryKey: ["forecast"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "gae-forecast-upload-status"] });
    },
    onError: (err: any) => setUploadStatus({ ok: false, message: err.response?.data?.error ?? "Upload failed." }),
  });

  // The pre-filled per-department template only exists from the 2027 cycle on.
  const { data: departments = [] } = useQuery({
    queryKey: ["forecast", "eligible-departments"],
    queryFn: async () => (await api.get<Department[]>("/forecast/eligible-departments")).data,
    enabled: targetYear >= 2027,
  });
  const [templateDeptId, setTemplateDeptId] = useState("");

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="text-sm">
          <div className="font-semibold text-slate-700">Upload GAE Forecast Workbook</div>
          <div className="text-xs text-slate-500">
            One workbook covering every department: Approved Budget, the monthly Actuals (Jan to the as-of month), YTD Actuals and the {forecastYear} Remaining Months Forecast per expense line item. The monthly Actuals are saved as uploaded and printed back on Open Template. Rows that match the catalog are imported (new rows created, existing ones updated); any that don't are listed below with the reason. Results show on the Forecast page.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {targetYear >= 2027 && (
            <div className="flex flex-wrap items-center gap-2">
              <select value={templateDeptId} onChange={(e) => setTemplateDeptId(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                <option value="">Choose a department…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!templateDeptId}
                onClick={() => {
                  const dept = departments.find((d) => d.id === templateDeptId);
                  downloadFile(`/forecast/${templateDeptId}/template?category=GAE`, `forecast-template-gae-${(dept?.name ?? "department").replace(/\s+/g, "-").toLowerCase()}.xlsx`).catch(() =>
                    setUploadStatus({ ok: false, message: "Failed to download the template." })
                  );
                }}
                className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              >
                Open Template
              </button>
            </div>
          )}
          <label className="cursor-pointer rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600">
            {uploadMutation.isPending ? "Uploading…" : "Upload Completed Template (.xlsx)"}
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              disabled={uploadMutation.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploadStatus(null);
                uploadMutation.mutate(file);
              }}
            />
          </label>
        </div>

        {uploadStatus && (
          <div className="text-xs">
            <span className={uploadStatus.ok ? "text-emerald-700" : "text-red-600"}>{uploadStatus.message}</span>
            {uploadStatus.errors && uploadStatus.errors.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-slate-500">See skipped rows</summary>
                <ul className="mt-1 max-h-60 max-w-2xl list-disc space-y-0.5 overflow-auto pl-4 text-slate-600">
                  {uploadStatus.errors.map((e, i) => (
                    <li key={i}>
                      Row {e.row}: {e.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
        <div className="mb-1 font-semibold text-slate-700">Last Upload</div>
        {lastUpload ? (
          <div className="text-slate-600">
            <span className="font-mono">{lastUpload.fileName}</span>, uploaded {new Date(lastUpload.uploadedAt).toLocaleString()} by {lastUpload.uploadedByName} - {lastUpload.created} created, {lastUpload.updated} updated
            {lastUpload.skipped > 0 ? `, ${lastUpload.skipped} skipped` : ""}.
          </div>
        ) : (
          <div className="text-slate-400">No GAE Forecast workbook has been uploaded here yet.</div>
        )}
      </div>
    </div>
  );
}
