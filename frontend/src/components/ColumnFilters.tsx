import type { CSSProperties } from "react";

// One filter box inside a table's filter row (a second header row under the
// column titles). Number columns hint at comparisons, e.g. ">1000000".
export function ColumnFilterCell({
  columnKey,
  label,
  filters,
  onChange,
  numeric = false,
  className = "",
  style,
}: {
  columnKey: string;
  // The column's visible title, for screen readers.
  label: string;
  filters: Record<string, string>;
  onChange: (key: string, value: string) => void;
  numeric?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <th className={`px-2 py-1 font-normal normal-case ${className}`} style={style}>
      <input
        type="search"
        value={filters[columnKey] ?? ""}
        onChange={(e) => onChange(columnKey, e.target.value)}
        placeholder={numeric ? "e.g. >0" : "Filter…"}
        title={numeric ? "Type a number, or a comparison like >1000000, <0 or =500" : "Shows rows containing this text"}
        aria-label={`Filter ${label}`}
        className={`w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-normal text-slate-700 placeholder:text-slate-400 ${numeric ? "text-right" : ""}`}
      />
    </th>
  );
}

// "Showing X of Y" above a filtered table, with a link that clears every column's filter.
export function FilterStatus({ count, total, activeCount, onClear }: { count: number; total: number; activeCount: number; onClear: () => void }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span>
        Showing {count} of {total}
      </span>
      {activeCount > 0 && (
        <button type="button" onClick={onClear} className="font-medium text-emerald-700 hover:underline">
          Clear filters ({activeCount})
        </button>
      )}
    </div>
  );
}
