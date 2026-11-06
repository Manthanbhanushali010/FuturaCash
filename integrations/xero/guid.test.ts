import { describe, expect, it } from "vitest";
import { isXeroGuid, parseXeroGuid } from "./guid";

/** All synthetic. A valid-shaped id that names nothing real. */
const VALID = "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";

describe("isXeroGuid", () => {
  it("accepts a well-formed GUID", () => {
    expect(isXeroGuid(VALID)).toBe(true);
  });

  it("accepts upper and mixed case, which Xero does return", () => {
    expect(isXeroGuid(VALID.toUpperCase())).toBe(true);
    expect(isXeroGuid("0A1b2C3d-4E5f-6A7b-8C9d-0E1f2A3b4C5d")).toBe(true);
  });

  it("rejects the null GUID, which is shape-valid but names nothing", () => {
    expect(isXeroGuid("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(isXeroGuid("00000000-0000-0000-0000-000000000000".toUpperCase())).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["a bare word", "batch"],
    ["too few groups", "0a1b2c3d-4e5f-6a7b-8c9d"],
    ["too many groups", `${VALID}-0e1f2a3b4c5d`],
    ["a group one digit short", "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5"],
    ["a group one digit long", "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5dd"],
    ["non-hex digits", "0a1b2c3g-4e5f-6a7b-8c9d-0e1f2a3b4c5d"],
    ["braced form", `{${VALID}}`],
    ["urn form", `urn:uuid:${VALID}`],
    ["underscores for hyphens", VALID.replace(/-/g, "_")],
    ["no hyphens", VALID.replace(/-/g, "")],
    ["leading whitespace", ` ${VALID}`],
    ["trailing whitespace", `${VALID} `],
    ["an embedded newline", `${VALID}\n`],
  ])("rejects %s", (_label, value) => {
    expect(isXeroGuid(value)).toBe(false);
  });

  /**
   * The reason this module exists. Each of these would, unvalidated, be interpolated into
   * `where=BatchPaymentID==guid("<id>")` and change the clause's meaning.
   */
  it.each([
    ['a closing quote and a disjunction', `${VALID}")||Status=="AUTHORISED`],
    ["a closing quote alone", `${VALID}"`],
    ["a quote at the front", `"${VALID}`],
    ["an appended clause", `${VALID}&&Status=="DELETED"`],
    ["a guid() wrapper", `guid("${VALID}")`],
    ["a comment terminator", `${VALID}--`],
    ["a URL-encoded quote", `${VALID}%22`],
    ["a path traversal", `../${VALID}`],
    ["a trailing slash", `${VALID}/`],
  ])("refuses clause injection via %s", (_label, value) => {
    expect(isXeroGuid(value)).toBe(false);
  });

  it("is anchored, so a valid prefix does not carry a malicious suffix", () => {
    // Without ^ and $ this is the case that gets through.
    expect(isXeroGuid(`${VALID}") or true--`)).toBe(false);
  });

  it.each([null, undefined, 0, 1, true, false, {}, [], [VALID]])(
    "rejects the non-string %s",
    (value) => {
      expect(isXeroGuid(value)).toBe(false);
    },
  );
});

describe("parseXeroGuid", () => {
  it("returns the value when it is a GUID", () => {
    expect(parseXeroGuid(VALID)).toBe(VALID);
  });

  it("returns null rather than throwing, so a bad URL is a page state", () => {
    expect(parseXeroGuid("nope")).toBeNull();
    expect(parseXeroGuid(undefined)).toBeNull();
  });
});
