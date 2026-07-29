// THE EVAL GATE. Financial logic is "done" only when its output matches ground truth.
// Golden datasets (evals/golden/*.json) map real-shaped inputs to known-correct results.
// CI runs this; a mismatch fails the build like a broken test. NEVER edit golden data
// to make a test pass (ai-workflow-rules.md: Protected Files).
import { describe, it } from "vitest";
// import { computePosition } from "../core/position";
// import golden from "./golden/jenki-2026-06-01.json";

describe("cash position — golden dataset", () => {
  it.todo("matches JENKI's snapshot within tolerance on a fixed date");
  // const result = computePosition(golden.transactions);
  // expect(result.clearedMinor).toBe(golden.expected.clearedMinor);
  // expect(result.committedMinor).toBe(golden.expected.committedMinor);
});
