# forecast/ — Python forecasting service (FastAPI)

Consumes the ledger, returns 13-week and 12-month forecasts. Behind an interface so it
evolves independently. Start with recurring-item detection + simple ML; LLMs only for
natural-language features. Not built until Phase 3 (see context/progress-tracker.md).
