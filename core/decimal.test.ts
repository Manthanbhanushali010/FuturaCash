import { describe, expect, it } from "vitest";
import { decimalToMinorUnits, minorUnitsToDecimalString } from "./decimal";

describe("decimalToMinorUnits", () => {
  it("converts ordinary two-decimal amounts", () => {
    expect(decimalToMinorUnits(1234.55, 2)).toBe(123455);
    expect(decimalToMinorUnits(0, 2)).toBe(0);
    expect(decimalToMinorUnits(0.01, 2)).toBe(1);
    expect(decimalToMinorUnits(-99.99, 2)).toBe(-9999);
  });

  it("pads values with fewer decimals than the scale", () => {
    expect(decimalToMinorUnits(12, 2)).toBe(1200);
    expect(decimalToMinorUnits(12.5, 2)).toBe(1250);
    expect(decimalToMinorUnits("12.", 2)).toBe(1200);
    expect(decimalToMinorUnits(".5", 2)).toBe(50);
  });

  it("survives the values where Math.round(x * 100) is wrong", () => {
    // These are the whole reason this module exists — see the header comment in decimal.ts.
    expect(Math.round(1.005 * 100)).toBe(100); // the naive result, demonstrably wrong
    expect(decimalToMinorUnits(1.005, 2, "half-up")).toBe(101);

    expect(Math.round(0.145 * 100)).toBe(14); // wrong
    expect(decimalToMinorUnits(0.145, 2, "half-up")).toBe(15);

    expect(Math.round(8.165 * 100)).toBe(816); // wrong
    expect(decimalToMinorUnits(8.165, 2, "half-up")).toBe(817);

    expect(Math.round(1.255 * 100)).toBe(125); // wrong
    expect(decimalToMinorUnits(1.255, 2, "half-up")).toBe(126);
  });

  it("survives the values where toFixed(2) is wrong", () => {
    // A DIFFERENT set of values from the Math.round failures above — which is why neither
    // naive approach can be used to sanity-check the other.
    expect((0.615).toFixed(2)).toBe("0.61"); // wrong
    expect(decimalToMinorUnits(0.615, 2, "half-up")).toBe(62);

    expect((1.045).toFixed(2)).toBe("1.04"); // wrong
    expect(decimalToMinorUnits(1.045, 2, "half-up")).toBe(105);

    expect((2.675).toFixed(2)).toBe("2.67"); // wrong
    expect(decimalToMinorUnits(2.675, 2, "half-up")).toBe(268);

    expect((1.115).toFixed(2)).toBe("1.11"); // wrong
    expect(decimalToMinorUnits(1.115, 2, "half-up")).toBe(112);
  });

  it("is exact across magnitudes a real ledger reaches", () => {
    expect(decimalToMinorUnits(1234567.89, 2)).toBe(123456789);
    expect(decimalToMinorUnits(-480000.0, 2)).toBe(-48000000); // JENKI's week-8 trough
    expect(decimalToMinorUnits("99999999.99", 2)).toBe(9999999999);
  });

  it("refuses to silently drop precision by default", () => {
    expect(() => decimalToMinorUnits(1.005, 2)).toThrow(/more precision/);
    expect(() => decimalToMinorUnits("10.2549", 2)).toThrow(/more precision/);
  });

  it("rounds half away from zero when explicitly asked", () => {
    expect(decimalToMinorUnits("2.345", 2, "half-up")).toBe(235);
    expect(decimalToMinorUnits("-2.345", 2, "half-up")).toBe(-235);
    expect(decimalToMinorUnits("2.344", 2, "half-up")).toBe(234);
    expect(decimalToMinorUnits("-2.344", 2, "half-up")).toBe(-234);
    // Just above and below the halfway point, at 4dp precision.
    expect(decimalToMinorUnits("2.3450001", 2, "half-up")).toBe(235);
    expect(decimalToMinorUnits("2.3449999", 2, "half-up")).toBe(234);
  });

  it("handles zero-decimal currencies", () => {
    expect(decimalToMinorUnits(1500, 0)).toBe(1500); // JPY: 1 minor unit is 1 yen
    expect(decimalToMinorUnits("1500.4", 0, "half-up")).toBe(1500);
    expect(decimalToMinorUnits("1500.5", 0, "half-up")).toBe(1501);
  });

  it("handles four-decimal scales used by unit prices", () => {
    expect(decimalToMinorUnits("1.2345", 4)).toBe(12345);
    expect(decimalToMinorUnits(0.0001, 4)).toBe(1);
  });

  it("rejects values it cannot convert exactly", () => {
    expect(() => decimalToMinorUnits(Number.NaN, 2)).toThrow(/non-finite/);
    expect(() => decimalToMinorUnits(Number.POSITIVE_INFINITY, 2)).toThrow(/non-finite/);
    expect(() => decimalToMinorUnits("1,234.56", 2)).toThrow(/plain decimal/);
    expect(() => decimalToMinorUnits("£12.00", 2)).toThrow(/plain decimal/);
    expect(() => decimalToMinorUnits("", 2)).toThrow(/plain decimal/);
    expect(() => decimalToMinorUnits(1e-7, 2)).toThrow(/plain-decimal range/);
    expect(() => decimalToMinorUnits(1e21, 2)).toThrow(/plain-decimal range/);
  });

  it("rejects amounts beyond the safe integer range", () => {
    expect(() => decimalToMinorUnits("100000000000000000.00", 2)).toThrow(/safe integer/);
  });
});

describe("minorUnitsToDecimalString", () => {
  it("round-trips", () => {
    for (const value of [0, 1, -1, 123455, -9999, 123456789]) {
      expect(decimalToMinorUnits(minorUnitsToDecimalString(value, 2), 2)).toBe(value);
    }
  });

  it("pads sub-unit amounts", () => {
    expect(minorUnitsToDecimalString(5, 2)).toBe("0.05");
    expect(minorUnitsToDecimalString(-5, 2)).toBe("-0.05");
    expect(minorUnitsToDecimalString(1500, 0)).toBe("1500");
  });
});
