import { describe, expect, it } from "vitest";
import { parseXeroDate, toCalendarDay } from "./dates";

describe("parseXeroDate", () => {
  it("parses the legacy .NET form Xero actually sends", () => {
    expect(parseXeroDate("/Date(1552262400000+0000)/")).toBe("2019-03-11T00:00:00.000Z");
    expect(parseXeroDate("/Date(1552262400000)/")).toBe("2019-03-11T00:00:00.000Z");
  });

  it("prefers the plain *String twin when present", () => {
    expect(parseXeroDate("/Date(1552262400000+0000)/", "2019-03-11T00:00:00")).toBe(
      "2019-03-11T00:00:00.000Z",
    );
  });

  it("accepts a date-only string", () => {
    expect(parseXeroDate(undefined, "2026-08-16")).toBe("2026-08-16T00:00:00.000Z");
  });

  it("preserves an explicit zone when one is given", () => {
    expect(parseXeroDate(undefined, "2019-03-11T12:00:00Z")).toBe("2019-03-11T12:00:00.000Z");
  });

  it("returns null when the field is absent", () => {
    expect(parseXeroDate(undefined)).toBeNull();
    expect(parseXeroDate("")).toBeNull();
  });

  it("throws rather than guessing at an unrecognised format", () => {
    // A misread due date silently moves cash into the wrong forecast week.
    expect(() => parseXeroDate("11/03/2019")).toThrow(/Unrecognised/);
    expect(() => parseXeroDate(undefined, "next Tuesday")).toThrow(/Unrecognised/);
  });
});

describe("toCalendarDay", () => {
  it("extracts the day the forecast buckets on", () => {
    expect(toCalendarDay("2026-08-16T00:00:00.000Z")).toBe("2026-08-16");
  });
});
