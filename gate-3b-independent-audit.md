# MUNZI — INDEPENDENT GATE 3B AUDIT: BUY BOX ALGORITHM & SELECTION ENGINE
## Principal Software Architecture & Senior Backend Audit Report

**Audit Target:** Gate 3B (Buy Box Algorithm, Scoring Engine & Selection Architecture)  
**Repository:** `c:\PROJECTS\Code\Munzi`  
**Date:** November 21, 2026  
**Auditor:** Principal Software Architect & Lead Security/Backend Auditor  
**Status:** Independent Inspection Complete  

---

## 1. EXECUTIVE SUMMARY & AUDIT VERDICT

An independent, non-destructive technical audit of the Munzi codebase was conducted to inspect and verify the implementation of **Gate 3B: Buy Box Algorithm & Selection Engine**. The audit evaluated source files, database schemas, API routing, authorization boundaries, concurrency guarantees, and test suites across `backend/services/product-service` and `backend/api-gateway`.

The previous completion claim asserting that Gate 3B provides a fully functional, production-ready Buy Box selection engine was subjected to rigorous verification against the actual repository state.

### Final Recommendation: **ACCEPT WITH CONDITIONS**

**Justification:**  
The core algorithmic evaluation engine (`calculateBuyBoxScore` and `evaluateBuyBoxForVariant` in `buybox.service.ts`) is well-designed, mathematically bounded, deterministic, and backed by a comprehensive unit and controller test suite (311 tests passing across `product-service`). However, critical architectural, security, and edge-routing defects exist that must be corrected before Gate 3B can be considered production-safe or exposed to external traffic:
1. **Critical Public Information Disclosure:** The public Buy Box variant and product endpoints return unredacted seller inventory counts (`stock`), active cart reservations (`reserved`), internal `sellerSku`, and granular algorithmic scoring internals (`sellerTrustScore`, `priceScore`, etc.), violating seller confidentiality and enabling competitor scraping and algorithm gaming.
2. **Missing Admin API Gateway Route:** The administrative recalculation endpoint (`POST /api/v1/admin/buybox/recalculate`) is implemented in `product-service` but is **not mounted in API Gateway's `admin.routes.ts`**, causing all admin recalculation calls via the gateway to fail with HTTP 404.
3. **Absence of Database-Level Concurrency Constraints:** The PostgreSQL schema lacks a partial unique index (`WHERE "isBuyBoxWinner" = true`), and the evaluation method lacks variant-level row locking. Under concurrent transaction writes, multiple competing offers can simultaneously acquire `isBuyBoxWinner = true`.
4. **Omission of Shipping & Fulfillment Speed:** Landed cost calculation currently reflects only catalogue unit price (`offer.price`), with zero integration to `shipping-service` or carrier rates. Fulfillment speed is completely omitted from the scoring engine.

---

## 2. VERIFIED FUNCTIONALITY

The following capabilities were independently verified in the repository code and confirmed functional:

1. **Deterministic Multi-Factor Scoring Engine (`buybox.service.ts`):**
   - **Composite Score:** Accurately calculates a normalized score bounded between 0 and 1000 points.
   - **Price Weighting (0 – 600 pts):** Uses inverse proportional formula `(minPrice / offerPrice) * 600`. Lowest priced eligible offer receives full 600 points; higher priced offers are penalized proportionally.
   - **Sellable Stock Weighting (0 – 200 pts):** Evaluates `sellableStock = Math.max(0, offer.stock - offer.reserved)`. Scales linearly (`sellableStock / 10 * 200`) and caps at 200 points for inventory $\ge 10$ units.
   - **Condition Weighting (0 – 150 pts):** Correctly prioritizes item conditions via `CONDITION_WEIGHTS` (`NEW` = 150, `USED_LIKE_NEW` = 100, `REFURBISHED` = 80, `OPEN_BOX` = 80, `USED_GOOD` = 50, `USED_FAIR` = 20, `FOR_PARTS` = 0).
   - **Seller Trust Weighting (0 – 50 pts):** Grants +30 points for verified merchants and +20 points for sellers in `GOOD` standing (+5 for `AT_RISK`).

