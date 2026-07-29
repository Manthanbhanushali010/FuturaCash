import type { Config } from "tailwindcss";
// Colors are driven by CSS tokens in app/globals.css (see context/ui-context.md).
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "var(--bg-base)",
        surface: "var(--bg-surface)",
        "surface-2": "var(--bg-surface-2)",
        primary: "var(--text-primary)",
        muted: "var(--text-muted)",
        accent: "var(--accent-primary)",
        ai: "var(--accent-ai)",
        border: "var(--border-default)",
        error: "var(--state-error)",
        success: "var(--state-success)",
      },
      borderRadius: { md: "0.5rem", xl: "0.875rem", "2xl": "1.25rem" },
    },
  },
  plugins: [],
};
export default config;
