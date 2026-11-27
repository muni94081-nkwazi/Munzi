# Gate 3G.1 — MUNZI Stage 2 Offer Backfill & Database Migration Readiness Report
**Service:** `@muni/product-service` (PostgreSQL / Prisma)  
**Date:** 2026-11-26  
**Auditor / Readiness Engineer:** DeepMind Agent  
**Stage:** Stage 2 Multi-Vendor Offer Backfill Preparation & Safety Gating  
**Final Verdict:** **READY FOR REVIEW** (Strictly Unexecuted)

---

## 1. Executive Summary

This report documents the architectural inspection, safety tooling, and operational readiness for **Gate 3G.1: Stage 2 Offer Backfill & Database Migration Readiness**.

All preparations for the Stage 2 data migration have been implemented with comprehensive safeguards:
1. **Safety Gating & Read-Only Invariants**: In accordance with strict instructions, **zero migrations were run, zero backfills were executed, zero database writes occurred, and no production data was modified**.
2. **Standalone Backfill CLI Runner**: Developed `backend/services/product-service/src/scripts/backfill.cli.ts` with mandatory **dry-run by default**. Execution requires dual explicit confirmation (`--execute` and `--confirm`), plus an additional environment override in production (`MUNZI_ALLOW_PRODUCTION_BACKFILL=true`).
3. **Deterministic Idempotency**: Backfilled offer IDs are strictly derived from variant IDs (`off_${variant.id}`), ensuring repeatable runs skip existing offers without duplicate creation or record mutation.
4. **Quarantine & Disambiguation Protocols**: Products with unverified/empty seller IDs or zero variants are safely identified for quarantine. Seller SKU collisions within the same seller namespace are automatically disambiguated with a deterministic suffix (`-${variant.id.slice(-6)}`).
5. **Guarded Rollback Architecture**: Implemented `rollbackCatalogueBackfill` with safety checks protecting offers with active reservations (`PROTECTED_HAS_ACTIVE_RESERVATIONS`) and offers subsequently updated or awarded Buy Box status (`PROTECTED_SUBSEQUENTLY_MODIFIED`).
6. **Automated Test Verification**: Added a dedicated CLI test suite (`backfill.cli.test.ts`) and validated the existing schema test suite (`product.offer.schema.test.ts`), with **40/40 tests passing** (exit code 0), full service suite **329/329 tests passing** (exit code 0), and clean TypeScript typecheck and build (exit code 0).

---

## 2. Review of Migration SQL and Prisma Schema

### 2.1 Prisma Schema Inspection (`prisma/schema.prisma`)
The Stage 2 Multi-Vendor foundation includes the following core models:
- **`ProductOffer`**:
  - `id`: Primary key (`off_${variant.id}` during backfill, CUID for seller-created offers).
  - `productId`, `variantId`, `sellerId`, `sellerSku`.
  - `price` (`Decimal(12, 2)`), `compareAtPrice`, `currency` (defaults to `"UGX"`).
  - `condition` (`ProductCondition` enum: `NEW`, `REFURBISHED`, `USED_LIKE_NEW`, etc.).
  - `conditionNote`, `moq` (`Int`, defaults to `1`), `wholesaleTiers` (`Json?`).
  - `stock`, `reserved`, `lowStockThreshold`, `status` (`OfferStatus`: `ACTIVE`, `INACTIVE`, `OUT_OF_STOCK`, `SUSPENDED`).
  - `isBuyBoxWinner`: Boolean flag (backfill enforces `isBuyBoxWinner = false` to prevent blind Buy Box assignment).
  - Constraints & Indexes:
    - `@@unique([sellerId, sellerSku])`: Enforces uniqueness of SKUs per seller.
    - Foreign keys: Cascade deletion from `Product` and composite `ProductVariant(id, productId)`.
- **`InventoryReservation`**:
  - Adds optional `offerId` foreign key with `onDelete: Restrict` to ensure reservation history is preserved even if an offer is removed.
  - Adds `status` (`ReservationStatus`: `ACTIVE`, `RELEASED`, `CONSUMED`, `EXPIRED`).
