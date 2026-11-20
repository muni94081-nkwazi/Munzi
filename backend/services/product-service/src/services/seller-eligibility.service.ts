import { fetch } from 'undici';

export interface SellerEligibilityResult {
  isEligible: boolean;
  reason?: string;
  standing?: 'GOOD' | 'AT_RISK' | 'SUSPENDED';
  isVerifiedMerchant?: boolean;
  storeStatus?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  verificationStatus?: 'pending' | 'verified' | 'rejected';
}

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';
const MARKETPLACE_SERVICE_URL = process.env.MARKETPLACE_SERVICE_URL || 'http://localhost:4003';
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Verify seller eligibility fail-closed across user-service and marketplace-service.
 *
 * Rules:
 * 1. User must exist in user-service, have role SELLER, isActive = true, and standing != SUSPENDED.
 * 2. Store must exist in marketplace-service, have status ACTIVE, and verificationStatus = verified.
 * 3. If either service is unreachable, times out, or returns an error, evaluation fails closed (isEligible: false).
 */
export async function verifySellerEligibility(sellerId: string): Promise<SellerEligibilityResult> {
  if (!sellerId || typeof sellerId !== 'string' || sellerId.trim() === '') {
    return {
      isEligible: false,
      reason: 'INVALID_SELLER_ID',
    };
  }

  // Allow explicit bypass in test/development when specifically configured
  if (process.env.SKIP_SELLER_ELIGIBILITY_CHECK === 'true') {
    return {
      isEligible: true,
      standing: 'GOOD',
      isVerifiedMerchant: true,
      storeStatus: 'ACTIVE',
      verificationStatus: 'verified',
    };
  }

  try {
    // 1. Check user-service for user active state, role, and seller standing
    const userRes = await fetch(`${USER_SERVICE_URL}/api/v1/internal/sellers/${sellerId}/eligibility`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'x-internal-service': 'product-service',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(() => null);

    if (!userRes || !userRes.ok) {
      return {
        isEligible: false,
        reason: 'USER_SERVICE_UNAVAILABLE',
      };
    }

    const userData = (await userRes.json()) as any;
    if (!userData || !userData.success || !userData.data) {
      return {
        isEligible: false,
        reason: 'SELLER_ACCOUNT_INVALID',
      };
    }

    const { isActive, role, standing, isVerifiedMerchant } = userData.data;
    if (!isActive || role !== 'SELLER' || standing === 'SUSPENDED') {
      return {
        isEligible: false,
        reason: standing === 'SUSPENDED' ? 'SELLER_SUSPENDED' : 'SELLER_ACCOUNT_INELIGIBLE',
        standing,
        isVerifiedMerchant,
      };
    }

    // 2. Check marketplace-service for store status and verification status
    const storeRes = await fetch(`${MARKETPLACE_SERVICE_URL}/api/v1/internal/marketplace/sellers/${sellerId}/store`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'x-internal-service': 'product-service',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(() => null);

    if (!storeRes || !storeRes.ok) {
      return {
        isEligible: false,
        reason: 'MARKETPLACE_SERVICE_UNAVAILABLE',
        standing,
        isVerifiedMerchant,
      };
    }

    const storeData = (await storeRes.json()) as any;
    if (!storeData || !storeData.success || !storeData.data) {
      return {
        isEligible: false,
        reason: 'STORE_NOT_FOUND',
        standing,
        isVerifiedMerchant,
      };
    }

    const { storeStatus, verificationStatus } = storeData.data;
    if (storeStatus !== 'ACTIVE' || verificationStatus !== 'verified') {
      return {
        isEligible: false,
        reason: storeStatus !== 'ACTIVE' ? 'STORE_NOT_ACTIVE' : 'STORE_NOT_VERIFIED',
        standing,
        isVerifiedMerchant,
        storeStatus,
        verificationStatus,
      };
    }

    return {
      isEligible: true,
      standing,
      isVerifiedMerchant,
      storeStatus,
      verificationStatus,
    };
  } catch (error: any) {
    return {
      isEligible: false,
      reason: `VERIFICATION_FAILED: ${error.message || 'UNKNOWN_ERROR'}`,
    };
  }
}
