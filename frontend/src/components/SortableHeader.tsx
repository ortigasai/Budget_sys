import type { CSSProperties } from "react";
import type { SortDir } from "../lib/useTableSort";

// A table header cell that toggles sorting when clicked. Shows ▲/▼ for the
// active column so it's clear which one the rows follow.
export function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onToggle,
  align = "left",
  className = "",
  rowSpan,
  style,
}: {
  label: string;
  sortKey: string;
  activeKey: string | null;
  dir: SortDir;
  onToggle: (key: string) => void;
  align?: "left" | "right" | "center";
  className?: string;
  rowSpan?: number;
  style?: CSSProperties;
}) {
  const active = activeKey === sortKey;
  const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th rowSpan={rowSpan} style={style} className={`${alignClass} ${className}`}>
      <button type="button" onClick={() => onToggle(sortKey)} className="inline-flex items-center gap-1 font-semibold hover:underline">
        {label}
        <span aria-hidden className={`text-[10px] ${active ? "opacity-100" : "opacity-30"}`}>
          {active ? (dir === "asc" ? "▲" : "▼") : "▲"}
        </span>
      </button>
    </th>
  );
}
