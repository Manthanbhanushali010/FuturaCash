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
