import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ExpenseLineItem, type NewExpenseRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { SearchableSelect } from "../components/SearchableSelect";

export const NEW_EXPENSE_INBOX_KEY = ["new-expense-requests", "pending"];

export function useIsBudgetOfficer() {
  const { currentUser } = useAuth();
  return !!currentUser?.roles.some((r) => r.roleType === "BUDGET_OFFICER");
}

// Budget Officer's Inbox > New Expense Line Item Requests: expenses someone
// asked to add to the standard list ("This expense isn't in the standard
// list" on New GAE Request). Approving fills in the line item's category,
// GL-CC and owning department and adds it to the catalog.
export function NewExpenseRequestsInboxSection() {
  const isBudgetOfficer = useIsBudgetOfficer();
  const { data: requests = [] } = useQuery({
    queryKey: NEW_EXPENSE_INBOX_KEY,
    queryFn: async () => (await api.get<NewExpenseRequest[]>("/new-expense-requests/pending")).data,
    enabled: isBudgetOfficer,
  });
  const [openId, setOpenId] = useState<string | null>(null);

  if (!isBudgetOfficer || requests.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-bold text-white">{requests.length}</span>
        <h2 className="text-sm font-semibold tracking-wide text-emerald-800">New Expense Line Item Requests</h2>
      </div>
      {requests.map((r) => (
        <div key={r.id} className="rounded-lg border border-slate-200 border-l-4 border-l-sky-400 bg-white p-4 text-sm shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium text-slate-800">{r.name}</div>
              <div className="text-xs text-slate-500">
                {r.department.name} · by {r.requestedBy.name} · {new Date(r.createdAt).toLocaleDateString()}
              </div>
              {r.details && <div className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{r.details}</div>}
            </div>
            <button onClick={() => setOpenId(openId === r.id ? null : r.id)} className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100">
              {openId === r.id ? "Close" : "Review"}
            </button>
          </div>
          {openId === r.id && <ReviewForm request={r} onDone={() => setOpenId(null)} />}
        </div>
      ))}
    </div>
  );
}

function ReviewForm({ request, onDone }: { request: NewExpenseRequest; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(request.name);
  const [category, setCategory] = useState("");
  const [glAccount, setGlAccount] = useState("");
  const [costCenter, setCostCenter] = useState("");
  const [ownerDepartmentId, setOwnerDepartmentId] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: lineItems = [] } = useQuery({
    queryKey: ["expense-line-items"],
    queryFn: async () => (await api.get<ExpenseLineItem[]>("/admin/expense-line-items")).data,
  });
  const categories = useMemo(() => [...new Set(lineItems.map((i) => i.category))].sort(), [lineItems]);
  const { data: departments = [] } = useQuery({
    queryKey: ["auth", "departments"],
    queryFn: async () => (await api.get<{ id: string; name: string }[]>("/auth/departments")).data,
  });

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ["new-expense-requests"] });
    queryClient.invalidateQueries({ queryKey: ["expense-line-items"] });
    onDone();
  };
  const approve = useMutation({
    mutationFn: async () =>
      (await api.post(`/new-expense-requests/${request.id}/approve`, { name, category, glAccount, costCenter, ownerDepartmentId, description: description || undefined, note: note || undefined })).data,
    onSuccess: done,
    onError: (err: any) => setError(err.response?.data?.error ?? "Couldn't approve it."),
  });
  const disapprove = useMutation({
    mutationFn: async () => (await api.post(`/new-expense-requests/${request.id}/disapprove`, { note })).data,
    onSuccess: done,
    onError: (err: any) => setError(err.response?.data?.error ?? "Couldn't disapprove it."),
  });

  const canApprove = name.trim() && category.trim() && glAccount.trim() && costCenter.trim() && ownerDepartmentId;
  const input = "mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
  const label = "block text-xs font-medium text-slate-600";

  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <div className="text-xs text-slate-500">Approving adds this to the standard expense line item list, so it can be budgeted like any other item.</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Line item name *</label>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={label}>Expense category *</label>
          <input className={input} list={`categories-${request.id}`} placeholder="Pick or type a category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <datalist id={`categories-${request.id}`}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={label}>GL Account *</label>
          <input className={input} value={glAccount} onChange={(e) => setGlAccount(e.target.value)} />
        </div>
        <div>
          <label className={label}>Cost Center *</label>
          <input className={input} value={costCenter} onChange={(e) => setCostCenter(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Owning (centralized) department *</label>
          <div className="mt-1">
            <SearchableSelect placeholder="Select a department…" options={departments.map((d) => ({ value: d.id, label: d.name }))} value={ownerDepartmentId} onChange={setOwnerDepartmentId} />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Description</label>
          <input className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Comment (required to disapprove)</label>
          <textarea className={input} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {error && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <div className="flex gap-2">
        <button
          onClick={() => {
            setError(null);
            approve.mutate();
          }}
          disabled={!canApprove || approve.isPending || disapprove.isPending}
          className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          Approve & add to the standard list
        </button>
        <button
          onClick={() => {
            setError(null);
            disapprove.mutate();
          }}
          disabled={!note.trim() || approve.isPending || disapprove.isPending}
          className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
        >
          Disapprove
        </button>
      </div>
    </div>
  );
}
