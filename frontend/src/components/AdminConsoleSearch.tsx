import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ADMIN_TABS } from "../pages/admin/AdminConsolePage";

// Finds an Admin Console section by its name, its group (General, GAE, ...)
// or words for what it contains, and jumps to it.
export function AdminConsoleSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return ADMIN_TABS.map((tab) => {
      const label = tab.label.toLowerCase();
      const haystack = `${label} ${tab.group.toLowerCase()} ${tab.keywords}`;
      if (!words.every((w) => haystack.includes(w))) return null;
      // Name matches first, then group/keyword-only matches.
      const rank = label.startsWith(words[0]) ? 0 : words.every((w) => label.includes(w)) ? 1 : 2;
      return { tab, rank };
    })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.rank - b.rank || a.tab.label.localeCompare(b.tab.label))
      .map((r) => r.tab);
  }, [query]);

  const go = (id: string) => {
    navigate(`/admin?tab=${id}`);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative mx-6 w-full max-w-md">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            go(results[active].id);
          } else if (e.key === "Escape") {
            setQuery("");
            setOpen(false);
          }
        }}
        placeholder="Search the Admin Console…"
        aria-label="Search the Admin Console"
        role="combobox"
        aria-expanded={open && query.trim() !== ""}
        aria-controls="admin-search-results"
        className="w-full rounded-md border border-white/25 bg-white/10 px-3 py-1.5 text-sm text-white placeholder:text-white/60 focus:border-white/60 focus:bg-white/15 focus:outline-none"
      />
      {open && query.trim() !== "" && (
        <ul id="admin-search-results" role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">No sections match "{query.trim()}".</li>
          ) : (
            results.map((tab, i) => (
              <li key={tab.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(tab.id)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${i === active ? "bg-emerald-50 text-emerald-900" : "text-slate-700"}`}
                >
                  <span>{tab.label}</span>
                  <span className="shrink-0 text-xs text-slate-400">{tab.group}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