- **`ProductQuarantineLog`**:
  - Audit log table tracking quarantined products with `productId`, `sellerId`, `reason` (`QUARANTINE_UNVERIFIED_SELLER`, `ZERO_VARIANTS`), and `metadata`.

### 2.2 Migration SQL Inspection
- **`20261115000000_catalogue_foundation/migration.sql`**:
  - Creates enums `ProductCondition` and `AttributeType`.
  - Alters `Product` to add `condition`, `moq`, `wholesaleTiers`.
  - Alters `ProductVariant` to add `barcode`.
  - Creates tables `CategoryAttribute`, `ProductSpecification`, `VariantAttributeValue`.
- **`20261115010000_product_offer_foundation/migration.sql`**:
  - Creates enums `OfferStatus` and `ReservationStatus` defensively (`DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;`).
  - Adds multi-vendor aggregated price columns to `Product`: `minOfferPrice`, `maxOfferPrice`, `activeOfferCount`.
  - Adds composite unique key on `ProductVariant(id, productId)` for strict relational integrity.
  - Creates `ProductOffer` table and indexes.
  - Alters `InventoryReservation` to add `offerId` and `status`.
  - Creates `ProductQuarantineLog` table and audit indexes.
  - **Status**: The migration SQL is idempotent, cleanly structured with exception handlers, and prepared in `prisma/migrations/`.

---

## 3. Standalone Backfill CLI Runner Architecture

### 3.1 Script Location and Configuration
- **File**: `backend/services/product-service/src/scripts/backfill.cli.ts`
- **NPM Script**: `npm run backfill -- [OPTIONS]` in `product-service`

### 3.2 Safety Features & Flag Specification

| Flag | Purpose | Safety Default |
|---|---|---|
| *(no flags)* | Runs full discovery and reconciliation in dry-run mode. | **DRY-RUN (Zero writes)** |
| `--dry-run` | Explicitly requests read-only preview mode. | **DRY-RUN (Zero writes)** |
| `--execute` | Requests live backfill execution. | **BLOCKED without `--confirm`** |
| `--confirm` | Required confirmation flag for write operations. | Must be provided alongside `--execute` |
| `--rollback` | Initiates rollback mode. | **DRY-RUN unless `--confirm` is provided** |
| `--reconcile` | Runs only 1:1 legacy variant-to-offer parity reconciliation. | Read-Only |
| `--trusted-sellers=...` | Comma-separated allowlist of verified seller IDs. | Unlisted sellers are quarantined |
| `--json` | Emits structured JSON summary for automation/auditing. | Formatted CLI output by default |

### 3.3 Output and Reporting Schema
The CLI generates comprehensive reports covering:
1. **Target Environment & Database**: Sanitized database URL (passwords redacted: `postgresql://muni:******@localhost:5173/muni_products`).
2. **Discovery Metrics**: Total products and variants scanned.
3. **Offer Creation Eligibility**: Number of offers eligible for creation vs. skipped (already existing).
4. **Collision Handling**: Number of seller SKUs disambiguated with deterministic variant suffixes.
5. **Quarantine Audit**: Count and breakdown of products quarantined (missing seller identity, zero variants).
6. **Reservation Migration**: Count of unmapped cart reservations linked to new offer IDs.
7. **Reconciliation Parity**: Parity confirmation (`isParityConfirmed: true/false`), missing offers, price mismatches, stock mismatches, reserved quantity mismatches.

---

## 4. Database Backup, Snapshot & Restore Procedures

### 4.1 Prerequisites
- PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`) matching the server version (v15/v16).
- Valid environment variables: `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`.

### 4.2 Pre-Migration Backup Procedure
Execute the following commands before applying any migration or backfill:

```bash
# 1. Define timestamped snapshot file
SNAPSHOT_NAME="munzi_product_pre_stage2_$(date +%Y%m%d_%H%M%S).dump"

# 2. Perform custom-format compressed backup with bloat exclusion
pg_dump -Fc --no-acl --no-owner \
  -h "${PGHOST:-localhost}" \
  -p "${PGPORT:-5432}" \
  -U "${PGUSER:-muni}" \
  -d "${PGDATABASE:-muni_products}" \
  -f "${SNAPSHOT_NAME}"

