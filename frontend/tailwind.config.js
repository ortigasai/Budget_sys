import defaultTheme from "tailwindcss/defaultTheme";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Plus Jakarta Sans'", ...defaultTheme.fontFamily.sans],
      },
      // Ortigas Land brand green (sampled from the official logo). Overrides
      // Tailwind's built-in `emerald` scale in place, so every existing
      // `bg-emerald-*` / `text-emerald-*` / `ring-emerald-*` class across the
      // app picks up the brand color automatically - anchor point is 700,
      // which matches the logo's exact tone.
      colors: {
        emerald: {
          50: "#edf6f1",
          100: "#d3eadf",
          200: "#a7d5bf",
          300: "#79be9e",
          400: "#4fa37e",
          500: "#34875f",
          600: "#216b4a",
          700: "#1b5e3f",
          800: "#164b33",
          900: "#123a28",
          950: "#0a241a",
        },
      },
    },
  },
  plugins: [],
};
