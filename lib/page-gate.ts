/**
 * Interim shared-password gate for the Xero screen and its routes.
 *
 * This is NOT the auth model — WorkOS is (see context/architecture.md). It exists to close
 * one specific window: tokens now persist in the database, so an unauthenticated `/xero`
 * would serve a real organisation's financial data to anyone who found the URL, permanently
 * rather than until the next cold start.
 *
 * Everything here must run on the EDGE runtime, because `middleware.ts` does. That rules out
 * `node:crypto`, so this uses Web Crypto and a hand-written constant-time compare rather than
 * reusing the `timingSafeEqual` pattern in lib/oauth-state.ts.
 *
 * The cookie holds a digest of the password rather than the password itself, so a stolen
 * cookie does not hand over the secret, and comparisons are always over equal-length strings.
 */

export const GATE_COOKIE = "futura_gate";
export const GATE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Domain-separated so this digest can never collide with a hash used elsewhere. */
const DOMAIN = "futura-page-gate-v1:";

export async function gateDigest(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(DOMAIN + password);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Length-independent compare. Both inputs here are hex digests, so lengths always match. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function isGateConfigured(): boolean {
  return Boolean(process.env.XERO_PAGE_PASSWORD);
}

/**
 * FAILS CLOSED. With no password configured nothing is unlocked, so forgetting the variable
 * in a deployment locks the page rather than silently exposing it. Every security defect
 * found on this project so far has been silent; this one is loud on purpose.
 */
export async function isUnlocked(cookieValue: string | undefined): Promise<boolean> {
  const password = process.env.XERO_PAGE_PASSWORD;
  if (!password || !cookieValue) return false;
  return constantTimeEqual(cookieValue, await gateDigest(password));
}

/** True when the submitted password is correct. Compared as digests, never as raw strings. */
export async function isPasswordCorrect(submitted: string): Promise<boolean> {
  const password = process.env.XERO_PAGE_PASSWORD;
  if (!password) return false;
  return constantTimeEqual(await gateDigest(submitted), await gateDigest(password));
}

/**
 * Only same-origin paths may be returned to. Without this the `next` parameter is an open
 * redirect: a crafted link would bounce an authenticated operator to an attacker's page.
 */
export function safeReturnPath(candidate: string | null | undefined): string {
  if (!candidate) return "/xero";
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/xero";
  return candidate;
}