# 3. Generate SHA-256 checksum for integrity verification
sha256sum "${SNAPSHOT_NAME}" > "${SNAPSHOT_NAME}.sha256"
```

### 4.3 Backup Integrity Verification
Verify the snapshot before proceeding:

```bash
# Verify checksum
sha256sum -c "${SNAPSHOT_NAME}.sha256"

# Verify dump readability and inspect catalog contents
pg_restore --list "${SNAPSHOT_NAME}" | head -n 30
```

### 4.4 Restore Procedure (Emergency Recovery)
If an unrecoverable failure occurs during migration:

```bash
# 1. Terminate active connections to product database
psql -h "${PGHOST:-localhost}" -U "${PGUSER:-muni}" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'muni_products' AND pid <> pg_backend_pid();"

# 2. Restore cleanly from verified snapshot
pg_restore --clean --if-exists --no-acl --no-owner \
  -h "${PGHOST:-localhost}" \
  -p "${PGPORT:-5432}" \
  -U "${PGUSER:-muni}" \
  -d "${PGDATABASE:-muni_products}" \
  "${SNAPSHOT_NAME}"

# 3. Verify database connectivity and schema consistency
psql -h "${PGHOST:-localhost}" -U "${PGUSER:-muni}" -d "${PGDATABASE:-muni_products}" -c \
  "SELECT count(*) FROM \"Product\"; SELECT count(*) FROM \"ProductVariant\";"
```

---

## 5. Rollback Procedure & Safeguards

### 5.1 Guarded Code Rollback (`rollbackCatalogueBackfill`)
In the event that the backfill completes but must be rolled back at the application layer without a full database restore:

1. **Deterministic Target Identification**: The rollback only evaluates offers with IDs prefixed by `off_` (`id: { startsWith: 'off_' }`). Manually created offers or non-backfilled multi-vendor listings are completely ignored.
2. **Active Reservation Protection**: If an offer has active inventory reservations (`reservations: { some: { status: 'ACTIVE' } }`), it is **strictly protected** from deletion (`PROTECTED_HAS_ACTIVE_RESERVATIONS`).
3. **Subsequent Modification Protection**: If an offer was modified after creation (`updatedAt > createdAt + 10s`) or was awarded Buy Box winner status (`isBuyBoxWinner: true`), it is **strictly protected** (`PROTECTED_SUBSEQUENTLY_MODIFIED`).
4. **Dry-Run Default**: Running `tsx src/scripts/backfill.cli.ts --rollback` runs in dry-run mode and lists eligible vs. protected offers without deleting anything.
5. **Safe Live Rollback Command**:
   ```bash
   npm run backfill -- --rollback --confirm
   ```

---

## 6. Verification and Automated Test Results

### 6.1 Backfill CLI & Safety Test Suite
- **Command**: `npm.cmd --prefix backend/services/product-service test -- src/__tests__/backfill.cli.test.ts`
- **Exit Code**: `0`
- **Tests Passed**: `10 / 10`
  - Dry-run default performs zero writes
  - Rejection of `--execute` without `--confirm` (code 1)
  - Rejection of live execution in production without override
  - Acceptance of live execution with `MUNZI_ALLOW_PRODUCTION_BACKFILL=true`
  - Reconcile mode parity verification
  - Rollback dry-run performs zero deletions
  - Active reservation protection during rollback
  - Modified offer protection during rollback
  - Clean deletion of eligible offers during live rollback
  - Idempotent rerun after partial failure

### 6.2 Product Offer Schema & Backfill Test Suite
- **Command**: `npm.cmd --prefix backend/services/product-service test -- src/__tests__/product.offer.schema.test.ts`
- **Exit Code**: `0`
- **Tests Passed**: `30 / 30`
  - Dry-run mode counts and reporting
  - Backfill repeatability & WHERE NOT EXISTS guard
  - Buy Box safety (`isBuyBoxWinner = false`)
  - Offer status derivation (`ACTIVE`, `OUT_OF_STOCK`, `INACTIVE`)
  - Quarantine logic (`QUARANTINE_UNVERIFIED_SELLER`, `ZERO_VARIANTS`, trusted seller allowlist)
  - SKU collision disambiguation per seller
  - Deterministic offer ID generation
  - Active reservation migration
  - 1:1 legacy variant-to-offer parity reconciliation

### 6.3 Full Product-Service Test Suite
- **Command**: `npm.cmd --prefix backend/services/product-service test`
- **Exit Code**: `0`
- **Suites**: `18 passed, 18 total`
- **Tests**: `329 passed, 329 total`

### 6.4 TypeScript Compilation & Build
- **Typecheck Command**: `npm.cmd --prefix backend/services/product-service run typecheck` (`tsc --noEmit`)
  - **Exit Code**: `0` (Zero type errors)
- **Build Command**: `npm.cmd --prefix backend/services/product-service run build` (`tsc -p tsconfig.build.json`)
  - **Exit Code**: `0` (Clean compilation to `dist/`)

---

## 7. Operational Runbook for Gate 3G Execution (When Authorized)

When explicit operator approval is granted to proceed with live migration:

```bash
# Step 1: Pre-Migration Database Snapshot
export SNAPSHOT="munzi_stage2_backup_$(date +%Y%m%d_%H%M%S).dump"
pg_dump -Fc -h $PGHOST -U $PGUSER -d $PGDATABASE -f $SNAPSHOT
sha256sum $SNAPSHOT > "${SNAPSHOT}.sha256"

