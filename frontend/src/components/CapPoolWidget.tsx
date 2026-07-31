import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface CapPoolResult {
  value: number;
  actualsYtd2026: number;
  remainingForecast2026: number;
  growthRateUsed: number;
  totalPortalRequests: number;
  remainingPool: number;
}

function peso(n: number) {
  return `₱${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// FR-1.6 — Cap / Remaining Pool, recomputed live every time this widget is
// shown (React Query refetches on mount/focus rather than a websocket push).
export function CapPoolWidget({ departmentId, fiscalYear = 2027 }: { departmentId: string; fiscalYear?: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", departmentId, fiscalYear],
    queryFn: async () => (await api.get<CapPoolResult>(`/dashboard/${departmentId}?fiscalYear=${fiscalYear}`)).data,
  });

  if (isLoading || !data) {
    return <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">Loading…</div>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label={`${fiscalYear} Departmental Budget Cap`} value={peso(data.value)} tone="slate" />
      <Stat label={`${fiscalYear} Portal Requests`} value={peso(data.totalPortalRequests)} tone="blue" />
      <Stat
        label="Remaining Departmental Pool"
        value={peso(data.remainingPool)}
        tone={data.remainingPool < 0 ? "red" : "emerald"}
      />
      <Stat label="Growth Rate Used" value={`${data.growthRateUsed}%`} tone="amber" />
    </div>
  );
}

const TONES = {
  slate: "border-slate-200 bg-slate-50 text-slate-800",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-700",
};

function Stat({ label, value, tone }: { label: string; value: string; tone: keyof typeof TONES }) {
  return (
    <div className={`rounded-lg border p-3 ${TONES[tone]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}
