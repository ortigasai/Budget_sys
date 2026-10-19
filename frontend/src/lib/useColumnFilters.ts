import { useMemo, useState } from "react";

type CellValue = string | number | null | undefined;
// A list is for a cell that shows several values (e.g. one line per IO); the
// row matches if any of them does.
export type FilterValue = CellValue | CellValue[];

const COMPARISON = /^(>=|<=|>|<|=)\s*(-?[\d,]*\.?\d+)$/;

// Whether one cell matches one column's filter text. Text matches any part of
// the value, ignoring case. A number column also accepts a comparison such as
// ">1000000", "<0" or "=500"; typed digits match with or without commas.
export function matchesColumnFilter(value: FilterValue, filter: string): boolean {
  const f = filter.trim();
  if (!f) return true;
  if (Array.isArray(value)) return value.some((v) => matchesColumnFilter(v, f));
  const comparison = f.replace(/\s+/g, "").match(COMPARISON);
  if (comparison && typeof value === "number") {
    const target = Number(comparison[2].replace(/,/g, ""));
    switch (comparison[1]) {
      case ">": return value > target;
      case "<": return value < target;
      case ">=": return value >= target;
      case "<=": return value <= target;
      default: return value === target;
    }
  }
  if (value === null || value === undefined || value === "") return false;
  const needle = f.toLowerCase();
  if (typeof value === "number") {
    const plain = String(Math.round(value * 100) / 100);
    return plain.includes(needle.replace(/,/g, "")) || value.toLocaleString().toLowerCase().includes(needle);
  }
  return String(value).toLowerCase().includes(needle);
}

// One filter box per column; a row is shown only if it matches every column
// that has filter text. getValue returns the cell's value for a column key -
// the same accessor useTableSort takes, so both can share it.
export function useColumnFilters<T>(rows: T[], getValue: (row: T, key: string) => FilterValue) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const active = useMemo(() => Object.entries(filters).filter(([, v]) => v.trim() !== ""), [filters]);

  const filtered = useMemo(() => {
    if (active.length === 0) return rows;
    return rows.filter((row) => active.every(([key, text]) => matchesColumnFilter(getValue(row, key), text)));
  }, [rows, getValue, active]);

  return {
    filtered,
    filters,
    setFilter: (key: string, value: string) => setFilters((prev) => ({ ...prev, [key]: value })),
    clearFilters: () => setFilters({}),
    activeCount: active.length,
  };
}
