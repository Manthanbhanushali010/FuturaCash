import { decimalToMinorUnits } from "../../core/decimal";
import { minorUnitDigits, money, parseCurrency, type CurrencyCode, type Money } from "../../core/money";
import type {
  CommitmentDirection,
  CommitmentStatus,
  NormalisationResult,
  NormalisedCommitment,
  NormalisedLedgerAccount,
} from "../types";
import { parseXeroDate } from "./dates";
import type {
  PaymentSource,
  XeroAccount,
  XeroBankTransaction,
  XeroBatchPayment,
  XeroCreditNote,
  XeroInvoice,
  XeroPayment,
  XeroTrackingEntry,
  XeroUnallocatedCredit,
} from "./schemas";
import type {
  NormalisedBankTransaction,
  NormalisedCreditNote,
  NormalisedCreditNoteLine,
  NormalisedProviderPayment,
  NormalisedTracking,
} from "./types";

/**
 * Xero → internal model. This file is the anti-corruption boundary (invariant #6): past it,
 * nothing in the codebase knows the word "Xero". Everything here is pure — no I/O — so the
 * conversions can be asserted against golden values in evals/.
 */

/**
 * Xero's ACCREC/ACCPAY is the whole direction signal, so an unrecognised type is fatal for
 * that record rather than defaulted — guessing the direction would flip cash in the forecast.
 */
function toDirection(invoiceType: string): CommitmentDirection {
  switch (invoiceType) {
    case "ACCREC": // sales invoice — customer owes us
      return "INFLOW";
    case "ACCPAY": // bill — we owe a supplier
      return "OUTFLOW";
    default:
      throw new Error(`Unrecognised Xero invoice type "${invoiceType}"`);
  }
}

function toStatus(status: string): CommitmentStatus {
  switch (status) {
    case "DRAFT":
      return "DRAFT";
    case "SUBMITTED":
      return "SUBMITTED";
    case "AUTHORISED":
      return "AUTHORISED";
    case "PAID":
      return "PAID";
    case "VOIDED":
      return "VOIDED";
    case "DELETED":
      return "DELETED";
    default:
      return "UNKNOWN";
  }
}

/**
 * Convert a Xero money field to integer minor units.
 *
 * Totals and outstanding amounts are 2dp in Xero, so extra precision here means our
 * assumption is wrong and we stop (`rounding: "forbid"`) rather than quietly rounding.
 */
function toMoney(value: number | undefined, currency: CurrencyCode, field: string): Money {
  if (value === undefined) return money(0, currency);
  try {
    return money(decimalToMinorUnits(value, minorUnitDigits(currency)), currency);
  } catch (error) {
    throw new Error(`${field}: ${(error as Error).message}`);
  }
}

export interface NormaliseInvoiceOptions {
  /** Org base currency, used when an invoice omits CurrencyCode. */
  fallbackCurrency: CurrencyCode;
}

export function normaliseInvoice(
  invoice: XeroInvoice,
  options: NormaliseInvoiceOptions,
): NormalisedCommitment {
  const currency = invoice.CurrencyCode
    ? parseCurrency(invoice.CurrencyCode)
    : options.fallbackCurrency;

  return {
    externalId: invoice.InvoiceID,
    provider: "XERO",
    documentNumber: invoice.InvoiceNumber ?? null,
    reference: invoice.Reference ?? null,
    direction: toDirection(invoice.Type),
    status: toStatus(invoice.Status),
    providerStatus: invoice.Status,
    counterpartyName: invoice.Contact?.Name ?? null,
    counterpartyExternalId: invoice.Contact?.ContactID ?? null,
    issuedAt: parseXeroDate(invoice.Date, invoice.DateString),
    dueAt: parseXeroDate(invoice.DueDate, invoice.DueDateString),
    total: toMoney(invoice.Total, currency, "Total"),
    amountDue: toMoney(invoice.AmountDue, currency, "AmountDue"),
    amountPaid: toMoney(invoice.AmountPaid, currency, "AmountPaid"),
    raw: invoice,
  };
}

