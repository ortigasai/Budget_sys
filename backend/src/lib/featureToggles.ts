// The Admin Console's Hidden Menus: parts of the app that are built but not
// open yet, each switched on or off by the Budget Officer (FeatureToggle
// table; no row = off). backend-py reads the same table for the two its API
// enforces (app/feature_toggles.py).
export const FEATURE_TOGGLES = [
  {
    key: "manpowerBudget",
    label: "Manpower Budget",
    module: "Module 1 - Annual Budget Setting",
    whenOff: "The Manpower Budget menu is hidden for everyone.",
    whenOn: "The Manpower Budget menu shows for the HR Analyst, HR Head and Budget Officer.",
  },
  {
    key: "dashFlow",
    label: "Dash Flow Budget Check",
    module: "Module 2 - Budget Utilization Tracking",
    whenOff: "The menu shows for SBU Finance members, but the page says it isn't available yet and its API refuses every request.",
    whenOn: "SBU Finance Officers (own SBU) and the Budget Officer can use it.",
  },
  {
    key: "transfersModule",
    label: "Budget Transfer & Reallocation",
    module: "Module 3 - Budget Transfer & Reallocation",
    whenOff: "Only the Budget Officer can open the module; it's greyed out for everyone else.",
    whenOn: "The module is open to everyone with access to it.",
  },
] as const;

export type FeatureToggleKey = (typeof FEATURE_TOGGLES)[number]["key"];

export const FEATURE_TOGGLE_KEYS = FEATURE_TOGGLES.map((t) => t.key) as [FeatureToggleKey, ...FeatureToggleKey[]];
