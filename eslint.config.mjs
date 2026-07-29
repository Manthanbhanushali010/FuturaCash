import { FlatCompat } from "@eslint/eslintrc";

// ESLint 9 flat config. `eslint-config-next` is still eslintrc-shaped, so it is bridged
// through FlatCompat rather than rewritten.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
