# Cash Flow Intelligence Platform (working title)

## Overview

A cash flow intelligence platform for finance teams at scale-up businesses (roughly
£1–50m revenue, 10–250 employees, 1–5 person finance functions) in retail, consumer
goods, and hospitality. It connects to their existing accounting software (Xero) and
banks, surfaces a real-time picture of their cash position, and lets them forecast,
model scenarios, and plan ahead with logic that understands how their sector actually
works. The win condition is becoming the **source of truth**: the moment a finance
director runs their board pack and lender report from this platform instead of Excel.

## Goals

1. Show a true, real-time consolidated cash position from connected banks + Xero.
2. Produce rolling forecasts (13-week and 12-month) accurate within ~10% of actuals.
3. Let a user model a scenario and see the cash impact immediately.
4. Get a new user from sign-up to value (connected + position + forecast + one
   scenario) in under 60 minutes.
5. Reach product-market fit signalled by finance managers sharing platform-generated
   reports with boards and lenders instead of building them in Excel.

## Core User Flow

1. User signs in (finance manager / FD / financial controller).
2. Connects Xero and their bank accounts (via the Open Banking aggregator).
3. Sees their real-time consolidated cash position — cleared cash plus what's committed.
4. Views the rolling 13-week and 12-month forecast, auto-built from accounting data
   and past payment behaviour.
5. Models a scenario ("what if we take this order / hire this person / delay this
   supplier payment?") and sees the cash impact.
6. Exports a board-ready or lender-ready cash flow report.

## Features

### Connectivity
- Xero integration (invoices, bills, chart of accounts, contacts).
- Open Banking bank feeds via aggregator (real-time balances + transactions).
- Manual product entry for items with no API (e.g. loans, asset finance).

### Real-time cash position
- Consolidated position across banks and entities, cleared vs committed.
- Banking-connections view; multi-bank, multi-account.

### Forecasting
- Rolling 13-week (daily/weekly) and 12-month (monthly) forecasts.
- Recurring-item detection; debtor/creditor-day timing; VAT/PAYE as future outflows.
- Forecast-vs-actual variance tracking with alerts.

### Scenario modelling
- Unlimited "what if" scenarios with immediate cash impact, on an editable grid.

### Sector logic (one sector first)
- Inventory cash-impact-ahead-of-sale (retail/consumer goods) **or** daily granularity
  + seasonal swings (hospitality). Configurable parameters.

### Recommendations ("Dark Arts")
- Surfaces solutions, not just problems: which supplier payment to push, funding
  options, the revenue upside of acting.

### Reports
- One-click board pack and lender-ready cash flow exports.

## Scope

### In Scope
- Read-only cash intelligence: connect, reconcile, forecast, recommend.
- Xero + UK Open Banking connectivity.
- One sector's logic, proven, before generalising.
- Multi-tenant SaaS with per-customer data isolation.

### Out of Scope
- Payment execution or any movement of money.
- Multi-currency treasury operations (FX dealing, pooling execution).
- Payroll processing or HR integration.
- Anything requiring FCA payment-services permissions.
- Second/third-tier bank funding marketplace.

## Success Criteria

1. **Spike (Phase 0):** The on-screen position from JENKI's real HSBC, Starling and
   Xero matches what the owner sees logging into each service, within tolerance.
2. **Alpha:** JENKI uses the live position + 13-week forecast weekly.
3. **Beta:** 5 finance teams actively sharing platform-generated reports.
4. **Forecast quality:** within ~10% of actuals on connected accounts.
