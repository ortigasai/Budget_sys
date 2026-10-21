import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";

interface CompanyTotals {
  fiscalYear: number;
  gae: { departmentCount: number; cap: number; actualsYtd2026: number; remainingForecast2026: number; portalRequests: number; remainingPool: number; boardApproved: number | null };
  npc: { boardApproved: number | null; approved: number; proposed: number; requestCount: number; available: number };
}

const peso = (n: number) => (n < 0 ? `(${Math.round(-n).toLocaleString()})` : Math.round(n).toLocaleString());

const TONES = {
  slate: "border-slate-200 bg-slate-50 text-slate-800",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-700",
};

function Tile({ label, value, tone, note, link }: { label: string; value: string; tone: keyof typeof TONES; note?: string; link?: { to: string; label: string } }) {
  return (
    <div className={`rounded-lg border p-3 ${TONES[tone]}`}>
      <div className="text-xs font-semibold tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
      {note && <div className="mt-1.5 text-[11px] leading-snug text-slate-500">{note}</div>}
      {link && (
        <Link to={link.to} className="mt-1.5 inline-block text-[11px] font-semibold text-emerald-700 hover:underline">
          {link.label} →
        </Link>
      )}
    </div>
  );
}

// The Budget Officer's Home page: company-wide GAE and NPC totals (see
// GET /dashboard/totals) in place of a single department's Cap & Pool card.
export function CompanyTotalsWidget({ fiscalYear }: { fiscalYear: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "totals", fiscalYear],
    queryFn: async () => (await api.get<CompanyTotals>("/dashboard/totals", { params: { fiscalYear } })).data,
  });
  if (isLoading || !data) return <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">Loading…</div>;
  const { gae, npc } = data;
  const npcRequests = npc.approved + npc.proposed;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Total GAE - Budget Cap &amp; Pool</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile
            label={`${fiscalYear} GAE Budget Cap`}
            value={peso(gae.cap)}
            tone="slate"
            note={`${gae.departmentCount} centralized departments: (${peso(gae.actualsYtd2026)} YTD Actuals + ${peso(gae.remainingForecast2026)} Remaining Forecast) x each department's growth rate`}
            link={{ to: "/forecast?category=GAE", label: "View Forecast" }}
          />
          <Tile label={`${fiscalYear} GAE Portal Requests`} value={peso(gae.portalRequests)} tone="blue" />
          <Tile label="Remaining GAE Pool" value={peso(gae.remainingPool)} tone={gae.remainingPool < 0 ? "red" : "emerald"} />
          <Tile
            label="Board-Approved G&A"
            value={gae.boardApproved === null ? "Not set" : peso(gae.boardApproved)}
            tone="amber"
            link={{ to: "/step5?category=SBU", label: "Consolidated Board-Approved P&L" }}
          />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Total NPC - Board-Approved Budget</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile
            label={`${fiscalYear} Board-Approved NPC Budget`}
            value={npc.boardApproved === null ? "Not set" : peso(npc.boardApproved)}
            tone="slate"
            note="All NPC SBUs, Original + Additions/Reductions"
            link={{ to: "/step5?category=NPC", label: "Board-Approved NPC Budget" }}
          />
          <Tile label="Total Approved and Proposed" value={peso(npcRequests)} tone="blue" note={`${npc.requestCount} NPC request(s), net of budget cuts - ${peso(npc.approved)} fully approved`} />
          <Tile label="Available NPC Budget" value={peso(npc.available)} tone={npc.available < 0 ? "red" : "emerald"} />
          <Tile label="Proposed (in review)" value={peso(npc.proposed)} tone="amber" />
        </div>
      </section>
    </div>
  );
}
