import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";

// "This expense isn't in the standard list" on the New GAE Request form opens
// this window. Only the expense's name is required; it goes straight to the
// Budget Officer, who adds it to the standard list (setting its GL-CC) or
// disapproves it - there's no approver to pick and no budget approval flow.
export function NewExpenseRequestModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [justification, setJustification] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A request to add the expense to the standard list - not a budget request
  // (backend routes/newExpenseRequests.ts). It shows in the Budget Officer's
  // Inbox > New Expense Line Item Requests, and in the requestor's My Requests.
  const submit = useMutation({
    mutationFn: async () => (await api.post("/new-expense-requests", { name: name.trim(), details: justification.trim() || undefined })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["new-expense-requests"] });
      navigate("/requests/mine");
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Failed to submit the request."),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold tracking-wide text-slate-500">Expense not in the standard list</div>
            <div className="text-lg font-semibold text-emerald-800">Request a new expense</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            ✕
          </button>
        </div>

        <p className="mb-4 text-sm text-slate-600">
          This goes straight to the Budget Officer. Once approved, the expense is added to the standard list and you can budget for it like any other line item.
        </p>

        <label className="block text-sm font-medium text-slate-700">
          Expense name <span className="text-red-600">*</span>
        </label>
        <input
          autoFocus
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="e.g. Risograph Machine"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label className="mt-4 block text-sm font-medium text-slate-700">
          Details / Business Justification <span className="font-normal text-slate-500">- optional</span>
        </label>
        <textarea
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          rows={4}
          placeholder="What it's for, estimated cost, when it's needed…"
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
        />

        {error && <div className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              submit.mutate();
            }}
            disabled={submit.isPending || !name.trim()}
            className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {submit.isPending ? "Submitting…" : "Submit to Budget Officer"}
          </button>
        </div>
      </div>
    </div>
  );
}