/**
 * Xero's Type is the whole direction signal for a bank transaction, so an unrecognised value
 * is fatal for that record rather than defaulted. Guessing would flip cash in the forecast —
 * the same reasoning as `toDirection` for invoices.
 *
 * The variants are real: an overpayment, a prepayment and a bank transfer each arrive as a
 * distinct Type, and all of them move money in a known direction.
 */
function toBankDirection(type: string): CommitmentDirection {
  if (type.startsWith("RECEIVE")) return "INFLOW";
  if (type.startsWith("SPEND")) return "OUTFLOW";
  throw new Error(`Unrecognised Xero bank transaction type "${type}"`);
}

export interface NormaliseBankTransactionOptions {
  /** Org base currency, used when a transaction omits CurrencyCode. */
  fallbackCurrency: CurrencyCode;
}

export function normaliseBankTransaction(
  transaction: XeroBankTransaction,
  options: NormaliseBankTransactionOptions,
): NormalisedBankTransaction {
  const currency = transaction.CurrencyCode
    ? parseCurrency(transaction.CurrencyCode)
    : options.fallbackCurrency;

  return {
    externalId: transaction.BankTransactionID,
    provider: "XERO",
    direction: toBankDirection(transaction.Type),
    providerType: transaction.Type,
    status: toStatus(transaction.Status ?? ""),
    providerStatus: transaction.Status ?? "",
    reference: transaction.Reference ?? null,
    description: firstDescription(transaction),
    // Absent means not reconciled — never assume a match we were not told about.
    isReconciled: transaction.IsReconciled ?? false,
    counterpartyName: transaction.Contact?.Name ?? null,
    counterpartyExternalId: transaction.Contact?.ContactID ?? null,
    bankAccountExternalId: transaction.BankAccount?.AccountID ?? null,
    bankAccountName: transaction.BankAccount?.Name ?? null,
    bankAccountCode: transaction.BankAccount?.Code ?? null,
    bookedAt: parseXeroDate(transaction.Date, transaction.DateString),
    currency,
    subTotal: toMoney(transaction.SubTotal, currency, "SubTotal"),
    totalTax: toMoney(transaction.TotalTax, currency, "TotalTax"),
    total: toMoney(transaction.Total, currency, "Total"),
    raw: transaction,
  };
}

/**
 * The first line item carrying a description.
 *
 * Bank transactions are usually single-line, so "first" is almost always "the only one".
 * Where there are several, joining them would produce a long unreadable cell and lose the
 * per-line amounts that give them meaning; showing the first matches what Xero's own bank
 * view leads with. Whitespace-only descriptions count as absent.
 */
function firstDescription(transaction: XeroBankTransaction): string | null {
  for (const line of transaction.LineItems ?? []) {
    const text = line.Description?.trim();
    if (text) return text;
  }
  return null;
}

export function normaliseBankTransactions(
  transactions: readonly XeroBankTransaction[],
  options: NormaliseBankTransactionOptions,
): NormalisationResult<NormalisedBankTransaction> {
  return collect(
    transactions,
    (transaction) => normaliseBankTransaction(transaction, options),
    (transaction) => transaction.BankTransactionID,
  );
}

/**
 * Direction for the payment family. Fatal on an unrecognised type, as everywhere else — a
 * guessed direction flips cash in the forecast.
 *
 * ACCREC* is money in (a customer settling our invoice), ACCPAY* money out (us settling a
 * bill). RECBATCH/PAYBATCH are the batch equivalents. Prepayments and overpayments use the
 * same ACCREC/ACCPAY prefixes.
 */
function toPaymentDirection(type: string): CommitmentDirection {
  if (type.startsWith("ACCREC") || type === "RECBATCH") return "INFLOW";
  if (type.startsWith("ACCPAY") || type === "PAYBATCH") return "OUTFLOW";
  throw new Error(`Unrecognised Xero payment type "${type}"`);
}

