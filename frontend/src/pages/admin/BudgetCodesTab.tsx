import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type BudgetCodePrefix, type BudgetCodePrefixKind } from "../../api/client";

const SECTIONS: { kind: BudgetCodePrefixKind; title: string; blurb: string; labelPlaceholder: string }[] = [
  {
    kind: "CENTRALIZED_DEPARTMENT",
    title: "Centralized Department Codes",
    blurb:
      "GAE's \"CD-YY-Num\" Budget Code prefix. Only used as a fallback when a catalog row is uploaded without one already pre-computed — normally the source catalog file supplies the whole code directly.",
    labelPlaceholder: "Department name (e.g. Admin Services)",
  },
  {
    kind: "NPC_HEAD",
    title: "NPC Head Codes",
    blurb: "Non-Project Capex's \"HEAD-YY-Num\" Budget Code prefix — the Head-per-SBU picker on the NPC request form.",
    labelPlaceholder: "Head label (e.g. Malls GH)",
  },
];

function PrefixSection({ kind, title, blurb, labelPlaceholder }: (typeof SECTIONS)[number]) {
  const queryClient = useQueryClient();
  const { data: prefixes = [] } = useQuery({
    queryKey: ["budget-code-prefixes", kind],
    queryFn: async () =>
      (await api.get<BudgetCodePrefix[]>("/admin/budget-code-prefixes", { params: { kind } })).data,
  });
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["budget-code-prefixes", kind] });

  const createMutation = useMutation({
    mutationFn: async () => (await api.post("/admin/budget-code-prefixes", { kind, label, code })).data,
    onSuccess: () => {
      invalidate();
      setLabel("");
      setCode("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/admin/budget-code-prefixes/${id}`)).data,
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <p className="mt-0.5 text-xs text-slate-500">{blurb}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
        <input
          className="flex-1 rounded border border-slate-300 px-2 py-1"
          placeholder={labelPlaceholder}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="w-28 rounded border border-slate-300 px-2 py-1 uppercase"
          placeholder="Code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button
          onClick={() => createMutation.mutate()}
          disabled={!label || !code}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-sm">
        {prefixes.length === 0 && <li className="px-3 py-2 text-slate-400">None configured yet.</li>}
        {prefixes.map((p) => (
          <li key={p.id} className="flex items-center justify-between px-3 py-2">
            <span>
              {p.label} <span className="ml-2 font-mono text-xs text-emerald-700">{p.code}</span>
            </span>
            <button
              onClick={() => deleteMutation.mutate(p.id)}
              className="rounded-full px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The two Budget Code prefix lists (Amendment: GAE/DOE/NPC each get a
// "CD-YY-Num"-style code) - DOE's SBU->code map isn't here since it's a
// small hardcoded constant tied 1:1 to the existing Sbu enum (see backend's
// lib/budgetCode.ts).
export function BudgetCodesTab() {
  return (
    <div className="space-y-6">
      <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
        Every line item requested gets a Budget Code SAP PR creators and accounting staff will reference instead of
        standardized item text. GAE's is normally pre-computed in the catalog upload; DOE uses the Strategic
        Business Unit picker (fixed 5-way list, not editable here); NPC uses the Head list below.
      </p>
      {SECTIONS.map((s) => (
        <PrefixSection key={s.kind} {...s} />
      ))}
    </div>
  );
}
