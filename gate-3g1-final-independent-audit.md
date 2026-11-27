# MUNZI — Gate 3G.1 Final Independent Remediation Audit
**Audit Scope:** Verification of Gate 3G.1 Code Remediation (`@muni/product-service`)  
**Auditor:** Independent Systems & Security Auditor  
**Date:** 2026-11-26  
**Mode:** STRICTLY READ-ONLY (No migrations, backfills, rollbacks, or database writes)  
**Evaluated Documents & Source:**
- `gate-3g1-remediation-report.md`
- `backend/services/product-service/src/services/backfill.service.ts`
- `backend/services/product-service/src/scripts/backfill.cli.ts`
- `backend/services/product-service/prisma/schema.prisma`
- `backend/services/product-service/prisma/migrations/20261115010000_product_offer_foundation/migration.sql`
- `backend/services/product-service/src/__tests__/backfill.cli.test.ts`
- `backend/services/product-service/src/__tests__/product.offer.schema.test.ts`

---

## 1. Executive Summary

An independent, read-only audit was conducted on the remediations implemented in **Gate 3G.1**.

### Audit Summary:
1. **Backfill Pagination**: **VERIFIED & ACCEPTED**. Keyset / cursor-based pagination is deterministically ordered by `id: 'asc'`, correctly handles cursors across batch boundaries, bounds memory usage to $O(\text{batchSize})$, preserves idempotency on reruns, and does not overwrite existing offers.
2. **Rollback Protection**: **VERIFIED & ACCEPTED**. Rollback logic explicitly checks and protects offers with active reservations, offers promoted to Buy Box winner, offers modified post-creation, and offers referenced by existing orders (`orderChecker` callback and `orderItem` count).
3. **Backup & Restore Validation**: **NOT VERIFIED / NOT READY**. In accordance with strict safety invariants, no live PostgreSQL instance was started, no live dump was generated, and no restore was executed on this host (Docker daemon inactive, ports 5432 and 5173 closed). This requirement is documented as a procedure but has **not** been tested live.
4. **Test Quality**: **ACCEPT WITH CONDITIONS**. 42 backfill-specific unit tests and 331 full-suite tests pass with exit code 0. However, all tests use **mocked Prisma clients**; testing against a live PostgreSQL instance remains an outstanding pre-requisite for production migration.

---

## 2. In-Depth Technical Verification

### 2.1 Backfill Pagination & Keyset Scalability (`src/services/backfill.service.ts`)
| Requirement | Verification Detail | Verdict |
|---|---|---|
| **Deterministic Ordering** | `orderBy: { id: 'asc' }` is strictly applied on `Product.id` (primary key). Order is stable and invariant. | **PASSED** (line 92) |
| **Cursor Handling Across Batches** | First query has `cursor: undefined`. Subsequent queries set `cursor: { id: cursor }` and `skip: 1`, correctly advancing past the last seen record without skipping or duplicating items. | **PASSED** (lines 98–101, 239) |
| **Batch Boundary Termination** | Loop terminates when `products.length < batchSize` (`hasMore = false`) or `products.length === 0`. | **PASSED** (lines 104, 245–247) |
| **Constant Memory Usage** | Only `batchSize` products with their variants/offers are loaded in any given iteration. Unbounded $O(N)$ full-table memory loading has been completely eliminated. | **PASSED** |
| **Idempotency & Non-Overwriting** | Before creating an offer, `product.offers?.find(o => o.id === deterministicOfferId)` checks existence. Existing offers increment `skippedExistingOffers` and are never overwritten. | **PASSED** (lines 173–177) |
| **Partial Failure Recovery** | If a batch fails, restarting the process scans from the beginning, skips already-created offers via the WHERE NOT EXISTS check, and resumes creation at the point of failure. | **PASSED** |
| **Reconciliation Keyset Pagination** | `reconcileLegacyToOffers` was also refactored to use cursor pagination (`take: batchSize`, `skip: 1`, `cursor: { id }`, `orderBy: { id: 'asc' }`) with options/client polymorphism. | **PASSED** (lines 282–356) |

---

### 2.2 Rollback Protection & Cross-Service Safety
| Protection Class | Implementation Verification | Verdict |
|---|---|---|
| **Target Scoping** | Only offers matching `id: { startsWith: 'off_' }` are fetched. Seller-created offers (CUID format) are strictly excluded from deletion candidates. | **PASSED** (lines 388–393) |
| **Order Reference Protection** | Evaluates `options.orderChecker(offer.id)` or `db.orderItem.count({ where: { offerId } })`. If referenced, deletion is aborted with `PROTECTED_REFERENCED_BY_ORDERS`. | **PASSED** (lines 400–420) |
| **Active Reservation Protection** | Evaluates `offer.reservations.some(r => r.status === 'ACTIVE')`. If active cart holds exist, deletion is aborted with `PROTECTED_HAS_ACTIVE_RESERVATIONS`. | **PASSED** (lines 423–432) |
| **Buy Box Winner Protection** | Evaluates `offer.isBuyBoxWinner`. If true, deletion is aborted with `PROTECTED_BUY_BOX_WINNER`. | **PASSED** (lines 435–442) |
| **Subsequent Modification Protection** | Evaluates `(updatedAt - createdAt) > 10_000` (10 seconds). If seller has edited the offer, deletion is aborted with `PROTECTED_SUBSEQUENTLY_MODIFIED`. | **PASSED** (lines 445–454) |
| **Safe Unlinking of Non-Active Holds** | When an eligible offer is rolled back, non-active reservations (`RELEASED`, `EXPIRED`, `CONSUMED`) are unlinked (`offerId: null`) before deleting the offer, preventing `onDelete: Restrict` foreign key violations. | **PASSED** (lines 459–464) |

