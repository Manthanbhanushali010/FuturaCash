import { z } from "zod";

/**
 * Zod schemas for the Xero payloads we read. Nothing from Xero is trusted until it has
 * been through one of these (code-standards.md: validate unknown external input at the
 * boundary). `.passthrough()` keeps unmodelled fields so `raw` stays a faithful record
 * for audit — we validate what we use without discarding what we were sent.
 *
 * Money fields stay `number` here on purpose: they are what JSON.parse gave us, and they
 * are converted to integer minor units in normalise.ts, never used as floats.
 */

export const TokenResponse = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    token_type: z.string(),
    scope: z.string().optional().default(""),
    id_token: z.string().optional(),
  })
  .passthrough();
export type TokenResponse = z.infer<typeof TokenResponse>;

export const TokenErrorResponse = z
  .object({
    error: z.string(),
    error_description: z.string().optional(),
  })
  .passthrough();

export const Connection = z
  .object({
    id: z.string(),
    tenantId: z.string(),
    tenantType: z.string(),
    tenantName: z.string().nullable().optional(),
  })
  .passthrough();
export type Connection = z.infer<typeof Connection>;

export const ConnectionsResponse = z.array(Connection);

/** Xero dates arrive as "/Date(1552262400000+0000)/", with an ISO-ish twin in *String. */
const XeroDate = z.string();

export const XeroAccount = z
  .object({
    AccountID: z.string(),
    Code: z.string().optional(),
    Name: z.string(),
    Type: z.string(),
    Class: z.string().optional(),
    Status: z.string().optional(),
    TaxType: z.string().optional(),
    Description: z.string().optional(),
    CurrencyCode: z.string().optional(),
    SystemAccount: z.string().optional(),
    BankAccountNumber: z.string().optional(),
    ReportingCode: z.string().optional(),
    ReportingCodeName: z.string().optional(),
  })
  .passthrough();
export type XeroAccount = z.infer<typeof XeroAccount>;

export const AccountsResponse = z
  .object({ Accounts: z.array(XeroAccount).default([]) })
  .passthrough();

export const XeroContact = z
  .object({
    ContactID: z.string(),
    Name: z.string().optional(),
  })
  .passthrough();

export const XeroInvoice = z
  .object({
    InvoiceID: z.string(),
    InvoiceNumber: z.string().optional(),
    Reference: z.string().optional(),
    /** ACCREC = sales invoice (money in). ACCPAY = bill (money out). */
    Type: z.string(),
    Status: z.string(),
    LineAmountTypes: z.string().optional(),
    Contact: XeroContact.optional(),
    Date: XeroDate.optional(),
    DateString: z.string().optional(),
    DueDate: XeroDate.optional(),
    DueDateString: z.string().optional(),
    FullyPaidOnDate: XeroDate.optional(),
    CurrencyCode: z.string().optional(),
    CurrencyRate: z.number().optional(),
    SubTotal: z.number().optional(),
    TotalTax: z.number().optional(),
    Total: z.number().optional(),
    AmountDue: z.number().optional(),
    AmountPaid: z.number().optional(),
    AmountCredited: z.number().optional(),
    UpdatedDateUTC: XeroDate.optional(),
  })
  .passthrough();
export type XeroInvoice = z.infer<typeof XeroInvoice>;

export const InvoicesResponse = z
  .object({ Invoices: z.array(XeroInvoice).default([]) })
  .passthrough();

export const XeroOrganisation = z
  .object({
    OrganisationID: z.string().optional(),
    Name: z.string().optional(),
    LegalName: z.string().optional(),
    BaseCurrency: z.string().optional(),
    CountryCode: z.string().optional(),
    OrganisationStatus: z.string().optional(),
    FinancialYearEndDay: z.number().optional(),
    FinancialYearEndMonth: z.number().optional(),
    ShortCode: z.string().optional(),
  })
  .passthrough();
export type XeroOrganisation = z.infer<typeof XeroOrganisation>;

export const OrganisationsResponse = z
  .object({ Organisations: z.array(XeroOrganisation).default([]) })
  .passthrough();

/**
 * A bank transaction as Xero records it in the LEDGER — money in or out of a bank account,
 * entered or reconciled by the bookkeeper. This is NOT a bank feed: the live feed comes from
 * the Open Banking aggregator, and reconciliation compares the two. See integrations/types.ts.
 */
export const XeroBankAccountRef = z
  .object({
    AccountID: z.string().optional(),
    Code: z.string().optional(),
    Name: z.string().optional(),
  })
  .passthrough();