2. **Zero-Price and Out-of-Stock Protection:**
   - In `calculateBuyBoxScore`, any offer with `offerPrice <= 0` or `sellableStock <= 0` immediately returns a score of 0 with a zeroed-out score breakdown.
   - In `evaluateBuyBoxForVariant`, candidate offers are pre-filtered by `status === 'ACTIVE' && (stock - reserved) > 0`. Zero-stock or negative-stock offers are disqualified prior to minimum price calculations.

3. **Deterministic Multi-Tier Tie-Breaking:**
   - In `evaluateBuyBoxForVariant`, if two or more offers achieve identical scores, ranking follows a strict 3-tier deterministic priority:
     1. Composite Score descending (`b.score - a.score`).
     2. Listing seniority ascending (`timeA - timeB` via `createdAt`).
     3. Lexicographical offer ID comparison (`a.offer.id.localeCompare(b.offer.id)`).

4. **Fail-Closed Seller Eligibility Verification (`seller-eligibility.service.ts`):**
   - Integrates with `user-service` (`/api/v1/internal/sellers/:id/eligibility`) and `marketplace-service` (`/api/v1/internal/marketplace/sellers/:id/store`).
   - Requires `isActive === true`, `role === 'SELLER'`, and `standing !== 'SUSPENDED'`.
   - Requires `storeStatus === 'ACTIVE'` and `verificationStatus === 'verified'`.
   - Fails closed on timeouts (3000ms), 5xx errors, or network partitions by returning `isEligible: false`.
   - Caches seller eligibility per `sellerId` during variant evaluation to prevent redundant HTTP roundtrips.

5. **Lifecycle Trigger Integration (`offer.service.ts`):**
   - **Offer Creation:** Automatically triggers `evaluateBuyBoxForVariant` inside the Prisma transaction following insert.
   - **Offer Updates:** Inspects mutated fields (`['price', 'stock', 'condition', 'status']`); automatically triggers re-evaluation if any scoring factor is modified.
   - **Admin Moderation:** Triggered when an offer is administratively suspended or unsuspended via `adminModerateOffer`.
   - **Offer Deletion:** Triggered when an offer is deleted via `deleteOffer`.

6. **All-Ineligible Winner Demotion:**
   - When all offers for a variant become out of stock (`stock - reserved <= 0`), inactive, or suspended, `evaluateBuyBoxForVariant` executes `updateMany` to reset all `isBuyBoxWinner` flags to `false`.
   - When all competing sellers fail eligibility checks, all offers are demoted to `false` and `winningOfferId: null` is returned.

---

## 3. MISSING FUNCTIONALITY & GAPS

| Area | Missing Feature | Impact & Current Implementation State |
|---|---|---|
| **Landed Cost** | Shipping Integration | `calculateBuyBoxScore` uses catalogue unit price (`offer.price`) only. `shipping-service` rates, delivery destination zones, and carrier fees are **not integrated**. Competing offers with low product prices but exorbitant shipping can erroneously win the Buy Box. |
| **Fulfillment Speed** | Delivery SLA Scoring | Zero scoring factor exists for fulfillment speed, dispatch window, or shipping transit time. A seller shipping in 7 days receives the same operational score as a 24-hour express fulfillment seller. |
| **Seller Ratings** | Customer Review & Defect Integration | Scoring considers only binary merchant verification and `standing` enum. Actual customer review ratings (e.g. 1–5 stars from `review-service`), order defect rate (ODR), and cancellation rate are not queried or scored. |
| **Inventory Event Triggers** | Hold-Driven Re-evaluation | When `inventory-service` reserves stock during cart/checkout hold creation, it directly increments `reserved` in `muni_products` without invoking `evaluateBuyBoxForVariant`. An offer whose inventory is exhausted by cart holds retains the Buy Box until a separate write occurs in `product-service`. |
| **Seller Suspension Triggers** | Event-Driven Seller Invalidation | `product-service` does not consume Kafka events for seller suspension. When a seller is suspended in `user-service`, their active offers retain `isBuyBoxWinner = true` until the next variant mutation or manual recalculation. |
| **API Gateway Mounting** | Admin Recalculate Route | `backend/api-gateway/src/routes/admin.routes.ts` does not mount `/buybox` to `targets.product`. Gateway proxies return 404 on `POST /api/v1/admin/buybox/recalculate`. |

