import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The project's first vitest config, added to make the Xero screen's rendering testable.
 *
 * Two things previously made a render test impossible, and both were cited as the reason the
 * `/xero` card states were only ever verified by loading production by hand:
 *
 *  1. `tsconfig.json` sets `jsx: "preserve"` for Next, so esbuild left JSX untransformed and
 *     a `.tsx` test could not even be parsed.
 *  2. The `@/*` path alias is a tsconfig/Next concern, so any module importing through it was
 *     unresolvable under vitest and tests had to use relative paths.
 *
 * Deliberately minimal. No `environment: "jsdom"` and no testing-library: the card is a
 * server component rendered with `renderToStaticMarkup`, which needs no DOM, and adding one
 * would invite tests that assert on behaviour this page does not have. Everything else is
 * left at vitest's defaults so the existing 23 test files keep running exactly as before.
 */
export default defineConfig({
  esbuild: {
    // `automatic` rather than `transform`: React 19, so no `import React` in the components.
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
