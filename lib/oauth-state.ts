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
const STATE_TTL_SECONDS = 10 * 60;

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
