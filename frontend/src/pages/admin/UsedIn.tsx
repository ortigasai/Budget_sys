import type { ReactNode } from "react";

// "Used in:" line under each Admin Console upload's title - which module and
// section of the app the uploaded file feeds, one line per place.
export function UsedIn({ children }: { children: ReactNode }) {
  return (
    <div className="mt-0.5 flex gap-1 text-xs text-slate-600">
      <span className="shrink-0 font-medium text-slate-700">Used in:</span>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