export interface NormalisePaymentOptions {
  fallbackCurrency: CurrencyCode;
}

export function normalisePayment(
  payment: XeroPayment,
  options: NormalisePaymentOptions,
): NormalisedProviderPayment {
  const currency = options.fallbackCurrency;
  return {
    externalId: payment.PaymentID,
    provider: "XERO",
    source: "PAYMENT",
    direction: toPaymentDirection(payment.PaymentType ?? ""),
    providerType: payment.PaymentType ?? "",
    status: toStatus(payment.Status ?? ""),
    providerStatus: payment.Status ?? "",
    reference: payment.Reference ?? null,
    isReconciled: payment.IsReconciled ?? false,
    counterpartyName: payment.Invoice?.Contact?.Name ?? null,
    documentNumber: payment.Invoice?.InvoiceNumber ?? null,
    documentExternalId: payment.Invoice?.InvoiceID ?? null,
    accountExternalId: payment.Account?.AccountID ?? null,
    accountCode: payment.Account?.Code ?? null,
    paidAt: parseXeroDate(payment.Date, undefined),
    currency,
    amount: toMoney(payment.Amount, currency, "Amount"),
    // Already applied to a document by definition.
    remainingCredit: money(0, currency),
    raw: payment,
  };
}

export function normaliseBatchPayment(
  batch: XeroBatchPayment,
  options: NormalisePaymentOptions,
): NormalisedProviderPayment {
  const currency = options.fallbackCurrency;
  return {
    externalId: batch.BatchPaymentID,
    provider: "XERO",
    source: "BATCH_PAYMENT",
    direction: toPaymentDirection(batch.Type ?? ""),
    providerType: batch.Type ?? "",
    status: toStatus(batch.Status ?? ""),
    providerStatus: batch.Status ?? "",
    // Xero offers several narrative fields on a batch and populates them inconsistently;
    // first non-empty wins. Which one is actually used by JENKI is a question for the survey.
    reference:
      [batch.Reference, batch.Narrative, batch.Particulars, batch.Details]
        .map((value) => value?.trim())
        .find((value) => value) ?? null,
    isReconciled: batch.IsReconciled ?? false,
    counterpartyName: null, // a batch spans many contacts
    documentNumber: null,
    documentExternalId: null,
    accountExternalId: batch.Account?.AccountID ?? null,
    accountCode: batch.Account?.Code ?? null,
    paidAt: parseXeroDate(batch.Date, undefined),
    currency,
    amount: toMoney(batch.Amount, currency, "Amount"),
    remainingCredit: money(0, currency),
    raw: batch,
  };
}

/** Prepayments and overpayments share a shape; `source` distinguishes them. */
export function normaliseUnallocatedCredit(
  credit: XeroUnallocatedCredit,
  source: Extract<PaymentSource, "PREPAYMENT" | "OVERPAYMENT">,
  options: NormalisePaymentOptions,
): NormalisedProviderPayment {
  const currency = credit.CurrencyCode
    ? parseCurrency(credit.CurrencyCode)
    : options.fallbackCurrency;
  const id = credit.PrepaymentID ?? credit.OverpaymentID;
  if (!id) {
    throw new Error(`${source} is missing both PrepaymentID and OverpaymentID`);
  }
  return {
    externalId: id,
    provider: "XERO",
    source,
    direction: toPaymentDirection(credit.Type ?? ""),
    providerType: credit.Type ?? "",
    status: toStatus(credit.Status ?? ""),
    providerStatus: credit.Status ?? "",
    reference: credit.Reference ?? null,
    isReconciled: false,
    counterpartyName: credit.Contact?.Name ?? null,
    documentNumber: null,
    documentExternalId: null,
    accountExternalId: null,
    accountCode: null,
    paidAt: parseXeroDate(credit.Date, undefined),
    currency,
    amount: toMoney(credit.Total, currency, "Total"),
    // The cash-relevant figure: money in the bank with nothing matched against it yet.
    remainingCredit: toMoney(credit.RemainingCredit, currency, "RemainingCredit"),
    raw: credit,
  };
}

