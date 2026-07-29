import { describe, expect, it } from "vitest";
import golden from "./golden/xero-money.golden.json";
import { decimalToMinorUnits, type Rounding } from "../core/decimal";

/**
 * EVAL GATE — invariant #5.
 *
 * The money boundary is the single point where a Xero decimal becomes a number we do
 * arithmetic on for the rest of its life. If a conversion here drifts by one penny, every
 * downstream position, forecast and recommendation is wrong and nothing else will catch it.
 *
 * A failure in this file fails CI. Do not adjust an expected value to make it pass — the
 * expected values are ground truth; the code is what moves.
 */

interface GoldenCase {
  value: number | string;
  digits: number;
  expected: number;
  rounding?: string;
  /** Math.round(value * 10^digits) returns the wrong answer for this value. */
  naiveRoundWrong?: boolean;
  /** value.toFixed(digits) returns the wrong answer for this value. */
  naiveToFixedWrong?: boolean;
  note?: string;
}

const cases = golden.cases as GoldenCase[];

describe("eval: Xero money conversion", () => {
  it("has a non-trivial golden dataset", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(cases)(
    "$value at $digits dp → $expected minor units ($note)",
    ({ value, digits, expected, rounding }) => {
      const mode = (rounding ?? "forbid") as Rounding;
      expect(decimalToMinorUnits(value, digits, mode)).toBe(expected);
    },
  );

  it("covers values where Math.round(value * 10^digits) is wrong", () => {
    const hazards = cases.filter((c) => c.naiveRoundWrong);
    expect(hazards.length).toBeGreaterThanOrEqual(5);

    // Assert the hazard is genuine. If a case stops being wrong under Math.round, the label
    // is stale and the dataset has drifted from the failure it was written to pin down.
    for (const testCase of hazards) {
      expect(Math.round(Number(testCase.value) * 10 ** testCase.digits)).not.toBe(testCase.expected);
    }
  });

  it("covers values where toFixed(digits) is wrong", () => {
    const hazards = cases.filter((c) => c.naiveToFixedWrong);
    expect(hazards.length).toBeGreaterThanOrEqual(5);

    for (const testCase of hazards) {
      expect(Number(Number(testCase.value).toFixed(testCase.digits)) * 10 ** testCase.digits)
        .not.toBe(testCase.expected);
    }
  });

  it("the two naive failure sets are disjoint — no cheap float trick covers both", () => {
    // This is the argument for having core/decimal.ts at all: neither shortcut is a subset
    // of the other, so neither can be patched into correctness by checking against the other.
    const roundWrong = cases.filter((c) => c.naiveRoundWrong).map((c) => String(c.value));
    const toFixedWrong = new Set(cases.filter((c) => c.naiveToFixedWrong).map((c) => String(c.value)));

    expect(roundWrong.length).toBeGreaterThan(0);
    expect(toFixedWrong.size).toBeGreaterThan(0);
    expect(roundWrong.filter((value) => toFixedWrong.has(value))).toEqual([]);
  });

  it("never returns a non-integer", () => {
    for (const testCase of cases) {
      const mode = (testCase.rounding ?? "forbid") as Rounding;
      expect(Number.isInteger(decimalToMinorUnits(testCase.value, testCase.digits, mode))).toBe(true);
    }
  });
});
