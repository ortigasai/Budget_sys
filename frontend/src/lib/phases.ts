// Single source of truth for the four phases (Functional Spec §1.1) - used
// by both PhaseMenuPage's tiles and Layout.tsx's in-phase top bar, so the
// title/description shown on the menu and the title/description shown once
// you're inside a phase can never say two different things.
export interface Phase {
  number: 1 | 2 | 3 | 4;
  title: string;
  description: string;
  // Route to enter this phase from the menu; null if the phase isn't built
  // yet (Phase 3/4 per current scope).
  to: string | null;
}

export const PHASES: Phase[] = [
  {
    number: 1,
    title: "Annual Budget Setting",
    description:
      "Requestors build departmental budget requests from the standardized expense catalog, routed through the 5-stage approval workflow with real-time cap/pool tracking, culminating in Board-Approved Budget sign-off and a manual SAP upload.",
    to: "/phase1",
  },
  {
    number: 2,
    title: "Budget Utilization Tracking",
    description:
      "Approved budget vs. actual expenditures and open commitments, per department and GL-CC, with live reconciliation against posted SAP activity and an exception queue for unmatched transactions.",
    to: "/utilization",
  },
  {
    number: 3,
    title: "Budget Transfer & Reallocation",
    description:
      "Fund transfers and supplemental budget requests routed by SBU and amount, through Department Head, SBU Finance, and (for larger amounts) CFO/CEO approval, with balance validation and audit tracking throughout.",
    to: "/transfers",
  },
  {
    number: 4,
    title: "Budget Report & Analysis",
    description:
      "Dynamic budget-vs-actual-vs-forecast dashboards at the CC-GL level, multi-year trend comparisons, and Excel extraction, without manual data consolidation.",
    to: "/reports",
  },
];

export function phaseForPath(pathname: string): Phase {
  if (pathname.startsWith("/utilization") || pathname.startsWith("/dash-flow")) return PHASES[1];
  if (pathname.startsWith("/transfers") || pathname.startsWith("/internal-orders")) return PHASES[2];
  if (pathname.startsWith("/reports")) return PHASES[3];
  return PHASES[0];
}
