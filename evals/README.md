# evals/ — the verification gate

Golden datasets: real-shaped transactions mapped to known-correct cash positions and
forecasts. Every financial calculation asserts against these. This is what makes
AI-assisted money code safe to ship.

- `golden/` — fixed-date snapshots (e.g. jenki-2026-06-01.json). PROTECTED: never edit
  ground-truth data to make a test pass. If a test fails, the code is wrong.
- `harness.example.ts` — template assertion.

Run: `npm run eval`