> [!WARNING]
> **Operational Note on Standalone CLI Rollback**:
> In `backfill.cli.ts`, `rollbackCatalogueBackfill` is called without an `orderChecker` callback because `order-service` is an independent microservice with its own database. If an operator triggers `--rollback --confirm` via CLI without pre-verifying `order-service`, retail or wholesale orders in `order-service` could be left with orphaned `offerId` references. In production, rollback must either be gated by an HTTP order-checker or verified manually against `order-service`.

---

### 2.3 Backup and Restore Procedure Status
In strict adherence to reporting accuracy, the four distinct aspects are evaluated:
1. **Procedure and scripts inspected**: **VERIFIED**. The commands (`pg_dump -Fc`, `sha256sum`, `pg_restore --list`, `pg_restore --clean --if-exists`) have been inspected and confirmed to be syntactically correct and appropriate for PostgreSQL custom-format dumps.
2. **Backup successfully created**: **NOT EXECUTED**. No dump file was generated because no active PostgreSQL instance was reachable on this host.
3. **Checksum successfully verified**: **NOT EXECUTED**. No SHA-256 hash was generated or verified against an actual dump file.
4. **Restore successfully completed against disposable database**: **NOT EXECUTED**. Docker engine is stopped (`failed to connect to docker API`), and local ports 5432 and 5173 are inactive. No live restore has occurred.

---

### 2.4 Test Quality and Coverage Inspection

#### Executed Test Suites & Results:
- **`npm.cmd --prefix backend/services/product-service test -- src/__tests__/backfill.cli.test.ts`**:
  - Exit code: `0`
  - 12 passed, 0 failed.
  - Tests verify: CLI dry-run default, `--execute` confirmation guard, production override guard, reconcile mode, rollback dry-run, active reservation rollback protection, modified offer rollback protection, order-reference rollback protection, clean rollback deletion, multi-batch keyset pagination with cursor advancement, batch boundary failure recovery.
- **`npm.cmd --prefix backend/services/product-service test -- src/__tests__/product.offer.schema.test.ts`**:
  - Exit code: `0`
  - 30 passed, 0 failed.
  - Tests verify: idempotency, Buy Box zero auto-assignment, status derivation (`ACTIVE`, `OUT_OF_STOCK`, `INACTIVE`), quarantine for missing/empty sellers, quarantine for zero-variant products, SKU collision disambiguation, reservation migration, 1:1 parity reconciliation.
- **Combined Test Run**:
  - Exit code: `0` (42 / 42 passed).
- **Full Product-Service Suite**:
  - Exit code: `0` (18 suites, 331 tests passed).
- **TypeScript Typecheck (`tsc --noEmit`)**:
  - Exit code: `0` (0 errors).
- **TypeScript Build (`tsc -p tsconfig.build.json`)**:
  - Exit code: `0` (0 errors).

#### Mock vs. Real Verification Limitation:
All 42 backfill unit tests use `mockPrisma` (`jest.unstable_mockModule('../db/prisma.js', ...)`). The logic and branches are genuinely exercised, but real PostgreSQL database engine behaviors (actual unique index collisions, foreign key cascading, connection timeouts, and transaction isolation) have not been tested against a live database.

---

## 3. Independent Audit Verdicts

### 1. Gate 3G.1 Code Remediation: **ACCEPT**
- Keyset pagination with cursor handling is robust, memory-bounded, and deterministic.
- Rollback safeguards cover all four protection classes (orders, reservations, Buy Box, and seller edits).
- Non-destructive migration SQL matches Prisma schema.
- All 42 backfill tests pass with zero TypeScript errors.

### 2. Backup / Restore Validation: **NOT READY**
- The backup/restore runbook has **not** been executed against a live disposable PostgreSQL database.
- Live dump creation, checksum generation, and restore verification remain unexecuted.

### 3. Gate 3G.2 Execution Readiness: **NOT READY**
Live Stage 2 migration/backfill execution cannot be authorized until the following outstanding conditions are resolved:
1. **Live Disposable Restore Test**: Spin up a disposable PostgreSQL container/instance and run the documented `pg_dump` -> `sha256sum` -> `pg_restore` verification flow.
2. **Staging Dry-Run Parity**: Execute `npm run backfill -- --dry-run --json` against an approved staging database replica and confirm zero unexpected quarantine records.
3. **Cross-Service Rollback Gating**: Ensure that before any live rollback is attempted, `order-service` is queried to confirm zero order references exist for the candidate offers.

---

**Auditor Sign-off:** Independent Systems & Security Auditor  
**Status:** Audit complete. All operations remained strictly read-only. No live database writes or commits were performed.