---

## 4. SECURITY, PRIVACY & CONCURRENCY RISKS

### 4.1 Critical Data Exposure on Public Endpoints (CWE-200 / OWASP API3:2023)
In [offer.controller.ts](file:///c:/PROJECTS/Code/Munzi/backend/services/product-service/src/controllers/offer.controller.ts#L244-L268) and [buybox.service.ts](file:///c:/PROJECTS/Code/Munzi/backend/services/product-service/src/services/buybox.service.ts#L273-L283):
- The public endpoints `GET /api/v1/products/:id/buybox` and `GET /api/v1/products/variants/:variantId/buybox` return the raw evaluation result containing `winner: winner.offer` and `breakdown: winner.breakdown`.
- **Exposed Sensitive Data:**
  - `winner.stock`: Exact warehouse inventory count is exposed to anonymous public callers. Competitors can track competitors' inventory levels and daily sales volume.
  - `winner.reserved`: Exact quantity of units currently in active carts/checkout holds.
  - `winner.sellerSku`: Seller's private internal inventory identifier.
  - `breakdown.sellerTrustScore`: Internal platform trust scoring metrics exposed to public scrapers and rival vendors, facilitating algorithmic reverse-engineering and gaming.
- **Contrast with `publicGet`:** In `offer.service.ts`, `publicGet` rigorously sanitizes output by returning `inStock: boolean` and stripping `stock`, `reserved`, and `sellerSku`. The Buy Box endpoints completely bypass this sanitization.

### 4.2 Multi-Winner Concurrency Race Condition
In [buybox.service.ts](file:///c:/PROJECTS/Code/Munzi/backend/services/product-service/src/services/buybox.service.ts#L254-L271):
- Winner demotion and promotion are executed in two consecutive statements:
  ```typescript
  await client.productOffer.updateMany({
    where: { variantId, isBuyBoxWinner: true, NOT: { id: winner.offer.id } },
    data: { isBuyBoxWinner: false },
  });
  await client.productOffer.update({
    where: { id: winner.offer.id },
    data: { isBuyBoxWinner: true },
  });
  ```
- **Concurrency Flaw:**
  1. `evaluateBuyBoxForVariant` does not use row-level locking (`SELECT ... FOR UPDATE` or transactional advisory locks) on the variant.
  2. The Prisma schema (`backend/services/product-service/prisma/schema.prisma`) **lacks a partial unique index** enforcing `UNIQUE (variantId) WHERE isBuyBoxWinner = true`.
  3. If two concurrent transactions $T_1$ and $T_2$ evaluate competing offers $A$ and $B$ for the same variant simultaneously, interleaving can cause $T_1$ to promote $A$ after $T_2$ has already demoted all non-$B$ records, followed by $T_2$ promoting $B$.
  4. **Outcome:** Both Offer $A$ and Offer $B$ persist with `isBuyBoxWinner = true`, corrupting catalogue integrity and storefront display.

### 4.3 Missing Rate Limiting and Unauthenticated DoS Potential
`GET /api/v1/products/variants/:variantId/buybox` is a public endpoint that triggers a real-time database query across all offers and performs remote HTTP calls to `user-service` and `marketplace-service` for seller verification. An unauthenticated attacker can flood variant Buy Box endpoints, exhausting downstream connection pools.

---

## 5. ACTUAL TEST RESULTS

Unit and integration test suites were independently executed inside `backend/services/product-service` and `backend/api-gateway` using the project's native Jest and ESM runtime.

### Test Execution Summary

| Test Suite | Location | Tests Passed | Tests Failed | Execution Time | Status |
|---|---|---|---|---|---|
| **Buy Box Service Suite** | `product-service/src/__tests__/buybox.service.test.ts` | 23 | 0 | 2.52 s | **PASS** |
| **Product Offer Service Suite** | `product-service/src/__tests__/offer.service.test.ts` | 27 | 0 | 1.32 s | **PASS** |
| **Product Offer Controller Suite** | `product-service/src/__tests__/offer.controller.test.ts` | 18 | 0 | 1.12 s | **PASS** |
| **Gateway Offer Routing Suite** | `api-gateway/src/__tests__/offer.routing.test.ts` | 13 | 0 | 9.34 s | **PASS** |
| **Full Product-Service Suite** | `product-service/src/__tests__/*.test.ts` (17 suites) | 311 | 0 | 13.26 s | **PASS** |

### Environment vs. Code Failure Distinction
- **PowerShell Script Policy Warning:** Initial command execution using `npm test` triggered a Windows PowerShell security exception (`AuthorizationManager check failed`). This was strictly an environment/host execution-policy restriction on PowerShell script wrappers (`npm.ps1`). Executing directly via the native command binary `npm.cmd` resolved the issue.
- **Zero Test Failures:** There are zero code-level test failures. All 311 tests in `product-service` and all 13 routing tests in `api-gateway` passed with zero errors.

---

## 6. REQUIRED CORRECTIONS

To fulfill production readiness and ensure platform integrity before Gate 3C, the following corrections are required:

### 1. Sanitize Public Buy Box API Responses (High Priority)
Update `getBuyBoxForVariant` and `getBuyBoxForProduct` in `offer.controller.ts` to return a sanitized view.
- **Strip from `winner`:** `stock`, `reserved`, `sellerSku`. Return `inStock: boolean` instead.
- **Strip from response:** Remove `breakdown.sellerTrustScore` and internal scoring details for public callers; expose only customer-relevant attributes (e.g. `isVerifiedMerchant`, price, condition). Reserve detailed score breakdowns for `ROLE_ADMIN` callers.

### 2. Mount Buy Box Admin Route in API Gateway (High Priority)
In `backend/api-gateway/src/routes/admin.routes.ts`, add:
```typescript
route('/buybox', targets.product); // Buy Box recalculation endpoints
```
This ensures `POST /api/v1/admin/buybox/recalculate` is reachable by administrators and automated maintenance routines.

### 3. Add Partial Unique Index & Transactional Locking (High Priority)
In `product-service/prisma/schema.prisma` and database migrations:
1. Add a PostgreSQL partial unique index:
   ```sql
   CREATE UNIQUE INDEX "idx_product_offer_single_buybox_winner" 
   ON "ProductOffer" ("variantId") 
   WHERE "isBuyBoxWinner" = true;
   ```
2. In `evaluateBuyBoxForVariant`, execute within a single Prisma transaction and acquire an advisory lock or variant lock (`SELECT id FROM "ProductVariant" WHERE id = $1 FOR UPDATE`) to prevent interleaved race conditions during concurrent offer updates.

### 4. Roadmap Integration: Landed Cost & Fulfillment Speed (Medium Priority - Post Gate 3B)
1. Integrate `shipping-service` into `calculateBuyBoxScore` when shipping estimation APIs become available, replacing `offerPrice` with `offerPrice + estimatedStandardShipping`.
2. Add a `fulfillmentSpeedScore` (e.g. 0 to 100 points) based on seller dispatch SLA / delivery promise.
3. Subscribe `product-service` to Kafka topics `seller.suspended` and `inventory.reservation.exhausted` to trigger automated asynchronous Buy Box re-evaluations.

---

## 7. FINAL AUDIT DECISION

```
================================================================================
AUDIT VERDICT: ACCEPT WITH CONDITIONS
================================================================================
```

The algorithmic core of Gate 3B is verified, deterministic, mathematically sound, and thoroughly tested. However, the platform must not proceed to public exposure until the **data exposure vulnerabilities on public endpoints** and the **missing API Gateway admin route** are corrected. Source code and database state remain preserved and unmodified in strict compliance with the audit protocol.
