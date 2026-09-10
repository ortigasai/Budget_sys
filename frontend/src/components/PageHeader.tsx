import type { ReactNode } from "react";

// The green gradient banner (title + subtitle in a colored box) was removed
// per request - every module's title/category already shows in the
// sidebar, so repeating it in a big banner was pure duplication. This is
// now just a plain toolbar row: optional instructional text on the left,
// optional action buttons (Save Draft, Submit, etc.) right-aligned - no
// title, no color, no sticky positioning.
export function PageHeader({ subtitle, actions }: { subtitle?: ReactNode; actions?: ReactNode }) {
  if (!subtitle && !actions) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {subtitle && <div className="text-sm text-slate-500">{subtitle}</div>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
