import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type BudgetRequest, type ExpenseLineItem } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { SearchableSelect } from "../../components/SearchableSelect";
import { SectionLabel } from "../../components/TabBar";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FISCAL_YEAR = 2027;

export function StandardRequestTab() {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: lineItems = [] } = useQuery({
    queryKey: ["expense-line-items"],
    queryFn: async () => (await api.get<ExpenseLineItem[]>("/admin/expense-line-items")).data,
  });
  const { data: docThreshold } = useQuery({
    queryKey: ["documentation-threshold"],
    queryFn: async () => (await api.get<{ amount: number }>("/admin/documentation-threshold")).data,
  });

  const categories = useMemo(() => [...new Set(lineItems.map((i) => i.category))].sort(), [lineItems]);

  const [category, setCategory] = useState("");
  const [expenseLineItemId, setExpenseLineItemId] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [customExpenseName, setCustomExpenseName] = useState("");
  const [monthlyAmounts, setMonthlyAmounts] = useState<number[]>(Array(12).fill(0));
  const [businessJustification, setBusinessJustification] = useState("");
  const [otherFields, setOtherFields] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<BudgetRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const itemsInCategory = useMemo(
    () => lineItems.filter((i) => i.category === category),
    [lineItems, category]
  );
  const selectedItem = lineItems.find((i) => i.id === expenseLineItemId);
  const proposedAmount = monthlyAmounts.reduce((a, b) => a + b, 0);
  const needsAttachment = docThreshold && proposedAmount > docThreshold.amount;

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post<BudgetRequest>("/budget-requests", {
          fiscalYear: FISCAL_YEAR,
          expenseLineItemId: useCustom ? undefined : expenseLineItemId,
          customExpenseName: useCustom ? customExpenseName : undefined,
          monthlyAmounts,
          businessJustification,
          otherRequiredFields: otherFields,
        })
      ).data,
    onSuccess: (data) => {
      setCreated(data);
      setError(null);
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Failed to create request."),
  });

  const attachMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return (await api.post(`/budget-requests/${created!.id}/attachments`, form)).data;
    },
    onSuccess: async () => {
      const refreshed = (await api.get<BudgetRequest>(`/budget-requests/${created!.id}`)).data;
      setCreated(refreshed);
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => (await api.post<BudgetRequest>(`/budget-requests/${created!.id}/submit`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-requests"] });
      navigate("/requests/mine");
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Failed to submit request."),
  });

  if (created) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-xl bg-gradient-to-r from-emerald-700 to-emerald-600 px-5 py-4 text-white shadow-sm">
          <h1 className="text-xl font-bold tracking-tight">Draft created</h1>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div>
            <span className="font-medium">Expense line item:</span> {created.expenseLineItem.name}
          </div>
          <div>
            <span className="font-medium">2027 Proposed Amount:</span>{" "}
            <span className="font-bold text-emerald-800">₱{created.proposedAmount.toLocaleString()}</span>
          </div>
          <div>
            <span className="font-medium">Attachments:</span>{" "}
            {created.attachments.length === 0 ? "None yet" : created.attachments.map((a) => a.fileName).join(", ")}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium">Supporting attachments</label>
          <input
            type="file"
            className="mt-1 text-sm"
            onChange={(e) => e.target.files?.[0] && attachMutation.mutate(e.target.files[0])}
          />
        </div>

        {error && <div className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}

        <button
          onClick={() => submitMutation.mutate()}
          disabled={submitMutation.isPending}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          Submit for Approval
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div>
          <label className="block font-medium text-slate-600">Originating Department</label>
          <div className="mt-1 rounded border border-slate-200 bg-slate-100 px-2 py-1.5">
            {currentUser?.department?.name}
          </div>
        </div>
        <div>
          <label className="block font-medium text-slate-600">Target Calendar Year</label>
          <div className="mt-1 rounded border border-slate-200 bg-slate-100 px-2 py-1.5">{FISCAL_YEAR}</div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <SectionLabel>Expense Selection</SectionLabel>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} />
          This expense isn't in the standard list
        </label>
        {useCustom ? (
          <input
            className="mt-2 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="Describe the expense (routes to the Budget Officer for GL-CC assignment)"
            value={customExpenseName}
            onChange={(e) => setCustomExpenseName(e.target.value)}
          />
        ) : (
          <div className="mt-2 space-y-2">
            <div>
              <label className="block text-xs font-medium text-slate-500">Expense Category</label>
              <SearchableSelect
                placeholder="Search categories…"
                options={categories.map((c) => ({ value: c, label: c }))}
                value={category}
                onChange={(v) => {
                  setCategory(v);
                  setExpenseLineItemId("");
                }}
              />
            </div>
            {category && (
              <div>
                <label className="block text-xs font-medium text-slate-500">Expense Line Item</label>
                <SearchableSelect
                  placeholder="Search line items…"
                  options={itemsInCategory.map((i) => ({
                    value: i.id,
                    label: i.company ? `${i.name} (${i.company.code})` : i.name,
                    sublabel: `${i.glAccount} / ${i.costCenter}`,
                  }))}
                  value={expenseLineItemId}
                  onChange={(v) => {
                    setExpenseLineItemId(v);
                    setOtherFields({});
                  }}
                />
              </div>
            )}
          </div>
        )}

        {selectedItem?.requiresMobilePolicy && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
            Mobile phone plans have a monthly budget limit by employee rank. Selecting a plan over your rank's limit
            routes this request through an additional CFO approval step.
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <SectionLabel>Monthly Spend Grid (Jan–Dec)</SectionLabel>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {MONTHS.map((m, i) => (
            <div key={m}>
              <label className="block text-xs text-slate-500">{m}</label>
              <input
                type="number"
                min={0}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={monthlyAmounts[i]}
                onChange={(e) => {
                  const next = [...monthlyAmounts];
                  next[i] = Number(e.target.value) || 0;
                  setMonthlyAmounts(next);
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm">
          <span className="font-medium text-emerald-800">2027 Proposed Amount:</span>{" "}
          <span className="font-bold text-emerald-800">₱{proposedAmount.toLocaleString()}</span>
          {needsAttachment && (
            <span className="ml-2 text-amber-700">
              (exceeds ₱{docThreshold!.amount.toLocaleString()} — attachment will be required)
            </span>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <SectionLabel>Business Justification</SectionLabel>
        <textarea
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          rows={3}
          value={businessJustification}
          onChange={(e) => setBusinessJustification(e.target.value)}
        />
      </div>

      {selectedItem && selectedItem.extraFieldsConfig.length > 0 && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <SectionLabel>Additional Fields</SectionLabel>
          {selectedItem.extraFieldsConfig.map((field) => (
            <div key={field.label}>
              <label className="block text-sm font-medium text-slate-600">
                {field.label} {field.required && <span className="text-red-500">*</span>}
              </label>
              {field.type === "DROPDOWN" ? (
                <select
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={otherFields[field.label] ?? ""}
                  onChange={(e) => setOtherFields({ ...otherFields, [field.label]: e.target.value })}
                >
                  <option value="">— Select —</option>
                  {field.options?.map((opt) => (
                    <option key={opt.label} value={opt.label}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === "NUMBER" ? "number" : "text"}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={otherFields[field.label] ?? ""}
                  onChange={(e) => setOtherFields({ ...otherFields, [field.label]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {error && <div className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}

      <button
        onClick={() => createMutation.mutate()}
        disabled={createMutation.isPending || (!useCustom && !expenseLineItemId) || (useCustom && !customExpenseName)}
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
      >
        Save Draft
      </button>
    </div>
  );
}
