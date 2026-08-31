import { describe, expect, it } from "vitest";
import { connectionPrompt } from "./index";
import { toTokenState } from "./client";
import type { TokenResponse } from "./schemas";
import type { XeroTenantConnection, XeroTokenState } from "./tokens";

/**
 * What happens when Xero stops reporting any authorised organisation.
 *
 * Observed in production on 2026-08-26: an unattended refresh re-read /connections, got an
 * empty list back, and the stored grant lost its organisation binding. The refresh itself was
 * correct — the Demo Company had hit its 28-day reset — but the screen then rendered an
 * organisation chooser with nothing in it and no explanation. A real customer disconnecting
 * the app from inside Xero produces exactly the same state.
 */

const ORG: XeroTenantConnection = {
  connectionId: "c-1",
  tenantId: "org-1",
  tenantName: "Demo Company (UK)",
  tenantType: "ORGANISATION",
};

const tokens = { access_token: "a", refresh_token: "r", expires_in: 1800, token_type: "Bearer", scope: "s" } as TokenResponse;

function previous(overrides: Partial<XeroTokenState> = {}): XeroTokenState {
  return {
    accessToken: "old", refreshToken: "old", expiresAt: 0, scope: "s",
    connections: [ORG], activeTenantId: "org-1", connectedAt: "2026-08-25T14:04:49.090Z",
    ...overrides,
  };
}

describe("connectionPrompt", () => {
  it("is ready when an organisation is bound", () => {
    expect(connectionPrompt({ activeTenantId: "org-1", connections: [ORG] })).toBe("ready");
  });

  it("asks the operator to choose when several are authorised", () => {
    expect(connectionPrompt({ activeTenantId: null, connections: [ORG, ORG] })).toBe("choose-organisation");
  });

  it("reports disconnection when NONE are authorised", () => {
    // The bug: this used to be indistinguishable from "choose", producing an empty chooser.
    expect(connectionPrompt({ activeTenantId: null, connections: [] })).toBe("disconnected-in-xero");
  });
});

describe("toTokenState when Xero reports no organisations", () => {
  it("still persists the rotated tokens", () => {
    // Discarding the result would throw away the only working refresh token and kill the
    // connection outright — worse than the empty state it is trying to avoid.
    const next = toTokenState(tokens, [], previous(), Date.UTC(2026, 7, 26, 19, 35));
    expect(next.refreshToken).toBe("r");
    expect(next.accessToken).toBe("a");
  });

  it("records the empty list faithfully rather than pretending", () => {
    const next = toTokenState(tokens, [], previous(), Date.UTC(2026, 7, 26, 19, 35));
    expect(next.connections).toHaveLength(0);
    expect(next.activeTenantId).toBeNull();
  });

  it("surfaces as a disconnection, not an empty chooser", () => {
    const next = toTokenState(tokens, [], previous(), Date.UTC(2026, 7, 26, 19, 35));
    expect(connectionPrompt(next)).toBe("disconnected-in-xero");
  });

  it("keeps connectedAt, so the original connection date is not lost", () => {
    const next = toTokenState(tokens, [], previous(), Date.UTC(2026, 7, 26, 19, 35));
    expect(next.connectedAt).toBe("2026-08-25T14:04:49.090Z");
  });

  it("re-binds automatically when the organisation comes back", () => {
    const next = toTokenState(tokens, [ORG], previous({ activeTenantId: null, connections: [] }), Date.now());
    expect(next.activeTenantId).toBe("org-1");
    expect(connectionPrompt(next)).toBe("ready");
  });

  it("never guesses when several organisations are authorised", () => {
    const other = { ...ORG, tenantId: "org-2", connectionId: "c-2" };
    const next = toTokenState(tokens, [ORG, other], previous({ activeTenantId: null }), Date.now());
    expect(next.activeTenantId).toBeNull();
    expect(connectionPrompt(next)).toBe("choose-organisation");
  });

  it("drops a binding whose organisation is no longer authorised", () => {
    const other = { ...ORG, tenantId: "org-2", connectionId: "c-2" };
    const next = toTokenState(tokens, [other], previous(), Date.now());
    expect(next.activeTenantId).toBe("org-2");
  });
});