/**
 * A line on a bank transaction. Xero's own Bank Accounts view shows `Description` as the
 * transaction narrative, and for JENKI it is populated on every row while `Reference` is
 * present on fewer than half — so a screen that reads only `Reference` shows blanks for
 * transactions Xero describes perfectly well.
 */
export const XeroBankTransactionLineItem = z
  .object({
    Description: z.string().optional(),
    AccountCode: z.string().optional(),
    LineAmount: z.number().optional(),
  })
  .passthrough();

export const XeroBankTransaction = z
  .object({
    BankTransactionID: z.string(),
    /**
     * RECEIVE* = money in, SPEND* = money out, each with -OVERPAYMENT, -PREPAYMENT and
     * -TRANSFER variants. This field is the entire direction signal.
     */
    Type: z.string(),
    Status: z.string().optional(),
    Reference: z.string().optional(),
    IsReconciled: z.boolean().optional(),
    Contact: XeroContact.optional(),
    BankAccount: XeroBankAccountRef.optional(),
    Date: XeroDate.optional(),
    DateString: z.string().optional(),
    CurrencyCode: z.string().optional(),
    CurrencyRate: z.number().optional(),
    SubTotal: z.number().optional(),
    TotalTax: z.number().optional(),
    Total: z.number().optional(),
    LineItems: z.array(XeroBankTransactionLineItem).optional(),
    UpdatedDateUTC: XeroDate.optional(),
  })
  .passthrough();
export type XeroBankTransaction = z.infer<typeof XeroBankTransaction>;

export const BankTransactionsResponse = z
  .object({ BankTransactions: z.array(XeroBankTransaction).default([]) })
  .passthrough();

/**
 * The payment family: four endpoints behind one scope (`accounting.payments.read`).
 *
 * Modelled from Xero's documented field lists, NOT from a survey of JENKI's data — the grant
 * did not hold the scope when these were written, so all four returned 401. `.passthrough()`
 * keeps anything unmodelled, so the survey can still reveal fields worth lifting (exactly how
 * `LineItems.Description` was found on bank transactions, after months of reading `Reference`).
 *
 * Treat the DISPLAY choices built on these as provisional until that survey runs.
 */

/** Which endpoint a record came from. Kept on the record: completeness is per-source. */
export const PAYMENT_SOURCES = ["PAYMENT", "BATCH_PAYMENT", "PREPAYMENT", "OVERPAYMENT"] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

const XeroInvoiceRef = z
  .object({
    InvoiceID: z.string().optional(),
    InvoiceNumber: z.string().optional(),
    Contact: XeroContact.optional(),
  })
  .passthrough();

const XeroAccountRef = z
  .object({
    AccountID: z.string().optional(),
    Code: z.string().optional(),
    Name: z.string().optional(),
  })
  .passthrough();

/** GET /Payments — a payment matched against an invoice or bill. */
export const XeroPayment = z
  .object({
    PaymentID: z.string(),
    /** ACCRECPAYMENT = money in, ACCPAYPAYMENT = money out, plus prepayment/overpayment kinds. */
    PaymentType: z.string().optional(),
    Status: z.string().optional(),
    Date: XeroDate.optional(),
    Reference: z.string().optional(),
    Amount: z.number().optional(),
    CurrencyRate: z.number().optional(),
    IsReconciled: z.boolean().optional(),
    Invoice: XeroInvoiceRef.optional(),
    Account: XeroAccountRef.optional(),
    BatchPaymentID: z.string().optional(),
    UpdatedDateUTC: XeroDate.optional(),
  })
  .passthrough();
export type XeroPayment = z.infer<typeof XeroPayment>;

export const PaymentsResponse = z
  .object({ Payments: z.array(XeroPayment).default([]) })
  .passthrough();

/** GET /BatchPayments — a batch (e.g. a supplier run) wrapping many payments. */
export const XeroBatchPayment = z
  .object({
    BatchPaymentID: z.string(),
    /** PAYBATCH = money out, RECBATCH = money in. */
    Type: z.string().optional(),
    Status: z.string().optional(),
    Date: XeroDate.optional(),
    Reference: z.string().optional(),
    Particulars: z.string().optional(),
    Narrative: z.string().optional(),
    Details: z.string().optional(),
    Amount: z.number().optional(),
    IsReconciled: z.boolean().optional(),
    Account: XeroAccountRef.optional(),
    Payments: z.array(XeroPayment).optional(),
    UpdatedDateUTC: XeroDate.optional(),
  })
  .passthrough();
export type XeroBatchPayment = z.infer<typeof XeroBatchPayment>;

export const BatchPaymentsResponse = z
  .object({ BatchPayments: z.array(XeroBatchPayment).default([]) })
  .passthrough();

