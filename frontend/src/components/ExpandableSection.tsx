import { useState, type ReactNode } from "react";

// Note 12 revision - "All tables and charts should be able to be viewed
// into a bigger pop-up window." Wraps a chart/table with an "Expand" button
// that swaps its normal inline rendering for a large centered overlay
// showing the exact same content - only one of the two ever renders at a
// time (not both, one hidden), so a wrapped child's own internal state
// (search text, sort order, open/closed rows) doesn't fork into two
// independent copies while expanded.
export function ExpandableSection({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 sm:p-8" onClick={() => setExpanded(false)}>
        <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <div className="text-sm font-semibold text-slate-700">{title ?? "Expanded view"}</div>
            <button onClick={() => setExpanded(false)} className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">
              Close ✕
            </button>
          </div>
          <div className="overflow-auto p-4">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <button
        onClick={() => setExpanded(true)}
        title="View in a bigger window"
        className="absolute right-1.5 top-1.5 z-10 rounded border border-slate-300 bg-white/95 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100"
      >
        ⤢ Expand
      </button>
      {children}
    </div>
  );
}
