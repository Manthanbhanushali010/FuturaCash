import { describe, expect, it } from "vitest";
import { toTokenState } from "./client";
import type { TokenResponse } from "./schemas";
import type { XeroTenantConnection, XeroTokenState } from "./tokens";

const NOW = 1_760_000_000_000;

const tokens: TokenResponse = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 1800,
  token_type: "Bearer",
  scope: "accounting.invoices.read offline_access",
};

function connection(id: string, name: string): XeroTenantConnection {
  return { connectionId: `c-${id}`, tenantId: id, tenantName: name, tenantType: "ORGANISATION" };
}

describe("toTokenState", () => {
  it("binds automatically when exactly one organisation is authorised", () => {
    const state = toTokenState(tokens, [connection("t-1", "Demo Company (UK)")], null, NOW);

    expect(state.activeTenantId).toBe("t-1");
    expect(state.expiresAt).toBe(NOW + 1_800_000);
    expect(state.refreshToken).toBe("refresh-1");
  });

  it("refuses to guess when several organisations are authorised", () => {
    // Picking connections[0] here would show a company's books nobody chose.
    const state = toTokenState(
      tokens,
      [connection("t-1", "Demo Company (UK)"), connection("t-2", "JENKI Ltd")],
      null,
      NOW,
    );

    expect(state.activeTenantId).toBeNull();
    expect(state.connections).toHaveLength(2);
  });

  it("keeps the operator's existing selection across a refresh", () => {
    const previous = {
      activeTenantId: "t-2",
      connectedAt: "2026-01-01T00:00:00.000Z",
    } as XeroTokenState;

    const state = toTokenState(
      tokens,
      [connection("t-1", "Demo Company (UK)"), connection("t-2", "JENKI Ltd")],
      previous,
      NOW,
    );

    expect(state.activeTenantId).toBe("t-2");
    expect(state.connectedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("drops a selection whose organisation was disconnected inside Xero", () => {
    const previous = { activeTenantId: "t-gone", connectedAt: "2026-01-01T00:00:00.000Z" } as XeroTokenState;

    const state = toTokenState(
      tokens,
      [connection("t-1", "Demo Company (UK)"), connection("t-2", "JENKI Ltd")],
      previous,
      NOW,
    );

    expect(state.activeTenantId).toBeNull();
  });

  it("rebinds to the only remaining organisation after the others are revoked", () => {
    const previous = { activeTenantId: "t-gone", connectedAt: "2026-01-01T00:00:00.000Z" } as XeroTokenState;
    const state = toTokenState(tokens, [connection("t-1", "Demo Company (UK)")], previous, NOW);
    expect(state.activeTenantId).toBe("t-1");
  });

  it("always stores the rotated refresh token", () => {
    // Xero invalidates the old one on every refresh — persisting the new one is not optional.
    const previous = { refreshToken: "refresh-0", activeTenantId: "t-1" } as XeroTokenState;
    const state = toTokenState(
      { ...tokens, refresh_token: "refresh-2" },
      [connection("t-1", "Demo Company (UK)")],
      previous,
      NOW,
    );
    expect(state.refreshToken).toBe("refresh-2");
  });
});