# Step 2: Apply Prepared Database Migration
cd backend/services/product-service
npx prisma migrate deploy

# Step 3: Run Backfill in Dry-Run Mode (Mandatory Verification)
npm run backfill -- --dry-run

# Step 4: Verify Dry-Run Output and Parity Reconciliation
# Ensure zero quarantined discrepancies and confirmed parity

# Step 5: Execute Live Backfill
npm run backfill -- --execute --confirm

# Step 6: Post-Backfill Parity Verification
npm run backfill -- --reconcile
```

---

## 8. Remaining Risks and Mitigations

| Risk | Impact | Mitigation In Place |
|---|---|---|
| Active Cart Reservations During Backfill | Medium | Reservations are linked by deterministic variant ID (`off_${variantId}`); active reservations are protected during rollback. |
| Seller SKU Collision Across Variants | Low | Disambiguation logic automatically suffixes duplicate SKUs per seller with `-${variantId.slice(-6)}`. |
| Unverified Seller Listings | Medium | Seller quarantine automatically flags missing/unverified sellers and logs them to `ProductQuarantineLog`. |
| Concurrent Order Checkout During Migration | Medium | Backfill uses `WHERE NOT EXISTS` semantics and does not touch order records. Multi-vendor checkout continues reading legacy prices until buy box assignment. |

---

## 9. Final Gate 3G.1 Verdict

| Criteria | Evaluation |
|---|---|
| Standalone Safely Configurable CLI Runner | **PASSED** (`src/scripts/backfill.cli.ts`) |
| Mandatory Dry-Run Default | **PASSED** (Writes blocked without explicit confirmation) |
| Database Snapshot & Restore Runbook | **PASSED** (Documented with integrity checks) |
| Rollback Procedure with Safeguards | **PASSED** (Protects active reservations & modified offers) |
| Deterministic & Idempotent Logic | **PASSED** (`off_${variant.id}` deterministic key) |
| Preservation of Conditions, Prices, Stock, MOQ | **PASSED** (Preserved in full) |
| Automated Test Coverage | **PASSED** (40/40 backfill tests, 329/329 full suite, exit code 0) |
| Typecheck and Build | **PASSED** (Zero TypeScript errors) |
| Strict Read-Only Rule Adherence | **PASSED** (No live database connections, writes, commits or pushes) |

**FINAL VERDICT: READY FOR REVIEW**

The Stage 2 Offer Backfill and Database Migration tooling is fully prepared, tested, and guarded. Execution remains paused awaiting explicit user authorization.
