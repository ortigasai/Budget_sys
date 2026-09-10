// Evaluates a catalog "Spend Grid Computation" formula (free text like
// "Headcount x Rate per Month (w/ OT)") against the Requestor's numeric
// Additional Field entries, so the Standard Request form can auto-fill and
// lock the Monthly Spend Grid per Notes_8 ("automatically computed based on
// the formula indicated and cannot be edited").
//
// The formula is prose, not a machine expression, so this never guesses: if
// a field referenced by the formula can't be confidently located in the
// text, or a value is missing, or leftover text doesn't reduce to numbers/
// operators, evaluation returns null and the caller must fall back to
// manual entry rather than show a fabricated number. Validated against
// every formula in the real "Budgeting System_Expense Line Items" catalog.

export interface FormulaFieldValue {
  label: string;
  value: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findFieldSpan(formula: string, label: string): { start: number; end: number } | null {
  const exactPattern = escapeRegex(label).replace(/\s+/g, "\\s+");
  let m = formula.match(new RegExp(exactPattern, "i"));
  if (m) return { start: m.index!, end: m.index! + m[0].length };

  // Fuzzy fallback: the catalog's "Additional Field" and "Spend Grid
  // Computation" columns sometimes word the same variable slightly
  // differently (e.g. "Average Daily Distance (km)" vs "Average Daily
  // Distance km", or "R&M Limit Amount per Month" vs "...per Vehicle per
  // Month") - require the field's words to appear in order, anything
  // in between.
  const words = label.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (words.length === 0) return null;
  const fuzzyPattern = words.map(escapeRegex).join(".*?");
  m = formula.match(new RegExp(fuzzyPattern, "i"));
  if (m) return { start: m.index!, end: m.index! + m[0].length };
  return null;
}

type Token = "(" | ")" | "*" | "/" | { num: number };

export function evaluateSpendGridFormula(formula: string | null | undefined, fields: FormulaFieldValue[]): number | null {
  if (!formula || !formula.trim()) return null;

  let working = formula;
  const placeholders: number[] = [];
  // Match longer (more specific) field labels first to reduce the chance a
  // short label's fuzzy match swallows part of a longer one.
  const sorted = [...fields].sort(
    (a, b) => b.label.split(/[^a-zA-Z0-9]+/).filter(Boolean).length - a.label.split(/[^a-zA-Z0-9]+/).filter(Boolean).length
  );
  for (const f of sorted) {
    const span = findFieldSpan(working, f.label);
    if (!span) return null; // formula references a field we can't locate
    if (Number.isNaN(f.value)) return null; // Requestor hasn't filled this in yet
    const idx = placeholders.length;
    placeholders.push(f.value);
    working = working.slice(0, span.start) + `@@${idx}@@` + working.slice(span.end);
  }

  // A rate expressed as a compound unit (e.g. "40km/L", 40 kilometers per
  // Liter) contains a "/" that isn't a real division — it's part of the
  // unit label. Left alone, the generic tokenizer below treats every "/" as
  // division and splits "40km/L" into "40km" (reduces to 40) and "L" (no
  // digit at all, fails to reduce to anything), making the whole formula
  // unparseable. Collapse "<number><letters>/<letters>" to just the leading
  // number first, before that generic "/" handling ever sees it. Requires a
  // bare digit immediately before the unit (not a "@@N@@" placeholder), so
  // this can't misfire on a real "fieldA / fieldB" division.
  working = working.replace(/(\d+(?:\.\d+)?)[a-zA-Z]+\s*\/\s*[a-zA-Z]+/g, "$1");

  const tokenRe = /\(|\)|[xX*]|\/|@@\d+@@|[^()xX*/@]+/g;
  const rawTokens = working.match(tokenRe) ?? [];
  const tokens: Token[] = [];
  for (const t of rawTokens) {
    if (t === "(" || t === ")" || t === "/") {
      tokens.push(t as "(" | ")" | "/");
      continue;
    }
    if (/^[xX*]$/.test(t)) {
      tokens.push("*");
      continue;
    }
    const phMatch = t.match(/^@@(\d+)@@$/);
    if (phMatch) {
      tokens.push({ num: placeholders[Number(phMatch[1])] });
      continue;
    }
    if (!t.trim()) continue; // whitespace-only chunk between tokens
    // Leftover descriptive text (e.g. "20 days per month") - extract its
    // leading number as a constant multiplier/divisor.
    const numMatch = t.match(/-?\d+(\.\d+)?/);
    if (!numMatch) return null; // can't reduce this chunk to a number
    tokens.push({ num: Number(numMatch[0]) });
  }

  let pos = 0;
  function parseExpr(): number | null {
    let val = parseTerm();
    if (val === null) return null;
    while (pos < tokens.length && (tokens[pos] === "*" || tokens[pos] === "/")) {
      const op = tokens[pos];
      pos++;
      const rhs = parseTerm();
      if (rhs === null) return null;
      val = op === "*" ? val * rhs : val / rhs;
    }
    return val;
  }
  function parseTerm(): number | null {
    if (pos >= tokens.length) return null;
    const t = tokens[pos];
    if (t === "(") {
      pos++;
      const v = parseExpr();
      if (v === null) return null;
      if (tokens[pos] !== ")") return null;
      pos++;
      return v;
    }
    if (typeof t === "object" && "num" in t) {
      pos++;
      return t.num;
    }
    return null;
  }

  const result = parseExpr();
  if (pos !== tokens.length) return null; // trailing unparsed tokens
  return result;
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

// Spreads a computed amount across the 12 monthly slots per the catalog's
// "Spend Grid Frequency" column - "Monthly" (or anything unrecognized)
// repeats the same amount every month; a specific month name (e.g. "July")
// posts the full amount in that month only.
export function spreadByFrequency(amount: number, frequency: string | null | undefined): number[] {
  const monthIndex = frequency ? MONTH_NAMES.indexOf(frequency.trim().toLowerCase()) : -1;
  if (monthIndex === -1) return Array(12).fill(amount);
  return Array.from({ length: 12 }, (_, i) => (i === monthIndex ? amount : 0));
}

// Notes_8: line items whose catalog frequency is "User to select which
// month" get a Requestor-facing "Spend Month" field instead of a fixed
// catalog month — same one-month placement as spreadByFrequency's specific-
// month case, just driven by the Requestor's own choice(s) rather than a
// name baked into the catalog. "Allow selection of multiple months" (Notes_8
// revision) posts the full computed amount into every selected month, not a
// divided share — the same amount each time the activity recurs.
export function spreadByMonthNumbers(amount: number, monthNumbers: number[]): number[] {
  const totals = Array(12).fill(0);
  for (const m of monthNumbers) {
    if (m >= 1 && m <= 12) totals[m - 1] = amount;
  }
  return totals;
}
