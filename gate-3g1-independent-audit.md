# Gate 3G.1 — Independent READ-ONLY Security & Migration Audit
**Audit Scope:** Stage 2 Offer Backfill & Database Migration Readiness (`@muni/product-service`)  
**Auditor:** Independent DeepMind Security & Systems Auditor  
**Date:** 2026-11-26  
**Mode:** STRICTLY READ-ONLY (No migrations, backfills, rollbacks, or database writes executed)  
**Artifacts Evaluated:**
- `gate-3g1-migration-readiness-report.md`
- `backend/services/product-service/src/scripts/backfill.cli.ts`
- `backend/services/product-service/src/services/backfill.service.ts`
- `backend/services/product-service/prisma/schema.prisma`
- `backend/services/product-service/prisma/migrations/20261115010000_product_offer_foundation/migration.sql`
- `backend/services/product-service/src/__tests__/backfill.cli.test.ts`
- `backend/services/product-service/src/__tests__/product.offer.schema.test.ts`

---

## 1. Executive Summary

An independent, read-only architectural and safety audit was conducted on **Gate 3G.1 — MUNZI Stage 2 Offer Backfill & Database Migration Readiness**.

The inspection confirmed that:
- The implementation strictly adheres to the read-only mandate: **no production databases were touched, no migrations were executed, no backfills were run, and no records were written or altered**.
- The standalone CLI runner (`backfill.cli.ts`) enforces **mandatory dry-run by default**, dual confirmation for execution (`--execute --confirm`), and production environment guards (`MUNZI_ALLOW_PRODUCTION_BACKFILL=true`).
- The rollback implementation (`rollbackCatalogueBackfill`) includes safeguards protecting active reservations, subsequently modified offers, and Buy Box winners.
- The migration SQL is additive, non-destructive, and structurally matches the Prisma schema.
- **Critical Finding / Missing Verification**: The backup and restore procedure documented in the runbook **has NOT been tested against a live disposable PostgreSQL database**. Furthermore, all automated tests use **mocked Prisma clients** rather than a real PostgreSQL instance.

Accordingly, the Gate 3G.1 audit verdict is **ACCEPT WITH CONDITIONS**, and Gate 3G.2 execution readiness is evaluated as **NOT READY** until disposable database testing is validated.

---

## 2. Detailed Findings and Verification

### 2.1 CLI Implementation & Safety Guards (`src/scripts/backfill.cli.ts`)
| Safety Check | Verified Implementation | Status |
|---|---|---|
| **Mandatory Dry-Run Default** | `parseArgs` initializes `mode: 'dry-run'`. Invoking the CLI without flags executes in dry-run mode with zero writes. | **VERIFIED** (lines 39–45, 203–208) |
| **Execution Confirmation Guard** | If `--execute` is supplied without `--confirm`, the CLI halts immediately, prints an error, and exits with code 1. | **VERIFIED** (lines 145–149) |
| **Production Environment Guard** | In `NODE_ENV === 'production'`, `--execute` is blocked unless `process.env.MUNZI_ALLOW_PRODUCTION_BACKFILL === 'true'`. | **VERIFIED** (lines 151–157) |
| **Credential Masking** | Database URLs have passwords replaced with `******` via `maskDatabaseUrl(url)`. | **VERIFIED** (lines 71–82) |
| **Modes Supported** | Supports `--dry-run`, `--execute`, `--rollback`, `--reconcile`, and `--trusted-sellers=...`. | **VERIFIED** (lines 47–66) |

### 2.2 Backup & Restore Runbook Verification
- **Runbook Review**: The runbook documents custom-format `pg_dump -Fc`, SHA-256 integrity hashing, catalog inspection (`pg_restore --list`), connection termination, and `pg_restore --clean --if-exists`.
- **Live Database Test Status**: **NOT VERIFIED**.
  - In accordance with strict instructions prohibiting database connections or writes during Gate 3G.1, the backup and restore procedure was **not executed against a live disposable database**.
  - Script syntax and argument correctness are verified, but restore verification under real PostgreSQL constraints remains unverified.

### 2.3 Rollback Safeguards (`src/services/backfill.service.ts`)
The `rollbackCatalogueBackfill` function was audited for data loss protection:
1. **Target Scoping**: Restricts candidate deletions strictly to offers where `id.startsWith('off_')`. Manually created offers with CUID IDs are completely untouched (lines 337–342).
2. **Active Reservation Protection**: Inspects `offer.reservations`. If any reservation has `status === 'ACTIVE'`, the offer is flagged as `PROTECTED_HAS_ACTIVE_RESERVATIONS` and deletion is skipped (lines 347–356).
3. **Subsequent Modification Protection**: Calculates `(updatedAt - createdAt) > 10_000` or `isBuyBoxWinner === true`. Any offer modified after initial creation is flagged as `PROTECTED_SUBSEQUENTLY_MODIFIED` and deletion is skipped (lines 359–368).
4. **Dry-Run Rollback Default**: Defaults to `dryRun = true`. Zero deletions occur unless `dryRun: false` (via CLI `--confirm`) is explicitly passed.

