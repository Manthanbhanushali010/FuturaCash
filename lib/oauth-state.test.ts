import { describe, expect, it } from "vitest";
import { OAUTH_STATE_COOKIE, createOAuthState, stateCookieOptions, statesMatch } from "./oauth-state";

/**
 * The state cookie is the CSRF defence on the OAuth redirect, and its settings are the kind
 * of thing that gets "tidied" later without anyone realising what they protect. Each
 * assertion below pins a property that has a specific failure mode if changed.
 */

describe("oauth state cookie", () => {
  it("is SameSite=Lax, not Strict", () => {
    // The callback is a cross-site top-level navigation from login.xero.com. Strict would
    // withhold the cookie there and every connection would fail as a state mismatch.
    expect(stateCookieOptions().sameSite).toBe("lax");
  });

  it("is httpOnly", () => {
    expect(stateCookieOptions().httpOnly).toBe(true);
  });

  it("is scoped to the whole site", () => {
    // The cookie is set by /api/xero/connect and read by /api/xero/callback.
    expect(stateCookieOptions().path).toBe("/");
  });

  it("allows at least 15 minutes for the consent journey", () => {
    // First-time consent is sign-in, often 2FA, then choosing an org. Expiring mid-flow
    // surfaces as "State mismatch", which reads like an attack rather than a timeout.
    expect(stateCookieOptions().maxAge).toBeGreaterThanOrEqual(15 * 60);
  });

  it("does not outlive the flow it protects", () => {
    expect(stateCookieOptions().maxAge).toBeLessThanOrEqual(30 * 60);
  });
});

describe("state values", () => {
  it("are unguessable and unique", () => {
    const values = new Set(Array.from({ length: 50 }, () => createOAuthState()));
    expect(values.size).toBe(50);
    expect(createOAuthState().length).toBeGreaterThanOrEqual(40);
  });

  it("are url-safe, so they survive a redirect intact", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(createOAuthState()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("statesMatch", () => {
  it("accepts an exact match", () => {
    const state = createOAuthState();
    expect(statesMatch(state, state)).toBe(true);
  });

  it("rejects a mismatch", () => {
    expect(statesMatch(createOAuthState(), createOAuthState())).toBe(false);
  });

  it("rejects when the cookie is missing — the reported production symptom", () => {
    expect(statesMatch(createOAuthState(), undefined)).toBe(false);
  });

  it("rejects when the callback carries no state", () => {
    expect(statesMatch(undefined, createOAuthState())).toBe(false);
  });

  it("rejects a prefix, without throwing on length", () => {
    const state = createOAuthState();
    expect(statesMatch(state.slice(0, -1), state)).toBe(false);
  });

  it("uses a stable cookie name", () => {
    expect(OAUTH_STATE_COOKIE).toBe("xero_oauth_state");
  });
});
