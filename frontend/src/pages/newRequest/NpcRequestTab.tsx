import { useLayoutEffect, useState } from "react";
import { ApproverPicker } from "../../components/ApproverPicker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { npcGroupSbus } from "../../lib/groupScope";
import { api, api2, downloadFile, type CcGlOptions, NPC_LOCATION_OPTIONS, NPC_SBU_OPTIONS, type BudgetRequest, type NpcLocation, type NpcSbu } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { PageHeader } from "../../components/PageHeader";
import { SearchableSelect } from "../../components/SearchableSelect";
import { SectionLabel } from "../../components/TabBar";
import { useFiscalYear } from "../../lib/fiscalCycle";
import { startUpload, useUploadTaskBySlot } from "../../lib/uploadManager";
import { UploadedDraftsPanel, type UploadedDraft } from "../../components/UploadedDraftsPanel";

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
  const { currentUser: authUser, hasRole: authHasRole } = useAuth();
  const myNpcSbus = npcGroupSbus(authUser, authHasRole("BUDGET_OFFICER"));
  const [npcLocation, setNpcLocation] = useState<NpcLocation | "">("");
  const [projectTitle, setProjectTitle] = useState("");
  const [projectStartDate, setProjectStartDate] = useState("");
  const [projectEndDate, setProjectEndDate] = useState("");
  const [costCenter, setCostCenter] = useState("");
  // Cost Center master list (admin-maintained, the same list the Transfers page uses).
  const { data: ccGlOptions = { costCenters: [], glAccounts: [] } } = useQuery({
    queryKey: ["transfers", "cc-gl-options"],
    queryFn: async () => (await api2.get<CcGlOptions>("/transfers/cc-gl-options")).data,
  });
  const [departmentHeadId, setDepartmentHeadId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [amountFocused, setAmountFocused] = useState(false);
  const [created, setCreated] = useState<BudgetRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amount = Number(amountInput) || 0;

  // Note 11 §6 - "Open Spreadsheet Template", NPC's own shape (Location/
  // Project Title/Dates/Cost Center/Amount) - see routes/bulkUpload.ts's
  // /npc-template + /npc-template-upload. Runs through the shared
  // uploadManager (see lib/uploadManager.ts), same as StandardRequestTab -
  // looked up by slot so a rejected-rows list survives switching tabs.
  const uploadTask = useUploadTaskBySlot("NPC");
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [uploadedDrafts, setUploadedDrafts] = useState<UploadedDraft[] | null>(null);
  const [frozenHeaderEl, setFrozenHeaderEl] = useState<HTMLDivElement | null>(null);
  const [frozenHeaderHeight, setFrozenHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    if (frozenHeaderEl) setFrozenHeaderHeight(frozenHeaderEl.offsetHeight);
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
          departmentHeadId: departmentHeadId || undefined,
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
    mutationFn: async () => (await api.post<BudgetRequest>(`/budget-requests/${created!.id}/submit`, { departmentHeadId: departmentHeadId || undefined })).data,
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
            <span className="font-bold text-emerald-800">{created.proposedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
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
    <div className="mx-auto max-w-6xl space-y-4">
      <div ref={setFrozenHeaderEl} className="sticky top-0 z-30 space-y-4 bg-white pb-3 pt-1">
      <PageHeader
        subtitle={subtitle}
        actions={
          <button onClick={() => createMutation.mutate()} disabled={saveDraftDisabled} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
            Save Draft
          </button>
        }
      />
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <label className="block font-medium text-emerald-800">Originating Department</label>
          <div className="mt-1 rounded border border-emerald-200 bg-white px-2 py-1.5 text-emerald-950">{currentUser?.department?.name}</div>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <label className="block font-medium text-emerald-800">Target Calendar Year</label>
          <div className="mt-1 rounded border border-emerald-200 bg-white px-2 py-1.5 text-emerald-950">{FISCAL_YEAR}</div>
        </div>
      </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
        <span className="font-medium text-slate-600">Bulk upload:</span>
        <button
          type="button"
          disabled={!npcSbu}
          onClick={() =>
            downloadFile(`/budget-requests/npc-template?npcSbu=${npcSbu}&fiscalYear=${FISCAL_YEAR}`, `npc-request-template-${npcSbu.toLowerCase()}-${FISCAL_YEAR}.xlsx`).catch(() =>
              setTemplateError("Failed to download the template.")
            )
          }
          className={`rounded-md border px-3 py-1.5 text-xs font-medium ${!npcSbu ? "cursor-not-allowed border-slate-200 text-slate-400" : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"}`}
        >
          Open Template
        </button>
        <label className={`rounded-md border px-3 py-1.5 text-xs font-medium ${!npcSbu ? "cursor-not-allowed border-slate-200 text-slate-400" : "cursor-pointer border-slate-300 text-slate-700 hover:bg-slate-100"}`}>
          {uploadTask?.status === "uploading" ? `Uploading… ${uploadTask.progress}%` : "Upload Completed Template"}
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            disabled={!npcSbu || uploadTask?.status === "uploading"}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setTemplateError(null);
              const form = new FormData();
              form.append("file", file);
              form.append("npcSbu", npcSbu);
              form.append("fiscalYear", String(FISCAL_YEAR));
              if (departmentHeadId) form.append("departmentHeadId", departmentHeadId);
              setUploadedDrafts(null);
              startUpload<{ createdRequests?: UploadedDraft[] }>({
                label: `NPC bulk upload (${file.name})`,
                slot: "NPC",
                url: "/budget-requests/npc-template-upload",
                form,
                invalidateKeys: [["my-requests"]],
                onDone: (data) => setUploadedDrafts(data.createdRequests?.length ? data.createdRequests : null),
              });
            }}
          />
        </label>
        {templateError && <span className="text-xs text-red-600">{templateError}</span>}
        {uploadTask && uploadTask.status !== "uploading" && (
          <span className={`text-xs ${uploadTask.status === "success" ? "text-emerald-700" : "text-red-600"}`}>{uploadTask.message}</span>
        )}
      </div>
      {uploadedDrafts && <UploadedDraftsPanel drafts={uploadedDrafts} onClear={() => setUploadedDrafts(null)} />}
      {uploadTask?.errors && uploadTask.errors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <div className="mb-1 font-medium">{uploadTask.errors.length} row(s) couldn't be uploaded - fix these in the spreadsheet and re-upload:</div>
          <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-4">
            {uploadTask.errors.map((e, i) => (
              <li key={i}>
                <span className="font-medium">Row {e.row}:</span> {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <SectionLabel>Project Details</SectionLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-600">
              SBU <span className="text-red-500">*</span>
            </label>
            <select className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value={npcSbu} onChange={(e) => setNpcSbu(e.target.value as NpcSbu)}>
              <option value="">— Select —</option>
              {NPC_SBU_OPTIONS.filter((o) => !myNpcSbus || myNpcSbus.includes(o.value)).map((o) => (
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
            <input type="month" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value={projectStartDate} onChange={(e) => setProjectStartDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600">
              Project End <span className="text-red-500">*</span>
            </label>
            <input type="month" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value={projectEndDate} onChange={(e) => setProjectEndDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600">
              Cost Center <span className="text-red-500">*</span>
            </label>
            <div className="mt-1">
              <SearchableSelect
                options={ccGlOptions.costCenters.map((c) => ({ value: c.code, label: c.code, sublabel: c.name }))}
                value={costCenter}
                onChange={setCostCenter}
                placeholder="Search cost centers…"
              />
            </div>
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

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <SectionLabel>Approval</SectionLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ApproverPicker label="Department Head / Approver" value={departmentHeadId} onChange={setDepartmentHeadId} />
        </div>
      </div>


      </div>

      <div className="space-y-4 lg:col-span-2">
        <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 text-sm shadow-sm lg:sticky" style={{ top: frozenHeaderHeight + 16 }}>
          <SectionLabel>Quick Guide</SectionLabel>
          <ol className="list-decimal space-y-1.5 pl-5 text-xs text-slate-700">
            <li>Choose the SBU and Location for the project.</li>
            <li>Enter the Project Title, and the Project Start and Project End months.</li>
            <li>Enter the Cost Center and the Amount (VAT exclusive).</li>
            <li>Pick the Department Head / Approver.</li>
            <li>Save Draft to keep working on it later, then submit it for approval.</li>
          </ol>
          <div className="border-t border-emerald-200 pt-2 text-xs text-slate-600">
            <span className="font-medium text-emerald-800">Bulk upload:</span> download the template, add one row per project, and upload it. Each row is saved as a Draft and listed here. Then, in My Requests, select them, pick the Department Head / Approver once and submit. Any rejected rows are listed here with the reason.
          </div>
        </div>
      </div>
      </div>

      {error && <div className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}
    </div>
  );
}
