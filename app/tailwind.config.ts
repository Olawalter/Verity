import type { Config } from "tailwindcss";

// §56 — institutional fintech + arbitration console. Not a crypto casino.
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f1effe", 100: "#e4e0fd", 200: "#cbc4fb", 300: "#a99ff8",
          400: "#8b7cf9", 500: "#6D5EF7", 600: "#5847e0", 700: "#4938b8",
          800: "#3b2e93", 900: "#2f2575",
        },
        info: {
          400: "#60A5FA", 500: "#3B82F6", 600: "#2563EB",
        },
        ink: {
          DEFAULT: "#111827", muted: "#6B7280", subtle: "#9CA3AF",
        },
        canvas: {
          DEFAULT: "#F7F8FC", raised: "#FFFFFF", sunken: "#EEF0F7",
          edge: "#E2E5EF",
        },
        night: {
          DEFAULT: "#0B0F1A", raised: "#141926", sunken: "#0F1420",
          edge: "#242B3D", text: "#E5E7EB", muted: "#9AA3B5",
        },
        ok: { DEFAULT: "#059669", soft: "#D1FAE5" },
        warn: { DEFAULT: "#B45309", soft: "#FEF3C7" },
        bad: { DEFAULT: "#DC2626", soft: "#FEE2E2" },
        neutral500: "#6B7280",
      },
      fontFamily: {
        sans: ["var(--font-geist)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: { xl: "0.875rem" },
    },
  },
  plugins: [],
};
export default config;
