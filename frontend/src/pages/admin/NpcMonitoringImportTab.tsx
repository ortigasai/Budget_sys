import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api2 } from "../../api/client";
import { useFiscalYear } from "../../lib/fiscalCycle";

interface NpcMonitoringStatus {
  fiscalYear: number;
  sourceFile: string | null;
  importedAt: string | null;
  projectCount: number;
  ioCount: number;
}

interface NpcMonitoringUploadResult {
  sourceFile: string;
  fiscalYear: number;
  projectCount: number;
  ioCount: number;
  projectsBySbu: Record<string, number>;
  skippedAdmin: boolean;
}

// See app/import_npc_monitoring.py's own docstring (backend-py) - 2026's
// real NPC Budget/IO Budget/IO Actual comes from the user's own NPC
// Monitoring workbook (refreshed monthly), not this app's live workflow
// tables or the SAP broker. Re-running that script used to require shell
// access; this lets a Budget Officer do the same "override the file
// initially uploaded" re-import straight from the Admin Console.
export function NpcMonitoringImportTab() {
  const { forecastYear } = useFiscalYear();
  const [fiscalYear, setFiscalYear] = useState(forecastYear);
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ["admin", "npc-monitoring", "status", fiscalYear],
    queryFn: async () => (await api2.get<NpcMonitoringStatus>("/admin/npc-monitoring/status", { params: { fiscalYear } })).data,
  });

  const [uploadResult, setUploadResult] = useState<{ ok: boolean; message: string; bySbu?: Record<string, number> } | null>(null);
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("fiscalYear", String(fiscalYear));
      return (await api2.post<NpcMonitoringUploadResult>("/admin/npc-monitoring/upload", form)).data;
    },
    onSuccess: (data) => {
      setUploadResult({
        ok: true,
        message: `Uploaded ${data.sourceFile}: ${data.projectCount} project(s), ${data.ioCount} IO(s) for fiscal year ${data.fiscalYear}.`,
        bySbu: data.projectsBySbu,
      });
      queryClient.invalidateQueries({ queryKey: ["admin", "npc-monitoring", "status", fiscalYear] });
      queryClient.invalidateQueries({ queryKey: ["forecast", "npc"] });
      queryClient.invalidateQueries({ queryKey: ["utilization", "npc"] });
    },
    onError: (err: any) => setUploadResult({ ok: false, message: err.response?.data?.detail ?? "Upload failed." }),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="text-sm">
          <div className="font-semibold text-slate-700">Upload NPC Monitoring Workbook</div>
          <div className="text-xs text-slate-500">
            Replaces every NPC Budget/IO Budget/IO Actual figure for the fiscal year below with what's in the uploaded workbook - the same "NPC Monitoring" file already emailed around monthly (a "Monitoring" tab, plus one tab per SBU). This overrides whatever was uploaded before for that year.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">Fiscal Year</label>
            <input
              type="number"
              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
              value={fiscalYear}
              onChange={(e) => setFiscalYear(Number(e.target.value))}
            />
          </div>
          <label className="cursor-pointer rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600">
            {uploadMutation.isPending ? "Uploading…" : "Upload Workbook (.xlsx)"}
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              disabled={uploadMutation.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploadResult(null);
                uploadMutation.mutate(file);
              }}
            />
          </label>
        </div>

        {uploadResult && (
          <div className={`text-xs ${uploadResult.ok ? "text-emerald-700" : "text-red-600"}`}>
            {uploadResult.message}
            {uploadResult.bySbu && (
              <span className="ml-1 text-slate-500">
                (
                {Object.entries(uploadResult.bySbu)
                  .map(([sbu, count]) => `${sbu}: ${count}`)
                  .join(", ")}
                )
              </span>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
        <div className="mb-1 font-semibold text-slate-700">Currently Loaded — Fiscal Year {fiscalYear}</div>
        {status && status.sourceFile ? (
          <div className="text-slate-600">
            <span className="font-mono">{status.sourceFile}</span>, imported {new Date(status.importedAt!).toLocaleString()} — {status.projectCount} project(s), {status.ioCount} IO(s).
          </div>
        ) : (
          <div className="text-slate-400">No NPC Monitoring data has been uploaded for this fiscal year yet.</div>
        )}
      </div>
    </div>
  );
}