export function normalisePayments(
  payments: readonly XeroPayment[],
  options: NormalisePaymentOptions,
): NormalisationResult<NormalisedProviderPayment> {
  return collect(payments, (p) => normalisePayment(p, options), (p) => p.PaymentID);
}

export function normaliseBatchPayments(
  batches: readonly XeroBatchPayment[],
  options: NormalisePaymentOptions,
): NormalisationResult<NormalisedProviderPayment> {
  return collect(batches, (b) => normaliseBatchPayment(b, options), (b) => b.BatchPaymentID);
}

export function normaliseUnallocatedCredits(
  credits: readonly XeroUnallocatedCredit[],
  source: Extract<PaymentSource, "PREPAYMENT" | "OVERPAYMENT">,
  options: NormalisePaymentOptions,
): NormalisationResult<NormalisedProviderPayment> {
  return collect(
    credits,
    (c) => normaliseUnallocatedCredit(c, source, options),
    (c) => c.PrepaymentID ?? c.OverpaymentID,
  );
}

export function normaliseAccount(account: XeroAccount): NormalisedLedgerAccount {
  return {
    externalId: account.AccountID,
    provider: "XERO",
    code: account.Code ?? null,
    name: account.Name,
    type: account.Type,
    classification: account.Class ?? null,
    status: account.Status ?? null,
    taxType: account.TaxType ?? null,
    // Xero omits CurrencyCode on non-bank accounts; those follow the org base currency.
    currency: account.CurrencyCode ? parseCurrency(account.CurrencyCode) : null,
    isBankAccount: account.Type === "BANK",
    // BankAccountNumber is deliberately NOT lifted into the normalised model — it is account
    // PII with no forecasting use. It stays in `raw` for audit only.
    raw: account,
  };
}

/**
 * Normalise a batch, collecting failures instead of throwing.
 *
 * One malformed invoice must not blank the whole position screen, and it must not vanish
 * either — the caller receives both halves and is expected to show the failures.
 */
export function normaliseInvoices(
  invoices: readonly XeroInvoice[],
  options: NormaliseInvoiceOptions,
): NormalisationResult<NormalisedCommitment> {
  return collect(invoices, (invoice) => normaliseInvoice(invoice, options), (invoice) => invoice.InvoiceID);
}

export function normaliseAccounts(
  accounts: readonly XeroAccount[],
): NormalisationResult<NormalisedLedgerAccount> {
  return collect(accounts, normaliseAccount, (account) => account.AccountID);
}

function collect<TRaw, TOut>(
  source: readonly TRaw[],
  map: (item: TRaw) => TOut,
  identify: (item: TRaw) => string | undefined,
): NormalisationResult<TOut> {
  const result: NormalisationResult<TOut> = { items: [], failures: [] };
  for (const item of source) {
    try {
      result.items.push(map(item));
    } catch (error) {
      result.failures.push({
        externalId: identify(item) ?? null,
        reason: (error as Error).message,
        raw: item,
      });
    }
  }
  return result;
}

/**
 * ACCRECCREDIT/ACCPAYCREDIT is the whole direction signal, so an unrecognised type is fatal
 * for that record rather than defaulted — the same reasoning as `toDirection` for invoices.
 *
 * Note these are the credit note's OWN types, not an invoice's: Xero appends CREDIT, so a
 * plain "ACCREC" arriving here means the payload is not what we think it is.
 */
function toCreditNoteDirection(type: string): CommitmentDirection {
  switch (type) {
    case "ACCRECCREDIT": // credit to a customer — belongs to receivables
      return "INFLOW";
    case "ACCPAYCREDIT": // a supplier's credit to us — belongs to payables
      return "OUTFLOW";
    default:
      throw new Error(`Unrecognised Xero credit note type "${type}"`);
  }
}

