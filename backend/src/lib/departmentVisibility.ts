import { canonicalDepartmentName } from "./departmentAliases";

// Expense Line Items column R ("Visible only to") can name several
// departments separated by commas - "Office of the CFO, Corporate Finance".
// Some real department names contain a comma themselves ("Budget, Controls &
// Analysis"), so known names are matched first: the whole cell, then the
// longest run of comma-separated pieces that forms a known name. A piece
// that matches nothing is taken on its own (the import creates it, as it
// always has for unknown names).
export function splitDepartmentList(raw: string | null | undefined, knownNames: Iterable<string>): string[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  const known = new Set([...knownNames].map((n) => n.toLowerCase()));
  const isKnown = (name: string) => known.has(canonicalDepartmentName(name).toLowerCase());
  const exactName = (name: string) => {
    const canonical = canonicalDepartmentName(name);
    return [...knownNames].find((n) => n.toLowerCase() === canonical.toLowerCase()) ?? canonical;
  };

  if (isKnown(text)) return [exactName(text)];

  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const names: string[] = [];
  for (let i = 0; i < parts.length; ) {
    let taken = 1;
    for (let j = parts.length; j > i + 1; j--) {
      if (isKnown(parts.slice(i, j).join(", "))) {
        taken = j - i;
        break;
      }
    }
    names.push(exactName(parts.slice(i, i + taken).join(", ")));
    i += taken;
  }
  return [...new Set(names)];
}