### 2.4 Inventory and Reservation Parity
- **1:1 Parity Logic (`reconcileLegacyToOffers`)**: Compares every `ProductVariant` against `off_${variant.id}`:
  - Validates `offer.price === variant.price`.
  - Validates `offer.stock === variant.stock`.
  - Validates `offer.reserved === variant.reserved`.
  - Checks for unmapped reservations (`offerId === null`).
  - Quarantined products (`REJECTED` or missing seller) are safely excluded from active parity calculations.

### 2.5 Duplicate Handling, Deterministic IDs & Quarantine Protocol
- **Deterministic Keying**: Uses `off_${variant.id}` as primary key, preventing duplicate creation across multiple runs.
- **WHERE NOT EXISTS Semantics**: The service checks `product.offers?.find((o) => o.id === deterministicOfferId)` and skips existing offers with `summary.skippedExistingOffers++` (lines 147–151). Existing offers are never overwritten.
- **Seller SKU Collision Disambiguation**: Tracks seen SKUs per seller. Collisions within the same seller namespace are suffixed with `-${variant.id.slice(-6)}` (lines 153–160).
- **Quarantine Gating**:
  - Unverified/missing seller: Logged with `QUARANTINE_UNVERIFIED_SELLER` to `ProductQuarantineLog` and product marked `REJECTED` (lines 75–109).
  - Zero-variant products: Logged with `ZERO_VARIANTS` to `ProductQuarantineLog` and product marked `DRAFT` (lines 112–137).

### 2.6 Migration SQL vs Prisma Schema
- Migration file `backend/services/product-service/prisma/migrations/20261115010000_product_offer_foundation/migration.sql` was compared against `prisma/schema.prisma`.
- **Field Alignment**: All columns (`id`, `productId`, `variantId`, `sellerId`, `sellerSku`, `price`, `compareAtPrice`, `currency`, `condition`, `conditionNote`, `moq`, `wholesaleTiers`, `stock`, `reserved`, `lowStockThreshold`, `status`, `isBuyBoxWinner`, `createdAt`, `updatedAt`) strictly match.
- **Foreign Key Constraints**:
  - `ProductOffer.productId -> Product.id` (`ON DELETE CASCADE`).
  - `ProductOffer(variantId, productId) -> ProductVariant(id, productId)` (`ON DELETE CASCADE`).
  - `InventoryReservation.offerId -> ProductOffer.id` (`ON DELETE RESTRICT`).
