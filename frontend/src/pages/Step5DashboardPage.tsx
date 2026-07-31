import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type BudgetRequest } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { SectionLabel } from "../components/TabBar";

interface ReasonCode {
  id: string;
  label: string;
}
interface BoardBudget {
  current: { fiscalYear: number; amount: number; setAt: string } | null;
  history: { id: string; amount: number; setAt: string }[];
}

const RETURN_TARGETS = [
  { value: "DEPT_HEAD_REVIEW", label: "Department Head (Step 2)" },
  { value: "CENTRALIZED_L1_REVIEW", label: "Centralized First-Level Reviewer (Step 3A)" },
  { value: "CENTRALIZED_HEAD_REVIEW", label: "Centralized Department Head (Step 3B)" },
  { value: "BCA_HEAD_REVIEW", label: "BC&A Head (Step 4)" },
];

export function Step5DashboardPage() {
  const queryClient = useQueryClient();
  const { data: requests = [] } = useQuery({
    queryKey: ["step5-dashboard"],
    queryFn: async () => (await api.get<BudgetRequest[]>("/budget-requests/step5-dashboard")).data,
  });
  const { data: reasonCodes = [] } = useQuery({
    queryKey: ["reason-codes"],
    queryFn: async () => (await api.get<ReasonCode[]>("/admin/reason-codes")).data,
  });
  const { data: boardBudget } = useQuery({
    queryKey: ["board-approved-budget"],
    queryFn: async () => (await api.get<BoardBudget>("/admin/board-approved-budget?fiscalYear=2027")).data,
  });
  const { data: approvedPending = [] } = useQuery({
    queryKey: ["approved-pending-sap"],
    queryFn: async () => (await api.get<BudgetRequest[]>("/budget-requests/approved-pending-sap")).data,
  });
  const [selectedForSap, setSelectedForSap] = useState<string[]>([]);

  const uploadToSap = useMutation({
    mutationFn: async () =>
      (await api.post("/sap/upload", { budgetRequestIds: selectedForSap })).data as {
        documentNumber: string;
      },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approved-pending-sap"] });
      setSelectedForSap([]);
    },
  });

  const totalProposed = requests.reduce((sum, r) => sum + (r.proposedAmount - r.budgetCutAmount), 0);
  const [newBoardAmount, setNewBoardAmount] = useState("");

  const setBoardBudget = useMutation({
    mutationFn: async () =>
      (await api.post("/admin/board-approved-budget", { fiscalYear: 2027, amount: Number(newBoardAmount) })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["board-approved-budget"] });
      setNewBoardAmount("");
    },
  });

  const applyCut = useMutation({
    mutationFn: async ({ id, cutAmount }: { id: string; cutAmount: number }) =>
      (await api.post(`/budget-requests/${id}/budget-cut`, { cutAmount })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["step5-dashboard"] }),
  });

  const finalize = useMutation({
    mutationFn: async (id: string) => (await api.post(`/budget-requests/${id}/finalize`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["step5-dashboard"] }),
  });

  const [returning, setReturning] = useState<string | null>(null);
  const [targetStage, setTargetStage] = useState(RETURN_TARGETS[0].value);
  const [reasonCodeId, setReasonCodeId] = useState("");

  const returnRequest = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/budget-requests/${id}/return-to-stage`, { targetStage, reasonCodeId })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["step5-dashboard"] });
      setReturning(null);
    },
  });

  const grouped = requests.reduce<Record<string, BudgetRequest[]>>((acc, r) => {
    const key = r.expenseLineItem.ownerDepartment.name;
    acc[key] = acc[key] ?? [];
    acc[key].push(r);
    return acc;
  }, {});

  const boardAmount = boardBudget?.current?.amount ?? 0;
  const variance = boardAmount - totalProposed;
  const variancePct = boardAmount > 0 ? (variance / boardAmount) * 100 : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Step 5 — Technical Review & Finalization" />

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">2027 Board-Approved Budget</div>
            <div className="mt-1 text-xl font-bold text-slate-800">₱{boardAmount.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">2027 Total Proposed Budget</div>
            <div className="mt-1 text-xl font-bold text-emerald-800">₱{totalProposed.toLocaleString()}</div>
          </div>
          <div className={`rounded-lg border p-4 ${variance < 0 ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
            <div className={`text-xs font-semibold uppercase tracking-wide ${variance < 0 ? "text-red-700" : "text-amber-700"}`}>Variance</div>
            <div className={`mt-1 text-xl font-bold ${variance < 0 ? "text-red-700" : "text-amber-800"}`}>
              ₱{variance.toLocaleString()} ({variancePct.toFixed(1)}%)
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="number"
            placeholder="New Board-Approved amount"
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={newBoardAmount}
            onChange={(e) => setNewBoardAmount(e.target.value)}
          />
          <button
            onClick={() => setBoardBudget.mutate()}
            disabled={!newBoardAmount || setBoardBudget.isPending}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            Update Board-Approved Budget
          </button>
        </div>
      </div>

      {Object.entries(grouped).map(([deptName, items]) => (
        <div key={deptName} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="bg-emerald-50 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-emerald-800">{deptName}</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Expense Line Item</th>
                <th className="px-3 py-2">Proposed</th>
                <th className="px-3 py-2">Budget Cut</th>
                <th className="px-3 py-2">Net</th>
                <th className="px-3 py-2">Flag</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r, i) => (
                <tr key={r.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/60" : ""}`}>
                  <td className="px-3 py-2">
                    <Link to={`/requests/${r.id}`} className="font-medium text-emerald-800 hover:underline">
                      {r.expenseLineItem.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">₱{r.proposedAmount.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      defaultValue={r.budgetCutAmount}
                      className="w-24 rounded border border-slate-300 px-1 py-0.5"
                      onBlur={(e) => {
                        const cutAmount = Number(e.target.value) || 0;
                        if (cutAmount !== r.budgetCutAmount) applyCut.mutate({ id: r.id, cutAmount });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 font-semibold text-slate-700">₱{(r.proposedAmount - r.budgetCutAmount).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    {r.isOverBudget && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        Over-budget / Requires Realignment
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => finalize.mutate(r.id)}
                        className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-600"
                      >
                        Finalize
                      </button>
                      <button
                        onClick={() => setReturning(returning === r.id ? null : r.id)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                      >
                        Return…
                      </button>
                    </div>
                    {returning === r.id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select
                          className="rounded border border-slate-300 px-1 py-1 text-xs"
                          value={targetStage}
                          onChange={(e) => setTargetStage(e.target.value)}
                        >
                          {RETURN_TARGETS.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        <select
                          className="rounded border border-slate-300 px-1 py-1 text-xs"
                          value={reasonCodeId}
                          onChange={(e) => setReasonCodeId(e.target.value)}
                        >
                          <option value="">— Reason —</option>
                          {reasonCodes.map((rc) => (
                            <option key={rc.id} value={rc.id}>
                              {rc.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => returnRequest.mutate(r.id)}
                          disabled={!reasonCodeId}
                          className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
                        >
                          Confirm Return
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {requests.length === 0 && <div className="text-sm text-slate-500">No requests awaiting finalization.</div>}

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <SectionLabel>Ready for SAP Upload (FR-1.33)</SectionLabel>
        {uploadToSap.isSuccess && (
          <div className="mb-2 inline-block rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800">
            Uploaded — SAP Document #{uploadToSap.data.documentNumber}
          </div>
        )}
        {approvedPending.length === 0 ? (
          <div className="text-sm text-slate-500">Nothing finalized yet.</div>
        ) : (
          <div className="space-y-2 text-sm">
            {approvedPending.map((r) => (
              <label key={r.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedForSap.includes(r.id)}
                  onChange={(e) =>
                    setSelectedForSap((prev) =>
                      e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id)
                    )
                  }
                />
                {r.expenseLineItem.name} — ₱{(r.proposedAmount - r.budgetCutAmount).toLocaleString()}
              </label>
            ))}
            <button
              onClick={() => uploadToSap.mutate()}
              disabled={selectedForSap.length === 0 || uploadToSap.isPending}
              className="mt-2 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              Upload Selected to SAP (KP06)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
