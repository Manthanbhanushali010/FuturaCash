import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * CSRF protection for the OAuth2 redirect.
 *
 * Without it, an attacker can hand the operator a crafted callback URL carrying THEIR
 * authorisation code and silently bind our app to an org they control. The state value is
 * minted here, held in an httpOnly cookie the page JavaScript cannot read, and must come
 * back byte-identical.
 */

export const OAUTH_STATE_COOKIE = "xero_oauth_state";
/**
 * 15 minutes, not 10.
 *
 * The window has to cover the entire Xero consent journey, which on a first connection is
 * sign-in, often 2FA, and then choosing an organisation. When the cookie expires mid-flow the
 * callback reports "State mismatch — the sign-in did not start here", which reads like a CSRF
 * attack rather than a timeout and sends you looking in the wrong place. Long enough to be
 * usable, short enough that a stolen state value is worthless by the time it is found.
 */
const STATE_TTL_SECONDS = 15 * 60;

export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function stateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  };
}

/** Constant-time comparison — a length-or-content leak here is a real oracle. */
export function statesMatch(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
