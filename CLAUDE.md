## Application Building Context

This is a **financial application**. It reads real bank and accounting data and
tells finance teams the truth about their cash. The non-negotiables below apply to
every change, before and regardless of anything in the context files. If a change
would violate one of these, it is wrong by definition — stop and resolve it.

### Non-negotiables

1. **Correctness over speed.** Every financial figure is verified against the golden
   datasets in `/evals` before it ships. Never trust a number because the code "looks
   right." A confidently wrong number is worse than no number.
2. **Read-only.** The product reads, forecasts, and recommends. It NEVER moves money.
   No payment execution, no transaction initiation. Any code path that would move
   funds is out of scope.
3. **Tenant isolation is absolute.** Customer financial data is isolated at the data
   layer (row-level security). No code path may ever read or write across tenants.
4. **Money is never a float.** Store and compute money as integer minor units (e.g.
   pennies) with an explicit currency code. Never use floating-point for money.
5. **The spec is the source of truth.** Non-trivial work begins from a spec in
   `/specs`. Do not infer or invent behavior from scratch.
6. **The human disposes.** Propose and implement, but the engineer reviews and
   approves every change. Never produce code that can't be evaluated against a spec.

### Read order

Read the following files in order before implementing or making any architectural
decision:

1. `context/project-overview.md` — product definition, goals, features, and scope
2. `context/architecture.md` — system structure, boundaries, storage model, and invariants
3. `context/ui-context.md` — theme, colors, typography, and component conventions
4. `context/code-standards.md` — implementation rules and conventions
5. `context/ai-workflow-rules.md` — development workflow, scoping rules, and delivery approach
6. `context/progress-tracker.md` — current phase, completed work, open questions, and next steps

Update `context/progress-tracker.md` after each meaningful implementation change.

If implementation changes the architecture, scope, or standards documented in the
context files, update the relevant file before continuing.
