import { useState } from "react";
import { downloadFile, SBU_OPTIONS, type Sbu } from "../api/client";

const SECTIONS = [
  { key: "PL", label: "Consolidated P&L" },
  { key: "NPC", label: "NPC" },
] as const;
const MEASURES = [
  { key: "BOARD", label: "Board-Approved" },
  { key: "FINALIZED", label: "Total Finalized" },
  { key: "VARIANCE", label: "Board-Approved vs Total Finalized" },
] as const;

// "Generate Report" for the Board-Approved Budget vs. Total Finalized table:
// pick the sections, the figures and one SBU (or all), then download the
// Excel built by /budget-requests/finalized-budget-report/board-check-export.
export function BoardCheckReportPanel({ fiscalYear }: { fiscalYear: number }) {
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<Set<string>>(new Set(["PL", "NPC"]));
  const [measures, setMeasures] = useState<Set<string>>(new Set(["BOARD", "FINALIZED", "VARIANCE"]));
  const [sbu, setSbu] = useState<Sbu | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    const qs = new URLSearchParams({
      fiscalYear: String(fiscalYear),
      sections: SECTIONS.filter((x) => sections.has(x.key)).map((x) => x.key).join(","),
      measures: MEASURES.filter((x) => measures.has(x.key)).map((x) => x.key).join(","),
    });
    if (sbu) qs.set("sbu", sbu);
    const sbuLabel = sbu ? ` - ${SBU_OPTIONS.find((o) => o.value === sbu)?.label}` : "";
    try {
      await downloadFile(`/budget-requests/finalized-budget-report/board-check-export?${qs.toString()}`, `Board-Approved vs Total Finalized - ${fiscalYear}${sbuLabel}.xlsx`);
    } catch {
      setError("Failed to generate the report.");
    } finally {
      setBusy(false);
    }
  };

  const checkbox = (checked: boolean, onChange: () => void, label: string) => (
    <label key={label} className="flex items-center gap-1.5 text-xs text-slate-700">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
      >
        Generate Report
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg">
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-600">Include</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">{SECTIONS.map((x) => checkbox(sections.has(x.key), () => toggle(sections, setSections, x.key), x.label))}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-600">Columns</div>
            <div className="flex flex-col gap-1">{MEASURES.map((x) => checkbox(measures.has(x.key), () => toggle(measures, setMeasures, x.key), x.label))}</div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">SBU</label>
            <select value={sbu} onChange={(e) => setSbu(e.target.value as Sbu | "")} className="w-full rounded border border-slate-300 px-2 py-1 text-xs">
              <option value="">All SBUs</option>
              {SBU_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {sbu === "CORPORATE" && <div className="mt-1 text-[11px] text-slate-500">For NPC, Corporate covers Corporate Admin, HR and IT.</div>}
          </div>
          {error && <div className="text-xs text-red-600">{error}</div>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:text-slate-700">
              Close
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={busy || sections.size === 0 || measures.size === 0}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {busy ? "Generating…" : "Download Excel"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
