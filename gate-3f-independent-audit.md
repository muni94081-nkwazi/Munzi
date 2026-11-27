# Independent Security & Financial-Integrity Audit: Gate 3F
## MUNZI B2B Wholesale Hardening & Trade Settlement

- **Audit Date:** 2026-11-26
- **Auditor:** Antigravity (Independent Engineering & Security Review)
- **Scope:** `backend/services/order-service`, `backend/services/payment-service`, `backend/services/product-service`, Gate 3F implementation & Gate 3G readiness.
- **Mode:** READ-ONLY inspection (no mutations, migrations, backfills, or commits executed).

---

## Executive Summary

| Category | Finding Summary | Severity |
| :--- | :--- | :--- |
| **Trade Assurance Integration** | State-machine tracking only in MongoDB; no link to `payment-service` real escrow ledger. | **HIGH (Financial)** |
| **Wholesale Authorization** | Payment confirmation endpoint allows arbitrary authenticated caller; seller can trigger escrow release. | **HIGH (Security)** |
| **Wholesale Pricing & MOQ** | Server-side pricing authoritative; offer tiers and MOQ strictly validated. | **SECURE** |
| **Database Persistence** | In-memory `Map` fully eliminated; MongoDB schema and repository active; idempotency key missing. | **MEDIUM (Reliability)** |
| **Test Quality** | Unit tests pass (14/14), but 100% rely on in-memory mocks; no real MongoDB or HTTP controller integration tests. | **MEDIUM (Testing)** |
| **Gate 3G Readiness** | Core backfill & reconciliation logic exists in `backfill.service.ts`, but CLI runner, backup, and rollback scripts are missing. | **NOT READY** |

### Audit Verdicts
- **Gate 3F Verdict:** **ACCEPT WITH CONDITIONS**  
  *The core objective of Gate 3F—eradicating the in-memory Map in `order-service`, introducing MongoDB persistence, enforcing MOQ, and connecting dynamic volume tiers—is architecturally achieved. However, the conditions detailed below must be addressed before live financial exposure.*
- **Gate 3G Readiness Verdict:** **NOT READY**  
  *Execution scripts (CLI runner, database backup verification, and automated rollback) must be created and verified prior to executing any backfill against real catalogue data.*

---

## 1. Trade Assurance Financial Integration Audit