/**
 * GET /Prepayments and GET /Overpayments — real cash in the bank not yet matched to an invoice.
 *
 * `RemainingCredit` is the field that matters for a cash position: the unallocated portion.
 * Same shape for both endpoints, so one schema serves each.
 */
export const XeroUnallocatedCredit = z
  .object({
    PrepaymentID: z.string().optional(),
    OverpaymentID: z.string().optional(),
    Type: z.string().optional(),
    Status: z.string().optional(),
    Date: XeroDate.optional(),
    Reference: z.string().optional(),
    Contact: XeroContact.optional(),
    CurrencyCode: z.string().optional(),
    SubTotal: z.number().optional(),
    TotalTax: z.number().optional(),
    Total: z.number().optional(),
    /** The portion not yet applied to an invoice — the cash-relevant number. */
    RemainingCredit: z.number().optional(),
    UpdatedDateUTC: XeroDate.optional(),
  })
  .passthrough();
export type XeroUnallocatedCredit = z.infer<typeof XeroUnallocatedCredit>;

export const PrepaymentsResponse = z
  .object({ Prepayments: z.array(XeroUnallocatedCredit).default([]) })
  .passthrough();

export const OverpaymentsResponse = z
  .object({ Overpayments: z.array(XeroUnallocatedCredit).default([]) })
  .passthrough();

/**
 * A tracking entry on a credit note line item.
 *
 * Shape taken from JENKI's live data (surveyed 2026-10-22), not from documentation:
 *
 *   { "Name": "Site", "Option": "Selfridges",
 *     "TrackingCategoryID": "762a4fd1-…", "Options": [] }
 *
 * Two things the real payload settles. There is NO `TrackingOptionID` — the option arrives
 * only as its display string, so joining back to `/TrackingCategories` has to go through
 * `Name`/`Option` text, and a renamed option breaks that join silently. And `Options` is
 * always an empty array here: it belongs to the category resource, not to a line's tracking
 * entry, so it must not be mistaken for the option that was actually applied.
 */
export const XeroTrackingEntry = z
  .object({
    Name: z.string().optional(),
    Option: z.string().optional(),
    TrackingCategoryID: z.string().optional(),
  })
  .passthrough();

export type XeroTrackingEntry = z.infer<typeof XeroTrackingEntry>;

/**
 * A credit note line item.
 *
 * `Tracking` is the reason this endpoint is worth reading at all: 2,738 of JENKI's 3,017
 * surveyed line items carry it (91%), across both "Site" and "Revenue Centre". It is also
 * the field that vanishes if the request omits `page` — see `fetchCreditNotes`.
 */
export const XeroCreditNoteLineItem = z
  .object({
    Description: z.string().optional(),
    Quantity: z.number().optional(),
    UnitAmount: z.number().optional(),
    LineAmount: z.number().optional(),
    TaxAmount: z.number().optional(),
    TaxType: z.string().optional(),
    AccountCode: z.string().optional(),
    AccountID: z.string().optional(),
    LineItemID: z.string().optional(),
    ItemCode: z.string().optional(),
    Tracking: z.array(XeroTrackingEntry).optional(),
  })
  .passthrough();

export type XeroCreditNoteLineItem = z.infer<typeof XeroCreditNoteLineItem>;

/**
 * A credit note.
 *
 * ACCRECCREDIT credits a customer, ACCPAYCREDIT is a supplier crediting us. `RemainingCredit`
 * is the cash-relevant figure — but only on some statuses, which `normaliseCreditNote`
 * records rather than assumes.
 */
export const XeroCreditNote = z
  .object({
    CreditNoteID: z.string(),
    CreditNoteNumber: z.string().optional(),
    Reference: z.string().optional(),
    /** ACCRECCREDIT = credit to a customer. ACCPAYCREDIT = a supplier's credit to us. */
    Type: z.string(),
    Status: z.string(),
    LineAmountTypes: z.string().optional(),
    Contact: XeroContact.optional(),
    Date: XeroDate.optional(),
    DateString: z.string().optional(),
    DueDate: XeroDate.optional(),
    DueDateString: z.string().optional(),
    FullyPaidOnDate: XeroDate.optional(),
    CurrencyCode: z.string().optional(),
    CurrencyRate: z.number().optional(),
    SubTotal: z.number().optional(),
    TotalTax: z.number().optional(),
    Total: z.number().optional(),
    RemainingCredit: z.number().optional(),
    LineItems: z.array(XeroCreditNoteLineItem).optional(),
    UpdatedDateUTC: XeroDate.optional(),
  })
  .passthrough();

export type XeroCreditNote = z.infer<typeof XeroCreditNote>;

export const CreditNotesResponse = z
  .object({ CreditNotes: z.array(XeroCreditNote).default([]) })
  .passthrough();
