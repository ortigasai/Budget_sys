import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, NPC_SBU_OPTIONS, type NpcSbu } from "../api/client";
import { fmt } from "./BoardApprovedGrid";
import { STAGE_LABELS } from "./StatusBadge";

interface NpcCountedRequest {
  id: string;
  ticketNumber: string | null;
  budgetCode: string | null;
  projectTitle: string | null;
  location: string | null;
  department: string;
  stage: string;
  amount: number;
}
interface NpcRequestTotals {
  approved: number;
  proposed: number;
  requests: NpcCountedRequest[];
}

export interface NpcBoardBudgetRow {
  requestCategory: string;
  npcSbu?: string | null;
  isAdjustment?: boolean;
  amount: number;
}

type Part = "original" | "adjustment";
const keyOf = (sbu: string, part: Part) => `${sbu}|${part}`;

// Reads what the user typed: commas and spaces are ignored; "(1,000)" or "-1,000" is negative.
function parseAmount(s: string): number {
  const t = s.trim();
  const negative = t.startsWith("(") || t.startsWith("-");
  const n = Number(t.replace(/[^0-9.]/g, "")) || 0;
  return negative ? -n : n;
}

// "Board-Approved NPC Budget" - per NPC SBU (the 8 values NPC requests are
// tagged with): the Original Board-Approved figure plus any Board-Approved
// Additions/Reductions, giving the Total Board-Approved that reviewers see
// each NPC request against (NpcBudgetSummary.tsx). Both parts are saved
// through the same append-only history as the P&L grid, as requestCategory
// NPC rows keyed by npcSbu and isAdjustment.
// `sbus` limits the rows to those NPC SBUs (an SBU Finance viewer's own).
export function BoardApprovedNpcBudget({ fiscalYear, history, readOnly = false, sbus }: { fiscalYear: number; history: NpcBoardBudgetRow[]; readOnly?: boolean; sbus?: NpcSbu[] }) {
  const queryClient = useQueryClient();
  const sbuRows = sbus ? NPC_SBU_OPTIONS.filter((o) => sbus.includes(o.value)) : NPC_SBU_OPTIONS;
  // History is newest-first, so the first match per NPC SBU and part is its current figure.
  const latest = new Map<string, number>();
  for (const h of history) {
    if (h.requestCategory !== "NPC" || !h.npcSbu) continue;
    const k = keyOf(h.npcSbu, h.isAdjustment ? "adjustment" : "original");
    if (!latest.has(k)) latest.set(k, h.amount);
  }

  // Total Approved and Proposed per NPC SBU (see /budget-requests/npc-approved-totals).
  const { data: requestTotals = {} } = useQuery({
    queryKey: ["npc-approved-totals", fiscalYear],
    queryFn: async () => (await api.get<Record<string, NpcRequestTotals>>("/budget-requests/npc-approved-totals", { params: { fiscalYear } })).data,
  });
  const approvedAndProposed = (sbu: string) => (requestTotals[sbu]?.approved ?? 0) + (requestTotals[sbu]?.proposed ?? 0);
  // Which NPC SBU's request list is open under its row ("ALL" = the Total row's).
  const [openList, setOpenList] = useState<string | null>(null);
  const toggleList = (key: string) => setOpenList((cur) => (cur === key ? null : key));

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const value = (sbu: NpcSbu, part: Part) => {
    const k = keyOf(sbu, part);
    return draft[k] !== undefined ? parseAmount(draft[k]) : latest.get(k) ?? 0;
  };
  const changed = sbuRows.flatMap((o) =>
    (["original", "adjustment"] as Part[])
      .filter((part) => {
        const k = keyOf(o.value, part);
        return draft[k] !== undefined && parseAmount(draft[k]) !== (latest.get(k) ?? 0);
      })
      .map((part) => ({ sbu: o.value, part }))
  );

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ saved: number }>("/admin/board-approved-budget/bulk", {
          fiscalYear,
          cells: changed.map((c) => ({ requestCategory: "NPC", npcSbu: c.sbu, isAdjustment: c.part === "adjustment", amount: value(c.sbu, c.part) })),
        })
      ).data,
    onSuccess: (data) => {
      setMessage(data.saved > 0 ? `Saved ${data.saved} change(s).` : "No changes to save.");
      setDraft({});
      queryClient.invalidateQueries({ queryKey: ["board-approved-budget"] });
    },
    onError: (err: any) => setMessage(err.response?.data?.error ?? "Could not save the Board-Approved NPC Budget."),
  });

  const numCls = "py-1 px-2 text-right tabular-nums";
  const totals = sbuRows.reduce(
    (t, o) => ({
      original: t.original + value(o.value, "original"),
      adjustment: t.adjustment + value(o.value, "adjustment"),
      approved: t.approved + approvedAndProposed(o.value),
    }),
    { original: 0, adjustment: 0, approved: 0 }
  );
  const grandTotal = totals.original + totals.adjustment;

  const allRequests = sbuRows.flatMap((o) => (requestTotals[o.value]?.requests ?? []).map((r) => ({ ...r, sbuLabel: o.label })));

  // A Total Approved and Proposed figure: a button opening the requests behind it.
  const listToggle = (key: string, amount: number, count: number) =>
    count === 0 ? (
      fmt(amount)
    ) : (
      <button
        type="button"
        onClick={() => toggleList(key)}
        aria-expanded={openList === key}
        title={`Show the ${count} request(s) counted here`}
        className="font-[inherit] text-emerald-800 underline decoration-dotted underline-offset-2 hover:text-emerald-600"
      >
        {fmt(amount)} {openList === key ? "▴" : "▾"}
      </button>
    );

  const inputCell = (sbu: NpcSbu, label: string, part: Part) => {
    const k = keyOf(sbu, part);
    const raw = draft[k] ?? String(latest.get(k) ?? "");
    if (readOnly) return <td className={numCls}>{fmt(parseAmount(raw))}</td>;
    return (
      <td className="px-1 py-1 text-right">
        <input
          type="text"
          inputMode="decimal"
          aria-label={`${part === "original" ? "Original Board-Approved" : "Board-Approved Additions/Reductions"} for ${label}`}
          className="w-full max-w-[9rem] rounded border border-slate-300 px-2 py-1 text-right text-xs tabular-nums"
          value={focusKey === k ? raw : fmt(parseAmount(raw))}
          onFocus={() => setFocusKey(k)}
          onBlur={() => setFocusKey(null)}
          onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value.replace(part === "adjustment" ? /[^0-9.\-()]/g : /[^0-9.]/g, "") }))}
        />
      </td>
    );
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-xs">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[17%]" />
            <col className="w-[17%]" />
            <col className="w-[17%]" />
            <col className="w-[17%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-3 text-left align-bottom font-medium">NPC SBU</th>
              <th className="px-2 py-1 text-right align-bottom font-medium">Original Board-Approved</th>
              <th className="px-2 py-1 text-right align-bottom font-medium">Board-Approved Additions/Reductions</th>
              <th className="px-2 py-1 text-right align-bottom font-medium">Total Board-Approved</th>
              <th className="px-2 py-1 text-right align-bottom font-medium">Total Approved and Proposed</th>
              <th className="px-2 py-1 text-right align-bottom font-medium">Available</th>
            </tr>
          </thead>
          <tbody>
            {sbuRows.map((o) => {
              const total = value(o.value, "original") + value(o.value, "adjustment");
              const approved = approvedAndProposed(o.value);
              const listRequests = requestTotals[o.value]?.requests ?? [];
              return (
                <Fragment key={o.value}>
                  <tr className="border-t border-slate-100">
                    <td className="py-1 pr-3 text-left">{o.label}</td>
                    {inputCell(o.value, o.label, "original")}
                    {inputCell(o.value, o.label, "adjustment")}
                    <td className={`${numCls} font-medium`}>{fmt(total)}</td>
                    <td className={numCls}>{listToggle(o.value, approved, listRequests.length)}</td>
                    <td className={`${numCls} ${total - approved < -0.5 ? "text-red-700" : ""}`}>{fmt(total - approved)}</td>
                  </tr>
                  {openList === o.value && <RequestListRow requests={listRequests} />}
                </Fragment>
              );
            })}
            <tr className="border-t border-slate-200 bg-[#edf6f1] font-semibold text-[#164b33]">
              <td className="py-1 pr-3 text-left">Total</td>
              <td className={numCls}>{fmt(totals.original)}</td>
              <td className={numCls}>{fmt(totals.adjustment)}</td>
              <td className={numCls}>{fmt(grandTotal)}</td>
              <td className={numCls}>{listToggle("ALL", totals.approved, allRequests.length)}</td>
              <td className={numCls}>{fmt(grandTotal - totals.approved)}</td>
            </tr>
            {openList === "ALL" && <RequestListRow requests={allRequests} showSbu />}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {readOnly ? (
          <span className="text-xs text-slate-400">View only</span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || changed.length === 0}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save Board-Approved NPC Budget"}
            </button>
            <span className="text-xs text-slate-500">
              {changed.length} changed · Enter a reduction as a negative, e.g. -1,000,000 or (1,000,000). Total Approved and Proposed counts NPC requests that are fully approved or still in review, net of budget cuts.
            </span>
          </>
        )}
        {message && <span className="text-xs text-slate-700">{message}</span>}
      </div>
    </div>
  );
}

