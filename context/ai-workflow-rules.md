# AI Workflow Rules

## Approach

Build this project incrementally using a spec-driven workflow. The context files define
what to build, how to build it, and the current state of progress; the specs in `/specs`
define each capability and its acceptance criteria. Always implement against these specs —
do not infer or invent behavior from scratch. For a financial product, acceptance is not
"it renders" or "unit tests pass"; acceptance is the numbers matching the golden datasets
in `/evals` within tolerance.

## Scoping Rules

- Work on one feature unit at a time.
- Prefer small, verifiable increments over large speculative changes.
- Do not combine unrelated system boundaries in a single implementation step.
- Size units to roughly a single working session.

## When to Split Work

Split an implementation step if it combines:

- UI changes and ingestion/background-job changes.
- Two or more unrelated integrations or API boundaries.
- Any financial calculation that does not yet have a golden-dataset assertion — the
  calculation and its verification come together, never code first and verify "later."
- Behavior not clearly defined in the context files or a spec.

If a change cannot be verified end to end quickly, the scope is too broad — split it.

## Handling Missing Requirements

- Do not invent product behavior not defined in the context files or specs.
- **Accounting and sector rules come from the accounting partner.** Never guess debtor/
  creditor logic, VAT/PAYE timing, reconciliation rules, or sector parameters. If a rule
  is missing or ambiguous, add it as an open question in `progress-tracker.md` and stop —
  do not approximate.
- If a requirement is ambiguous, resolve it in the relevant context file before implementing.

## Protected Files

Do not modify the following unless explicitly instructed:

- `components/ui/*` — generated shadcn/ui components.
- Applied database migrations — add a new migration instead of editing history.
- The golden datasets in `/evals/*` — never edit ground-truth data to make a test pass.
  If a test fails, the code is wrong, not the data.
- Provider contracts in `integrations/*` — change deliberately, with a note in the tracker.

## Keeping Docs in Sync

Update the relevant context file whenever implementation changes:

- System architecture, boundaries, or an invariant (`architecture.md`).
- Storage model decisions (`architecture.md`).
- Code conventions or standards (`code-standards.md`).
- Theme or component conventions (`ui-context.md`).
- Feature scope (`project-overview.md`).

## Before Moving to the Next Unit

1. The current unit works end to end within its defined scope.
2. No invariant defined in `architecture.md` was violated (check tenant isolation,
   read-only, append-only ledger, integer money explicitly).
3. Any financial calculation passes its golden-dataset assertion in `/evals`.
4. Auth and tenant ownership are enforced on every new data path.
5. `progress-tracker.md` reflects the completed work.
6. `npm run build` passes (and the eval harness is green).
