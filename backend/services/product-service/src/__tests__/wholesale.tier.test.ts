import { describe, it, expect } from '@jest/globals';
import {
  validateWholesaleTiers,
  WholesaleTierSchema,
  WholesaleTiersArraySchema,
} from '../../../../shared/types/product.types.js';

describe('Wholesale Tiers Validation', () => {
  it('accepts null and undefined as valid (no wholesale tiers defined)', () => {
    expect(validateWholesaleTiers(null)).toEqual({ valid: true, data: undefined });
    expect(validateWholesaleTiers(undefined)).toEqual({ valid: true, data: undefined });
  });

  it('accepts valid strictly increasing tiers with volume price drops', () => {
    const validTiers = [
      { minQty: 10, price: 900, label: 'Small Bulk' },
      { minQty: 50, price: 800, label: 'Medium Bulk' },
      { minQty: 200, price: 700, label: 'Wholesale Pallet' },
    ];
    const res = validateWholesaleTiers(validTiers, 1000);
    expect(res.valid).toBe(true);
    expect(res.data).toHaveLength(3);
  });

  it('rejects tier when price is not lower than base price', () => {
    const tiers = [{ minQty: 10, price: 1050 }];
    const res = validateWholesaleTiers(tiers, 1000);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/must be lower than base price/);
  });

  it('rejects non-positive quantities', () => {
    const tiers = [{ minQty: 0, price: 900 }];
    const res = validateWholesaleTiers(tiers, 1000);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/positive integer/);
  });

  it('rejects negative or zero prices', () => {
    const tiers = [{ minQty: 10, price: 0 }];
    const res = validateWholesaleTiers(tiers, 1000);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/positive number/);
  });

  it('rejects duplicate or non-increasing quantity thresholds', () => {
    const duplicateTiers = [
      { minQty: 10, price: 900 },
      { minQty: 10, price: 850 },
    ];
    const res = validateWholesaleTiers(duplicateTiers, 1000);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/strictly increasing minimum quantities/);

    const decreasingTiers = [
      { minQty: 50, price: 850 },
      { minQty: 20, price: 900 },
    ];
    expect(validateWholesaleTiers(decreasingTiers, 1000).valid).toBe(false);
  });

  it('rejects tiers where price does not decrease with higher quantity', () => {
    const nonDecreasingPrice = [
      { minQty: 10, price: 800 },
      { minQty: 50, price: 850 }, // higher price for higher volume is invalid
    ];
    const res = validateWholesaleTiers(nonDecreasingPrice, 1000);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/strictly decreasing prices/);
  });
});
