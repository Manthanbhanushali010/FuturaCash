import type { Config } from "tailwindcss";
// Colors are driven by CSS tokens in app/globals.css (see context/ui-context.md).
//
// Two deliberately separate visual layers (see the palette decision in
// ui-context.md): the app tokens below drive the treasury UI, and the `futura-*`
// marketing tokens drive the landing page only. The marketing keys are scoped by
// the `.futura-landing` wrapper in globals.css, so they cannot reach /xero.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // App layer.
        base: "var(--bg-base)",
        // Channel form so the marketing layer can re-point it and so opacity
        // modifiers compile; resolves to #111E33 everywhere outside .futura-landing.
        surface: "rgb(var(--bg-surface-rgb) / <alpha-value>)",
        "surface-2": "var(--bg-surface-2)",
        primary: "var(--text-primary)",
        muted: "var(--text-muted)",
        accent: "var(--accent-primary)",
        ai: "var(--accent-ai)",
        border: "var(--border-default)",
        error: "var(--state-error)",
        success: "var(--state-success)",

        // Marketing layer — landing page only.
        navy: "rgb(var(--futura-navy) / <alpha-value>)",
        "surface-elevated": "rgb(var(--futura-surface-elevated) / <alpha-value>)",
        "accent-blue": "rgb(var(--futura-accent-blue) / <alpha-value>)",
        "text-primary": "var(--futura-text-primary)",
        "text-secondary": "var(--futura-text-secondary)",
        "text-tertiary": "var(--futura-text-tertiary)",
        divider: "var(--futura-divider)",
      },
      // lg/xl read a variable with the app value as the fallback, so the app
      // scale is unchanged; .futura-landing overrides them to Lovable's radii.
      borderRadius: {
        md: "0.5rem",
        lg: "var(--radius-lg, 0.5rem)",
        xl: "var(--radius-xl, 0.875rem)",
        "2xl": "1.25rem",
      },
    },
  },
  plugins: [],
};
export default config;
