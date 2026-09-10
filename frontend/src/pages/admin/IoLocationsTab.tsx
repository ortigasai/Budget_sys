import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api2, type IoLocation } from "../../api/client";

// Spec item 9: "Location (dropdown list of OE, CC, GH, CV). This list
// should be editable by the Budget Officer in the Admin Console section."
// Owned by backend-py (Phase 3-specific, no reason to live in Node/Prisma) -
// this tab calls api2 instead of api, same as the Transfers pages do.
export function IoLocationsTab() {
  const queryClient = useQueryClient();
  const { data: locations = [] } = useQuery({
    queryKey: ["io-locations"],
    queryFn: async () => (await api2.get<IoLocation[]>("/internal-orders/locations")).data,
  });

  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => (await api2.post("/internal-orders/locations", { code: code.trim().toUpperCase(), label: label.trim(), sortOrder: locations.length })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["io-locations"] });
      setCode("");
      setLabel("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => (await api2.delete(`/internal-orders/locations/${id}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["io-locations"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <div className="w-32">
          <label className="mb-1 block text-xs font-medium text-slate-500">Code</label>
          <input className="w-full rounded border border-slate-300 px-2 py-1.5" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. OE" />
        </div>
        <div className="w-56">
          <label className="mb-1 block text-xs font-medium text-slate-500">Label</label>
          <input className="w-full rounded border border-slate-300 px-2 py-1.5" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. OE" />
        </div>
        <button onClick={() => createMutation.mutate()} disabled={!code.trim() || !label.trim() || createMutation.isPending} className="rounded bg-emerald-700 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
          Add Location
        </button>
      </div>
      {createMutation.isError && <div className="text-xs text-red-600">{(createMutation.error as any)?.response?.data?.detail ?? "Could not add this location."}</div>}

      <table className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
        <thead className="bg-emerald-50 text-left text-xs tracking-wide text-emerald-800">
          <tr>
            <th className="px-3 py-2">Code</th>
            <th className="px-3 py-2">Label</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {locations.map((l) => (
            <tr key={l.id} className="border-t border-slate-100">
              <td className="px-3 py-2 font-mono">{l.code}</td>
              <td className="px-3 py-2">{l.label}</td>
              <td className="px-3 py-2 text-right">
                <button onClick={() => deleteMutation.mutate(l.id)} className="text-xs text-red-600 hover:underline">
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