/**
 * Statuses on which `RemainingCredit` is real money rather than a leftover field.
 *
 * VOIDED and DELETED credit notes keep their `RemainingCredit` in Xero's payload. In JENKI's
 * live data every single row with a non-zero remaining credit outside this set was cancelled
 * — 317 of 600 surveyed. Treating the field as cash without checking the status would have
 * invented available credit out of voided paperwork.
 */
const LIVE_CREDIT_STATUSES: ReadonlySet<string> = new Set(["AUTHORISED", "SUBMITTED"]);

function normaliseTracking(entries: XeroTrackingEntry[] | undefined): NormalisedTracking[] {
  const tracking: NormalisedTracking[] = [];
  for (const entry of entries ?? []) {
    // A tracking entry with no category or no option carries no information. Skipped rather
    // than thrown: one unlabelled line should not discard an otherwise valid credit note.
    if (!entry.Name || !entry.Option) continue;
    tracking.push({
      category: entry.Name,
      option: entry.Option,
      categoryId: entry.TrackingCategoryID ?? null,
    });
  }
  return tracking;
}

export interface NormaliseCreditNoteOptions {
  /** Org base currency, used when a credit note omits CurrencyCode. */
  fallbackCurrency: CurrencyCode;
}

export function normaliseCreditNote(
  note: XeroCreditNote,
  options: NormaliseCreditNoteOptions,
): NormalisedCreditNote {
  const currency = note.CurrencyCode ? parseCurrency(note.CurrencyCode) : options.fallbackCurrency;

  const lines: NormalisedCreditNoteLine[] = (note.LineItems ?? []).map((line, index) => ({
    lineId: line.LineItemID ?? null,
    description: line.Description ?? null,
    quantity: line.Quantity ?? null,
    accountCode: line.AccountCode ?? null,
    lineAmount: toMoney(line.LineAmount, currency, `LineItems[${index}].LineAmount`),
    taxAmount: toMoney(line.TaxAmount, currency, `LineItems[${index}].TaxAmount`),
    tracking: normaliseTracking(line.Tracking),
  }));

  const trackingByCategory: Record<string, string[]> = {};
  for (const line of lines) {
    for (const entry of line.tracking) {
      const seen = trackingByCategory[entry.category] ?? [];
      if (!seen.includes(entry.option)) seen.push(entry.option);
      trackingByCategory[entry.category] = seen;
    }
  }

  return {
    externalId: note.CreditNoteID,
    provider: "XERO",
    documentNumber: note.CreditNoteNumber ?? null,
    reference: note.Reference ?? null,
    direction: toCreditNoteDirection(note.Type),
    providerType: note.Type,
    status: toStatus(note.Status),
    providerStatus: note.Status,
    counterpartyName: note.Contact?.Name ?? null,
    counterpartyExternalId: note.Contact?.ContactID ?? null,
    issuedAt: parseXeroDate(note.Date, note.DateString),
    dueAt: parseXeroDate(note.DueDate, note.DueDateString),
    fullyPaidAt: parseXeroDate(note.FullyPaidOnDate, undefined),
    total: toMoney(note.Total, currency, "Total"),
    remainingCredit: toMoney(note.RemainingCredit, currency, "RemainingCredit"),
    creditIsLive: LIVE_CREDIT_STATUSES.has(note.Status),
    currencyRate: note.CurrencyRate ?? null,
    lines,
    trackingByCategory,
    raw: note,
  };
}

export function normaliseCreditNotes(
  notes: readonly XeroCreditNote[],
  options: NormaliseCreditNoteOptions,
): NormalisationResult<NormalisedCreditNote> {
  return collect(
    notes,
    (note) => normaliseCreditNote(note, options),
    (note) => note.CreditNoteID,
  );
}
