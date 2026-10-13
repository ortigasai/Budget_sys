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
    description: "Set and approve each year's budget by department and SBU.",
    to: "/phase1",
  },
  {
    number: 2,
    title: "Budget Utilization Tracking",
    description: "Follow actual spending, commitments and balances against budget.",
    to: "/utilization",
  },
  {
    number: 3,
    title: "Budget Transfer & Reallocation",
    description: "Move budget between cost centers with a documented approval trail.",
    to: "/transfers",
  },
  {
    number: 4,
    title: "Budget Report & Analysis",
    description: "Compare budget, actual and forecast across periods and categories.",
    to: "/reports",
  },
];

export function phaseForPath(pathname: string): Phase {
  if (pathname.startsWith("/utilization") || pathname.startsWith("/dash-flow")) return PHASES[1];
  if (pathname.startsWith("/transfers") || pathname.startsWith("/internal-orders")) return PHASES[2];
  if (pathname.startsWith("/reports")) return PHASES[3];
  return PHASES[0];
}
