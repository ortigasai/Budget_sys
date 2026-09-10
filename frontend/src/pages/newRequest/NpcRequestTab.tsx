import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, NPC_LOCATION_OPTIONS, NPC_SBU_OPTIONS, type BudgetRequest, type NpcLocation, type NpcSbu } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { PageHeader } from "../../components/PageHeader";
import { SectionLabel } from "../../components/TabBar";
import { useFiscalYear } from "../../lib/fiscalCycle";

// Spec item 12: NPC is not the same form as GAE/DOE — its own required
// fields (SBU, Location, Project Title/Start/End, Amount, Cost Center), no
// expense line item picker, no 12-month spend grid, no Business
// Justification. A budget code is generated automatically on creation (see
// budgetRequests.ts's NPC branch + lib/npcSbu.ts).
export function NpcRequestTab({ subtitle }: { subtitle: string }) {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { targetYear: FISCAL_YEAR } = useFiscalYear();

  const [npcSbu, setNpcSbu] = useState<NpcSbu | "">("");
  const [npcLocation, setNpcLocation] = useState<NpcLocation | "">("");
  const [projectTitle, setProjectTitle] = useState("");
  const [projectStartDate, setProjectStartDate] = useState("");
  const [projectEndDate, setProjectEndDate] = useState("");
  const [costCenter, setCostCenter] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [amountFocused, setAmountFocused] = useState(false);
  const [created, setCreated] = useState<BudgetRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amount = Number(amountInput) || 0;

  // Note 11 §6 - "Open Spreadsheet Template", NPC's own shape (Location/
  // Project Title/Dates/Cost Center/Amount) - see routes/bulkUpload.ts's
  // /npc-template + /npc-template-upload.
  const [bulkStatus, setBulkStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const bulkUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("npcSbu", npcSbu);
      form.append("fiscalYear", String(FISCAL_YEAR));
      return (await api.post<{ created: number; errors: { row: number; error: string }[] }>("/npc-template-upload", form)).data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["my-requests"] });
      setBulkStatus(
        data.errors.length === 0
          ? { ok: true, message: `Created ${data.created} request(s).` }
          : { ok: data.created > 0, message: `Created ${data.created} request(s), ${data.errors.length} row(s) rejected: ${data.errors.map((e) => `row ${e.row} - ${e.error}`).join("; ")}` }
      );
    },
    onError: (err: any) => setBulkStatus({ ok: false, message: err.response?.data?.error ?? "Upload failed." }),
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post<BudgetRequest>("/budget-requests", {
          fiscalYear: FISCAL_YEAR,
          requestCategory: "NPC",
          npcSbu,
          npcLocation,
          projectTitle,
          projectStartDate,
          projectEndDate,
          costCenter,
          amount,
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
        <PageHeader
          subtitle={<span className="font-medium text-slate-700">Draft created</span>}
          actions={
            <button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
              Submit for Approval
            </button>
          }
        />
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div>
            <span className="font-medium">Project Title:</span> {created.projectTitle}
          </div>
          <div>
            <span className="font-medium">Budget Code:</span>
            {""}
            {created.budgetCode ?? "—"}
          </div>
          <div>
            <span className="font-medium">{FISCAL_YEAR} Amount (VAT exclusive):</span>
            {""}
            <span className="font-bold text-emerald-800">₱{created.proposedAmount.toLocaleString()}</span>
          </div>
          <div>
            <span className="font-medium">Attachments:</span>
            {""}
            {created.attachments.length === 0 ? "None yet" : created.attachments.map((a) => a.fileName).join(",")}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium">Supporting attachments</label>
          <input type="file" className="mt-1 text-sm" onChange={(e) => e.target.files?.[0] && attachMutation.mutate(e.target.files[0])} />
        </div>

        {error && <div className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}
      </div>
    );
  }

  const saveDraftDisabled = createMutation.isPending || !npcSbu || !npcLocation || !projectTitle || !projectStartDate || !projectEndDate || !costCenter || !amount;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        subtitle={subtitle}
        actions={
          <button onClick={() => createMutation.mutate()} disabled={saveDraftDisabled} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
            Save Draft
          </button>
        }
      />

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <SectionLabel>Project Details</SectionLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block font-medium text-slate-600">Originating Department</label>
            <div className="mt-1 rounded border border-slate-200 bg-slate-100 px-2 py-1.5 text-sm">{currentUser?.department?.name}</div>
          </div>
          <div>
            <label className="block font-medium text-slate-600">Target Calendar Year</label>
            <div className="mt-1 rounded border border-slate-200 bg-slate-100 px-2 py-1.5 text-sm">{FISCAL_YEAR}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600">
              SBU <span className="text-red-500">*</span>
            </label>
            <select className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value={npcSbu} onChange={(e) => setNpcSbu(e.target.value as NpcSbu)}>
              <option value="">— Select —</option>
              {NPC_SBU_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600">
              Location <span className="text-red-500">*</span>
            </label>
            <select className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value={npcLocation} onChange={(e) => setNpcLocation(e.target.value as NpcLocation)}>
              <option value="">— Select —</option>
              {NPC_LOCATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-600">
              Project Title <span className="text-red-500">*</span>
            </label>
            <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600">
              Project Start <span className="text-red-500">*</span>
            </label>
            <input type="date" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value={projectStartDate} onChange={(e) => setProjectStartDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600">
              Project End <span className="text-red-500">*</span>
            </label>
            <input type="date" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value={projectEndDate} onChange={(e) => setProjectEndDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600">
              Cost Center <span className="text-red-500">*</span>
            </label>
            <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value={costCenter} onChange={(e) => setCostCenter(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600">
              Amount (VAT exclusive) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={amountFocused || amountInput === "" ? amountInput : Number(amountInput).toLocaleString()}
              onFocus={() => setAmountFocused(true)}
              onBlur={() => setAmountFocused(false)}
              onChange={(e) => {
                const raw = e.target.value.replace(/[₱,\s]/g, "");
                if (raw === "" || /^\d*\.?\d*$/.test(raw)) setAmountInput(raw);
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
        <span className="font-medium text-slate-600">Bulk upload via spreadsheet:</span>
        <a
          href={`/api/budget-requests/npc-template?npcSbu=${npcSbu}&fiscalYear=${FISCAL_YEAR}`}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium ${!npcSbu ? "pointer-events-none border-slate-200 text-slate-400" : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"}`}
        >
          Open Spreadsheet Template
        </a>
        <label className={`rounded-md border px-3 py-1.5 text-xs font-medium ${!npcSbu ? "cursor-not-allowed border-slate-200 text-slate-400" : "cursor-pointer border-slate-300 text-slate-700 hover:bg-slate-100"}`}>
          {bulkUploadMutation.isPending ? "Uploading…" : "Upload Completed Template"}
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            disabled={!npcSbu || bulkUploadMutation.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBulkStatus(null);
              bulkUploadMutation.mutate(file);
            }}
          />
        </label>
        {bulkStatus && <span className={`text-xs ${bulkStatus.ok ? "text-emerald-700" : "text-red-600"}`}>{bulkStatus.message}</span>}
      </div>

      {error && <div className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}
    </div>
  );
}