### 1.1 Findings
- **Tracking-Only Escrow**: In [backend/services/order-service/src/services/wholesale.service.ts](file:///c:/PROJECTS/Code/Munzi/backend/services/order-service/src/services/wholesale.service.ts#L306-L391):
  - `confirmTradeAssurancePayment`: Stamped in MongoDB as `status: 'PAID'` and `escrowStatus: 'held'`.
  - `releaseTradeAssuranceEscrow`: Updates MongoDB `escrowStatus: 'released'`.
  - `disputeTradeAssurance`: Updates MongoDB `escrowStatus: 'disputed'`.
  - `refundTradeAssuranceEscrow`: Updates MongoDB `status: 'CANCELLED'` and `escrowStatus: 'refunded'`.
- **Zero Payment-Service / Ledger Integration**:
  - `order-service` does **not** call `payment-service`'s real escrow engine ([backend/services/payment-service/src/services/escrow.service.ts](file:///c:/PROJECTS/Code/Munzi/backend/services/payment-service/src/services/escrow.service.ts)), which writes PostgreSQL `prisma.escrowHold` records, checks balances, and records ledger entries.
  - No Kafka events (`TOPICS.ESCROW_EVENTS`) or RabbitMQ events are published upon wholesale payment, release, or refund.
- **Disputed Fund Release Protection**:
  - In `releaseTradeAssuranceEscrow` (line 332):
    ```ts
    if (order.escrowStatus !== 'held') {
      throw new InvalidWholesaleRequestError(
        `Cannot release escrow when current escrow status is ${order.escrowStatus ?? 'none'}.`,
      );
    }
    ```
    If `escrowStatus === 'disputed'`, release is blocked by this check. However, because this check is only an application-level guard on a MongoDB document without a database-level lock or atomic update filter, it does not represent real financial locking.

### 1.2 Risk Assessment
> [!CAUTION]
> **Trade Assurance in `order-service` is currently tracking-only metadata.**
> Marking a wholesale order as `PAID` or `released` does not move actual funds, hold escrow in a banking/ledger sense, or disburse funds to the vendor. If an external client integrates with this endpoint expecting real escrow, funds will not be secured.

---

## 2. Wholesale Order Security & Authorization Audit

### 2.1 Endpoint Authorization Matrix

| Endpoint | Controller Method | Required Auth | Access Rule Enforced | Security Finding |
| :--- | :--- | :--- | :--- | :--- |
| `GET /api/v1/wholesale/tiers` | `getTiers` | `requireAuth` | Public authenticated | **PASS** — tier discovery. |
| `POST /api/v1/wholesale/orders` | `createOrder` | `requireAuth` | `userId = res.locals.userId` | **PASS** — buyer identity enforced from JWT. |
| `GET /api/v1/wholesale/orders` | `listOrders` | `requireAuth` | `userId = res.locals.userId` | **PASS** — buyer scoped to own orders. |
| `GET /api/v1/wholesale/orders/:id` | `getOrderById` | `requireAuth` | Buyer, Seller, or Admin | **PASS** — non-participants get 403. |
| `PATCH /api/v1/wholesale/orders/:id/status` | `updateStatus` | `requireAuth` | Buyer, Seller, or Admin | **MEDIUM RISK** — Role-based transition check missing (buyer can mark `DISPATCHED`; seller can mark `DELIVERED`). |
| `POST /api/v1/wholesale/orders/:id/confirm-payment` | `confirmPayment` | `requireAuth` | **None** | **HIGH VULNERABILITY** — Any authenticated user can mark any order as `PAID`. |
| `POST /api/v1/wholesale/orders/:id/release-escrow` | `releaseEscrow` | `requireAuth` | Buyer, Seller, or Admin | **HIGH VULNERABILITY** — Seller can call this to release escrow to themselves. |
| `POST /api/v1/wholesale/orders/:id/dispute` | `disputeOrder` | `requireAuth` | Buyer, Seller, or Admin | **PASS** — Freezes order when participant disputes. |

### 2.2 Client-Submitted Data Validation
- **Prices & Totals**: Client-submitted prices are completely ignored. `wholesale.service.ts` calls `fetchOffer` or `fetchProduct` to authoritatively resolve unit prices and calculate `totalPrice = unitPrice * quantity`.
- **Seller IDs**: Extracted directly from the catalog offer or product record. The buyer cannot spoof the `sellerId`.
- **MOQ & Tier Validation**: `createWholesaleOrder` validates `quantity >= (offer.moq ?? 1)`. If below MOQ, it rejects with `422 Unprocessable Entity`.
- **Offer Status**: `fetchOffer` in `catalog.client.ts` verifies `offer.status === 'ACTIVE'` and `product.status === 'ACTIVE'`. Inactive or suspended offers cannot be ordered.

---

## 3. MongoDB Persistence & Reliability Audit

### 3.1 Database Integration
- **Model Registration**: [backend/services/order-service/src/models/wholesale.schema.ts](file:///c:/PROJECTS/Code/Munzi/backend/services/order-service/src/models/wholesale.schema.ts) exports `WholesaleOrderModel = mongoose.model('WholesaleOrder', WholesaleOrderSchema)`.
- **Connection**: Managed in [backend/services/order-service/src/db/mongoose.ts](file:///c:/PROJECTS/Code/Munzi/backend/services/order-service/src/db/mongoose.ts) via `connectDB()`.
- **Repository Pattern**: [backend/services/order-service/src/repositories/wholesale.repository.ts](file:///c:/PROJECTS/Code/Munzi/backend/services/order-service/src/repositories/wholesale.repository.ts) provides `IWholesaleRepository` and `MongoWholesaleRepository`.

### 3.2 Reliability & Concurrency Risks
1. **Idempotency Deficit**:
   - Standard consumer orders in `order.schema.ts` use `checkoutSessionId: { type: String, unique: true, sparse: true }`.
   - Wholesale orders generate a random ID `WS-${randomUUID().slice(0, 8)}` on every call. If a buyer double-submits, two distinct wholesale orders are created.
2. **Race Conditions on State Transitions**:
   - In `releaseTradeAssuranceEscrow`, the check `if (order.escrowStatus !== 'held')` occurs in Node.js memory. The repository update executes `findByIdAndUpdate` without including `{ escrowStatus: 'held' }` in the MongoDB query filter. Two rapid concurrent requests can race past the guard.

---

## 4. Test Suite Audit

### 4.1 Analysis of `wholesale.service.test.ts`
- **Tests Executed**: 14 tests across 4 describe blocks.
- **Coverage**:
  - `getWholesaleTiers`: Standard bands vs. dynamic offer tiers.
  - `createWholesaleOrder`: Quantity validation, MOQ rejection, dynamic tier pricing, catalogue fallback.
  - `Order Retrieval & Access Control`: Scoped queries by buyer/seller, 403 for unauthorized actors, 404 for missing orders.
  - `Trade Settlement & Escrow Lifecycle`: Payment confirmation, stage progression (`DISPATCHED` -> `DELIVERED`), delivery terminal guard, escrow release, dispute freeze, dispute refund.
- **Gaps Identified**:
  - **100% Mocked**: The test suite uses an in-memory `Map` mock (`mockRepo`) rather than `MongoWholesaleRepository` or an embedded MongoDB memory server.
  - **No HTTP Layer Coverage**: `wholesale.controller.ts` endpoints are not tested with `supertest` for input parsing and HTTP status code mappings.
  - **No Payment Service Integration**: No test asserts financial ledger creation because the link does not yet exist.

---

## 5. Gate 3G Readiness Audit (Stage 2 Migration & Backfill)

### 5.1 Existing Assets
- **Backfill Engine**: [backend/services/product-service/src/services/backfill.service.ts](file:///c:/PROJECTS/Code/Munzi/backend/services/product-service/src/services/backfill.service.ts):
  - Deterministic offer ID generation: `off_${variant.id}`.
  - Idempotent: checks `product.offers?.find(...)` and skips existing.
  - Strict Buy Box integrity: backfilled offers default to `isBuyBoxWinner = false`.
  - Quarantine protocol: flags unverified sellers (`QUARANTINE_UNVERIFIED_SELLER`) and zero-variant products.
  - Dry-run capability: `runCatalogueBackfill({ dryRun: true })` previews operations without DB writes.
  - 1:1 Parity Reconciliation: `reconcileLegacyToOffers()` verifies price, stock, and reservation parity.

### 5.2 Deficiencies Blocking Immediate 3G Execution
1. **Missing Standalone CLI Runner**: There is no runnable CLI script (e.g. `npm run backfill -- --dry-run`) in `product-service` or root `package.json`.
2. **Missing Pre-Migration Database Snapshot Script**: No automated script exists to dump/snapshot the PostgreSQL `Product` / `ProductVariant` tables before mutation.
3. **Missing Automated Rollback Script**: If `reconcileLegacyToOffers()` reports `isParityConfirmed === false`, there is no script to automatically delete `off_*` rows and restore quarantined products to their previous state.

---

## Required Fixes (Conditions for Acceptance)

### Priority 1: Wholesale Authorization Hardening (Must complete before production deployment)
1. **Restrict `confirmPayment`**:
   - `POST /api/v1/wholesale/orders/:id/confirm-payment` must require `requireInternalCaller` (from payment webhook/saga) or `requireRole('ROLE_ADMIN')`.
2. **Restrict `releaseEscrow`**:
   - Enforce that `actorId === order.userId || isAdmin`. Sellers must **not** be allowed to release escrow to themselves.
3. **Enforce Role-Based Order Transitions in `updateOrderStatus`**:
   - Only seller or admin can transition to `DISPATCHED`.
   - Only buyer or admin can transition to `DELIVERED`.

### Priority 2: Atomic MongoDB Status Updates
- Change `MongoWholesaleRepository.updateEscrowStatus` to query atomically:
  ```ts
  WholesaleOrderModel.findOneAndUpdate(
    { _id: id, escrowStatus: 'held' },
    { $set: { escrowStatus, updatedAt: new Date().toISOString() } },
    { new: true }
  )
  ```

### Priority 3: Gate 3G Tooling
- Author `backend/services/product-service/src/scripts/run-backfill.ts` supporting `--dry-run` and `--execute`.
- Author rollback script `backend/services/product-service/src/scripts/rollback-backfill.ts`.

---

## Final Verdicts

### Gate 3F Audit Verdict: **ACCEPT WITH CONDITIONS**
- **Justification**: The core architectural goals of Gate 3F are achieved: in-memory storage has been eradicated, MongoDB persistence is operational, and dynamic offer volume tiers and MOQ are authoritatively calculated and enforced.
- **Conditions**: The authorization vulnerabilities on `confirm-payment` and `release-escrow` and role-based status transition restrictions must be patched before live traffic is enabled.

### Gate 3G Readiness Verdict: **NOT READY**
- **Justification**: Backfill algorithms in `backfill.service.ts` are high-quality and tested, but the operational wrapper scripts (CLI runner, backup verification, and rollback execution) are not yet in place.
