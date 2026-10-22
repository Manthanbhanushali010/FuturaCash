import { describe, expect, it } from "vitest";

import { XERO_SCOPES } from "./config";
import { missingScopes } from "./index";

const ALL = XERO_SCOPES.join(" ");
const allExcept = (omit: string) => XERO_SCOPES.filter((s) => s !== omit).join(" ");

/**
 * The re-consent guard on /xero is `missingScopes(grant.scope).length > 0`, and the list it
 * shows is a map over that same array. So this function IS the guard: if it under-reports, the
 * screen silently stops asking for a re-authorisation, which is the exact failure that made
 * the payments ask get relayed out of band instead of appearing on screen.
 */
describe("missingScopes — the re-consent guard", () => {
  it("reports nothing when the grant holds every requested scope", () => {
    expect(missingScopes(ALL)).toEqual([]);
  });

  it("reports exactly the payments scope when that is the only one withheld", () => {
    // Luke's actual state on 2026-10-20: consented 6 Sep, before the scope was requested.
    expect(missingScopes(allExcept("accounting.payments.read"))).toEqual([
      "accounting.payments.read",
    ]);
  });

  // The generalisation, stated as a property rather than as two cases. Withholding ANY single
  // requested scope must surface that scope -- not just the two that happen to carry
  // human-readable descriptions in the JSX. This is what fails if someone ever reintroduces a
  // hardcoded scope check, and it covers a tenth scope automatically on the day it is added.
  it.each(XERO_SCOPES)("detects %s when it alone is withheld", (scope) => {
    expect(missingScopes(allExcept(scope))).toEqual([scope]);
  });

  it("every requested scope is detectable — no hardcoded subset", () => {
    expect(missingScopes("")).toEqual([...XERO_SCOPES]);
  });

  it("ignores scopes the grant holds that the code no longer asks for", () => {
    // The removed broad scope, plus one Xero may hand back unasked.
    expect(missingScopes(`${ALL} accounting.transactions accounting.reports.read`)).toEqual([]);
  });

  it("preserves the requested order, so the list reads consistently", () => {
    const withheld = ["accounting.invoices.read", "accounting.payments.read"];
    expect(missingScopes(XERO_SCOPES.filter((s) => !withheld.includes(s)).join(" "))).toEqual(
      withheld,
    );
  });

  it("treats a grant of irregular whitespace the same as a clean one", () => {
    expect(missingScopes(`  ${XERO_SCOPES.join("\t ")}\n`)).toEqual([]);
  });

  it("treats an absent grant string as everything missing, never as satisfied", () => {
    expect(missingScopes("   ")).toEqual([...XERO_SCOPES]);
  });
});
