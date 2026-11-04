import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useFeatureToggles, type FeatureToggleKey } from "../../lib/featureToggles";

// Parts of the app that are built but not open yet - the Budget Officer
// hides or unhides each one here (see backend/src/lib/featureToggles.ts).
// Takes effect for everyone on their next page load.
export function HiddenMenusTab() {
  const queryClient = useQueryClient();
  const { toggles, isLoading } = useFeatureToggles();
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async ({ key, enabled }: { key: FeatureToggleKey; enabled: boolean }) => (await api.put(`/admin/feature-toggles/${key}`, { enabled })).data,
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["feature-toggles"] });
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Could not save."),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-800">Hidden Menus</div>
        <p className="mt-1 text-xs text-slate-500">
          Parts of the system that are built but not open for use yet. Unhide one to open it to its users; hide it again to take it back out. Changes apply to everyone the next time their page loads.
        </p>
      </div>

      {isLoading && <div className="text-sm text-slate-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-emerald-50 text-left text-xs tracking-wide text-emerald-800">
            <tr>
              <th className="px-4 py-2">Menu</th>
              <th className="px-4 py-2">What it does</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {toggles.map((t) => {
              const pending = save.isPending && save.variables?.key === t.key;
              return (
                <tr key={t.key} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{t.label}</div>
                    <div className="text-xs text-slate-500">{t.module}</div>
                  </td>
                  <td className="max-w-md px-4 py-3 text-xs text-slate-600">
                    <div>
                      <span className="font-medium text-slate-700">Hidden:</span> {t.whenOff}
                    </div>
                    <div className="mt-1">
                      <span className="font-medium text-slate-700">Unhidden:</span> {t.whenOn}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{t.enabled ? "Visible" : "Hidden"}</span>
                    {t.updatedAt && (
                      <div className="mt-1 text-[11px] text-slate-400">
                        {new Date(t.updatedAt).toLocaleString()}
                        {t.updatedBy && <> by {t.updatedBy}</>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={save.isPending}
                      onClick={() => save.mutate({ key: t.key, enabled: !t.enabled })}
                      className={`rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                        t.enabled ? "border border-slate-300 text-slate-700 hover:bg-slate-100" : "bg-emerald-700 text-white hover:bg-emerald-600"
                      }`}
                    >
                      {pending ? "Saving…" : t.enabled ? "Hide" : "Unhide"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
