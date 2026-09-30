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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={() => setExpanded(false)}>
        {/* w-[97vw] (not max-w-6xl) - the point of "expand" is to use the
            screen's own width instead of being boxed to the same ~1152px
            cap regardless of monitor size, so a wide table gets real room
            on the left/right instead of a narrow column floating in a sea
            of dimmed backdrop. Height stays content-sized (max-h-full, not
            a fixed vh) so a short table/chart doesn't get stretched into a
            mostly-empty box. */}
        <div className="flex max-h-full w-[97vw] flex-col overflow-hidden rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
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
      {/* z-40 - a wrapped table's own sticky header/frozen columns (e.g.
          Forecast's GAE/DOE grid) go up to z-30, which otherwise painted
          right over this button at the same top-right corner, leaving it
          present in the DOM (still clickable via a direct element
          reference) but visually invisible/unclickable for a real user. */}
      <button
        onClick={() => setExpanded(true)}
        title="View in a bigger window"
        className="absolute right-1.5 top-1.5 z-40 rounded border border-slate-300 bg-white/95 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100"
      >
        ⤢ Expand
      </button>
      {children}
    </div>
  );
}