// The requests behind a Total Approved and Proposed figure, opened under its
// row: approved ones first, then the ones still in review.
function RequestListRow({ requests, showSbu = false }: { requests: (NpcCountedRequest & { sbuLabel?: string })[]; showSbu?: boolean }) {
  const approved = requests.filter((r) => r.stage === "APPROVED");
  const proposed = requests.filter((r) => r.stage !== "APPROVED");
  const group = (title: string, rows: typeof requests) => {
    const subtotal = rows.reduce((sum, r) => sum + r.amount, 0);
    return (
      <>
        <tr className="bg-slate-50 text-slate-600">
          <td colSpan={showSbu ? 6 : 5} className="px-2 py-1 font-semibold">
            {title} ({rows.length})
          </td>
          <td className="px-2 py-1 text-right font-semibold tabular-nums">{fmt(subtotal)}</td>
        </tr>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={showSbu ? 7 : 6} className="px-2 py-1 text-slate-400">
              None
            </td>
          </tr>
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-2 py-1">
                <Link to={`/requests/${r.id}`} className="text-emerald-800 hover:underline">
                  {r.ticketNumber ?? "—"}
                </Link>
              </td>
              <td className="px-2 py-1">{r.budgetCode ?? "—"}</td>
              <td className="px-2 py-1">{r.projectTitle ?? "—"}</td>
              {showSbu && <td className="px-2 py-1">{r.sbuLabel}</td>}
              <td className="px-2 py-1">{r.department}</td>
              <td className="px-2 py-1">{STAGE_LABELS[r.stage] ?? r.stage}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmt(r.amount)}</td>
            </tr>
          ))
        )}
      </>
    );
  };
  return (
    <tr className="border-t border-slate-100">
      <td colSpan={6} className="px-2 pb-3 pt-1">
        <div className="overflow-x-auto rounded-md border border-emerald-200 bg-white">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="px-2 py-1 font-medium">Ticket #</th>
                <th className="px-2 py-1 font-medium">Budget Code</th>
                <th className="px-2 py-1 font-medium">Project</th>
                {showSbu && <th className="px-2 py-1 font-medium">NPC SBU</th>}
                <th className="px-2 py-1 font-medium">Department</th>
                <th className="px-2 py-1 font-medium">Stage</th>
                <th className="px-2 py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {group("Approved", approved)}
              {group("Proposed (in review)", proposed)}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  );
}
