import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type AdditionalHeadcountRequest, type Company } from "../../api/client";
import { SectionLabel } from "../../components/TabBar";

export function AdditionalHeadcountTab() {
  const queryClient = useQueryClient();
  const { data: companies = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Company[]>("/admin/companies")).data,
  });

  const [form, setForm] = useState({
    position: "",
    rank: "",
    companyId: "",
    estimatedHireDate: "",
    justification: "",
  });
  const [created, setCreated] = useState<AdditionalHeadcountRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post<AdditionalHeadcountRequest>("/additional-headcount", {
          position: form.position,
          rank: Number(form.rank),
          companyId: form.companyId,
          estimatedHireDate: new Date(form.estimatedHireDate).toISOString(),
          justification: form.justification,
        })
      ).data,
    onSuccess: (data) => {
      setCreated(data);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["additional-headcount", "my-requests"] });
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Failed to create request."),
  });

  if (created) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <div className="rounded-xl bg-gradient-to-r from-emerald-700 to-emerald-600 px-5 py-4 text-white shadow-sm">
          <h2 className="text-lg font-bold tracking-tight">Additional Headcount Request submitted</h2>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div>
            <span className="font-medium">Position:</span> {created.position} (Rank {created.rank})
          </div>
          <div>
            <span className="font-medium">Company:</span> {created.company.code}
          </div>
          <div>
            <span className="font-medium">Status:</span>{" "}
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              Routed to your Department Head for approval
            </span>
          </div>
        </div>
        <button
          onClick={() => {
            setCreated(null);
            setForm({ position: "", rank: "", companyId: "", estimatedHireDate: "", justification: "" });
          }}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
        >
          Submit another
        </button>
      </div>
    );
  }

  const canSubmit = form.position && form.rank && form.companyId && form.estimatedHireDate && form.justification;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
        Approved by your Department Head, then the HR Analyst, then the HR Head. Approved requests are reflected in
        the Manpower Budget's headcount for the selected company.
      </div>

      <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <SectionLabel>Position Details</SectionLabel>
        <div>
          <label className="block text-sm font-medium text-slate-600">Position</label>
          <input
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={form.position}
            onChange={(e) => setForm({ ...form, position: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-600">Rank</label>
            <input
              type="number"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={form.rank}
              onChange={(e) => setForm({ ...form, rank: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600">Company</label>
            <select
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={form.companyId}
              onChange={(e) => setForm({ ...form, companyId: e.target.value })}
            >
              <option value="">— Select —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600">Estimated Hire Date</label>
          <input
            type="date"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={form.estimatedHireDate}
            onChange={(e) => setForm({ ...form, estimatedHireDate: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600">Justification</label>
          <textarea
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            rows={3}
            value={form.justification}
            onChange={(e) => setForm({ ...form, justification: e.target.value })}
          />
        </div>
      </div>

      {error && <div className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}

      <button
        onClick={() => createMutation.mutate()}
        disabled={!canSubmit || createMutation.isPending}
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
      >
        Submit Request
      </button>
    </div>
  );
}
