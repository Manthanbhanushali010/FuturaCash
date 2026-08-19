-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('STARLING', 'XERO', 'AGGREGATOR', 'MANUAL');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "bookedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderTokenGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "externalTenantId" TEXT,
    "accessTokenCipher" BYTEA NOT NULL,
    "refreshTokenCipher" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "connections" JSONB NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderTokenGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "BankAccount_tenantId_idx" ON "BankAccount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_tenantId_provider_externalId_key" ON "BankAccount"("tenantId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "Transaction_tenantId_accountId_bookedAt_idx" ON "Transaction"("tenantId", "accountId", "bookedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_tenantId_accountId_externalId_key" ON "Transaction"("tenantId", "accountId", "externalId");

-- CreateIndex
CREATE INDEX "ProviderTokenGrant_tenantId_idx" ON "ProviderTokenGrant"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderTokenGrant_tenantId_provider_key" ON "ProviderTokenGrant"("tenantId", "provider");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderTokenGrant" ADD CONSTRAINT "ProviderTokenGrant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- ROW-LEVEL SECURITY
--
-- architecture.md invariant #3 (tenant isolation is absolute) and invariant #1
-- (source transactions are append-only), enforced by Postgres rather than by
-- discipline in application code. Every table above is covered; none is left bare
-- to be retrofitted later.
--
-- FORCE is not optional. A table's owner bypasses RLS by default, so ENABLE alone
-- would leave these policies decorative for the role that owns the tables.
--
-- WARNING — this is necessary but NOT sufficient. A role holding the BYPASSRLS
-- attribute ignores policies entirely, FORCE included. Neon's `neondb_owner` has
-- BYPASSRLS, so the application must connect as a separate role that does not.
-- Verified empirically: with neondb_owner, a no-context query returned every
-- tenant's rows. See progress-tracker.md.
--
-- Tenant context is TRANSACTION-scoped, not session-scoped. The app reaches Postgres
-- through Neon's PgBouncer pooler in transaction mode, where a connection is handed to
-- a different client between statements — a session-level SET would leak one tenant's
-- context into another tenant's query, or vanish before use. Callers must run:
--
--     BEGIN;
--     SELECT set_config('app.tenant_id', $1, true);  -- true = local to this transaction
--     ... queries ...
--     COMMIT;
--
-- With no context set, current_setting(..., true) is NULL, every predicate is NULL, and
-- the query returns nothing. It fails closed, which is the only safe direction.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS text
  LANGUAGE sql STABLE
  AS $fn$ SELECT NULLIF(current_setting('app.tenant_id', true), '') $fn$;

-- --- Tenant ---------------------------------------------------------------
-- The row's own id IS the tenant id. Provisioning a new tenant therefore means
-- setting app.tenant_id to the new id in the same transaction as the INSERT;
-- that is deliberate, there is no unscoped write path.
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Tenant"
  USING ("id" = app_current_tenant_id())
  WITH CHECK ("id" = app_current_tenant_id());

-- --- User -----------------------------------------------------------------
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "User"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- --- BankAccount ----------------------------------------------------------
ALTER TABLE "BankAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankAccount" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BankAccount"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- --- Transaction ----------------------------------------------------------
-- APPEND-ONLY (invariant #1). SELECT and INSERT policies are defined; UPDATE and
-- DELETE deliberately have none. Under RLS a command with no permissive policy
-- matches no rows, so the ledger cannot be rewritten — not even by the table owner
-- once FORCE is on. The invariant becomes a database guarantee, not a convention.
ALTER TABLE "Transaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Transaction" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "Transaction" FOR SELECT
  USING ("tenantId" = app_current_tenant_id());
CREATE POLICY tenant_append ON "Transaction" FOR INSERT
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- --- ProviderTokenGrant ---------------------------------------------------
-- Highest-value rows in the database: a cross-tenant read here hands over access to
-- another company's accounting system. FOR ALL rather than append-only, because Xero
-- rotates the refresh token on every refresh and the row must be updated in place.
ALTER TABLE "ProviderTokenGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderTokenGrant" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProviderTokenGrant"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());