- **Non-Destructive Guarantee**: Zero `DROP TABLE` or `DROP COLUMN` statements exist. All additions use `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, and exception handlers around enums and constraints.

---

## 3. Test Coverage & Verification Integrity

### 3.1 Executed Automated Test Suites

| Test Suite | Command | Exit Code | Results |
|---|---|---|---|
| **Backfill CLI Safety Suite** | `npm.cmd --prefix backend/services/product-service test -- src/__tests__/backfill.cli.test.ts` | **0** | **10 / 10 passed** |
| **Product Offer Schema Suite** | `npm.cmd --prefix backend/services/product-service test -- src/__tests__/product.offer.schema.test.ts` | **0** | **30 / 30 passed** |
| **Combined Backfill Suites** | `npm.cmd --prefix backend/services/product-service test -- src/__tests__/product.offer.schema.test.ts src/__tests__/backfill.cli.test.ts` | **0** | **40 / 40 passed** |
| **Full Product Service Suite** | `npm.cmd --prefix backend/services/product-service test` | **0** | **329 / 329 passed** (18 suites) |
| **TypeScript Typecheck** | `npm.cmd --prefix backend/services/product-service run typecheck` (`tsc --noEmit`) | **0** | Clean (0 errors) |
| **TypeScript Build** | `npm.cmd --prefix backend/services/product-service run build` (`tsc -p tsconfig.build.json`) | **0** | Clean (0 errors) |

### 3.2 Mock vs. Live Database Limitation
- **Observation**: All 40 unit tests in `product.offer.schema.test.ts` and `backfill.cli.test.ts` use `mockPrisma` (`jest.unstable_mockModule('../db/prisma.js', ...)`).
- **Significance**: While unit logic, branches, and guards are thoroughly exercised, database-level triggers, actual PostgreSQL constraint enforcement (`@@unique([sellerId, sellerSku])`), and live network connection timeouts are not exercised by these tests.

---

## 4. Data-Loss, Concurrency, and Recovery Risks

1. **Cross-Service Orphaned Offers upon Rollback (Medium Risk)**:
   - `order-service` stores wholesale orders and retail order line items in MongoDB/PostgreSQL referencing `offerId`.
   - If an offer is created by the backfill, ordered via `order-service`, and subsequently rolled back in `product-service`, the order in `order-service` will hold an orphaned `offerId`.
   - *Mitigation*: The rollback safeguard checks whether an offer has been modified or has active cart reservations, but cannot directly query `order-service`'s database. Rollback must not be executed once orders referencing backfilled offers have been committed.

2. **In-Memory Loading on Large Catalogues (Medium Risk)**:
   - `backfill.service.ts` currently executes:
     ```typescript
     const products = await db.product.findMany({
       include: { variants: true, offers: true },
     });
     ```
   - In production databases with 100,000+ products and variants, loading the entire table into memory in a single query can cause Node.js heap exhaustion (`JavaScript heap out of memory`) or database query timeouts.
   - *Mitigation*: Before live execution on large datasets, introduce cursor-based pagination (e.g., batches of 500 products).

3. **Concurrency Drift during Execution (Low/Medium Risk)**:
   - If stock reservations or inventory adjustments occur while `runCatalogueBackfill` is iterating through products, the initial `stock` and `reserved` copied to `ProductOffer` could drift from `ProductVariant`.
   - *Mitigation*: Run backfill during a low-traffic maintenance window or execute `reconcileLegacyToOffers` immediately following execution to identify and reconcile any drift.

---

## 5. Audit Checklists & Summary

| Verification Item | Audit Result | File Reference |
|---|---|---|
| CLI Dry-Run Default | **VERIFIED** | `src/scripts/backfill.cli.ts:39-45` |
| CLI `--execute` + `--confirm` Guard | **VERIFIED** | `src/scripts/backfill.cli.ts:145-149` |
| CLI Production Override Guard | **VERIFIED** | `src/scripts/backfill.cli.ts:151-157` |
| Credential Masking in Logs | **VERIFIED** | `src/scripts/backfill.cli.ts:71-82` |
| Deterministic ID Generation | **VERIFIED** | `src/services/backfill.service.ts:144` |
| Non-Overwriting Existing Offers | **VERIFIED** | `src/services/backfill.service.ts:147-151` |
| Seller SKU Disambiguation | **VERIFIED** | `src/services/backfill.service.ts:153-160` |
| Quarantine for Unverified Sellers | **VERIFIED** | `src/services/backfill.service.ts:75-109` |
| Quarantine for Zero-Variant Products | **VERIFIED** | `src/services/backfill.service.ts:112-137` |
| Rollback Active Reservation Protection | **VERIFIED** | `src/services/backfill.service.ts:347-356` |
| Rollback Modified Offer Protection | **VERIFIED** | `src/services/backfill.service.ts:359-368` |
| Migration SQL Matches Schema | **VERIFIED** | `prisma/migrations/20261115010000.../migration.sql` |
| Migration SQL Non-Destructive | **VERIFIED** | `prisma/migrations/20261115010000.../migration.sql` |
| Backup/Restore Tested on Live DB | **NOT VERIFIED** | Marked NOT VERIFIED per audit guidelines |
| Live DB Testing (Non-Mock) | **NOT VERIFIED** | Unit tests strictly use Jest mocked Prisma |

---

## 6. Audit Verdict and Gate 3G.2 Readiness

### Final Audit Verdict: **ACCEPT WITH CONDITIONS**

**Conditions for Full Acceptance:**
1. **Restore Verification**: The backup and restore procedure must be validated against a disposable PostgreSQL test container or staging instance prior to production deployment.
2. **Batch Paging**: Cursor/batch pagination should be added to `backfill.service.ts` if the production catalogue exceeds 10,000 products to prevent Node.js heap exhaustion.
3. **Pre-Execution Staging Dry-Run**: A dry-run must be executed against a staging database replica, verifying 0 quarantine surprises before running live.

### Gate 3G.2 Execution Readiness: **NOT READY**

- **Justification**: While all code, schema definitions, CLI safety guards, and rollback logic are implemented cleanly and pass 100% of automated tests, live migration execution (Gate 3G.2) must not commence until:
  1. The operator explicitly reviews and approves this audit.
  2. Backup restoration is verified on a disposable test database.
  3. Staging dry-run parity is confirmed.

**Auditor Sign-off:** DeepMind Systems & Security Auditor  
**Status:** Audit complete. All database operations remained strictly read-only.
