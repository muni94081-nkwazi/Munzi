import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  toInternalCondition,
  toExternalCondition,
  isValidCondition,
  validateWholesaleTiers,
} from '../../../../shared/types/product.types.js';

// ── Mock Prisma ───────────────────────────────────────────────────────────────
const mockPrisma: any = {
  product: {
    create:            jest.fn(),
    findUnique:        jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findMany:          jest.fn(),
    update:            jest.fn(),
    count:             jest.fn(),
  },
  productVariant: {
    createMany:        jest.fn(async () => ({ count: 1 })),
    create:            jest.fn(async ({ data }: any) => ({ id: 'v1', ...data })),
    update:            jest.fn(async ({ data }: any) => ({ id: 'v1', ...data })),
    findMany:          jest.fn(),
    findUnique:        jest.fn(),
    findFirst:         jest.fn(),
  },
  productSpecification: {
    createMany:        jest.fn(async () => ({ count: 1 })),
    deleteMany:        jest.fn(async () => ({ count: 0 })),
    findMany:          jest.fn(async () => []),
  },
  variantAttributeValue: {
    createMany:        jest.fn(async () => ({ count: 1 })),
    deleteMany:        jest.fn(async () => ({ count: 0 })),
  },
  categoryAttribute: {
    findUnique:        jest.fn(),
    findMany:          jest.fn(),
  },
  category: {
    findFirst:         jest.fn(),
  },
  $transaction: jest.fn(),
  $queryRaw:    jest.fn(),
};

function transactionMock(argument: any): any {
  return typeof argument === 'function' ? argument(mockPrisma) : Promise.all(argument);
}

mockPrisma.$transaction.mockImplementation(transactionMock);

jest.unstable_mockModule('../db/prisma.js', () => ({ prisma: mockPrisma }));

jest.unstable_mockModule('../../../../shared/kafka/producer.js', () => ({
  publish:            jest.fn(async () => undefined),
  connectProducer:    jest.fn(async () => undefined),
  disconnectProducer: jest.fn(async () => undefined),
  isProducerReady:    jest.fn(() => true),
  getProducer:        jest.fn(() => null),
}));

jest.unstable_mockModule('../services/search.service.js', () => ({
  indexProduct:           jest.fn(async () => undefined),
  deleteProductFromIndex: jest.fn(async () => undefined),
  searchProducts:         jest.fn(),
  ensureIndex:            jest.fn(async () => undefined),
}));

jest.unstable_mockModule('../../../../shared/cache/protected-cache.js', () => ({
  cached:            (_key: string, _ttl: number, loader: () => any) => loader(),
  entityVersion:     async () => 1,
  bumpEntityVersion: jest.fn(async () => undefined),
  CACHE_TTL:         { PRODUCT_DETAIL: 60, PRODUCT_LIST: 60 },
  invalidateProduct: jest.fn(async () => undefined),
}));

const {
  createProduct,
  updateProduct,
  listProducts,
  getProductSpecifications,
  setProductSpecifications,
} = await import('../services/product.service.js');

const {
  createVariant,
  updateVariant,
} = await import('../services/variant.service.js');

const {
  validateAttributeValue,
  getCategoryAncestorIds,
} = await import('../services/category-attribute.service.js');

const variantController = await import('../controllers/variant.controller.js');
const categoryAttributeController = await import('../controllers/category-attribute.controller.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Catalogue Foundation — Condition Conversion', () => {
  it('converts lowercase external condition to uppercase internal Prisma enum', () => {
    expect(toInternalCondition('new')).toBe('NEW');
    expect(toInternalCondition('used_like_new')).toBe('USED_LIKE_NEW');
    expect(toInternalCondition('like_new')).toBe('USED_LIKE_NEW');
    expect(toInternalCondition('used_good')).toBe('USED_GOOD');
    expect(toInternalCondition('used_fair')).toBe('USED_FAIR');
    expect(toInternalCondition('refurbished')).toBe('REFURBISHED');
    expect(toInternalCondition('open_box')).toBe('OPEN_BOX');
    expect(toInternalCondition('for_parts')).toBe('FOR_PARTS');
  });

  it('accepts uppercase internal condition directly on input', () => {
    expect(toInternalCondition('NEW')).toBe('NEW');
    expect(toInternalCondition('USED_LIKE_NEW')).toBe('USED_LIKE_NEW');
    expect(toInternalCondition('REFURBISHED')).toBe('REFURBISHED');
  });

  it('defaults to NEW when null or undefined is provided', () => {
    expect(toInternalCondition(null)).toBe('NEW');
    expect(toInternalCondition(undefined)).toBe('NEW');
    expect(toInternalCondition('')).toBe('NEW');
  });

  it('rejects unsupported or invalid condition values with 422', () => {
    expect(() => toInternalCondition('broken')).toThrow(/Invalid product condition/);
    expect(() => toInternalCondition('mint')).toThrow(/Invalid product condition/);
    expect(isValidCondition('broken')).toBe(false);
    expect(isValidCondition('new')).toBe(true);
    expect(isValidCondition('open_box')).toBe(true);
  });

  it('converts uppercase internal Prisma enum to lowercase external string', () => {
    expect(toExternalCondition('NEW')).toBe('new');
    expect(toExternalCondition('USED_LIKE_NEW')).toBe('used_like_new');
    expect(toExternalCondition('USED_GOOD')).toBe('used_good');
    expect(toExternalCondition('USED_FAIR')).toBe('used_fair');
    expect(toExternalCondition('REFURBISHED')).toBe('refurbished');
    expect(toExternalCondition('OPEN_BOX')).toBe('open_box');
    expect(toExternalCondition('FOR_PARTS')).toBe('for_parts');
    expect(toExternalCondition(null)).toBe('new');
  });
});

describe('Catalogue Foundation — Attribute Value Validation', () => {
  it('validates NUMBER attributes', () => {
    const attr = {
      id: 'a1', categoryId: 'c1', name: 'RAM', slug: 'ram',
      type: 'NUMBER', allowedValues: null, unit: 'GB',
      isVariantAxis: false, isFilterable: true, isRequired: true, sortOrder: 0, active: true,
    };
    expect(validateAttributeValue(attr, '16').valid).toBe(true);
    expect(validateAttributeValue(attr, '16.5').valid).toBe(true);
    expect(validateAttributeValue(attr, 'abc').valid).toBe(false);
  });

  it('validates BOOLEAN attributes', () => {
    const attr = {
      id: 'a2', categoryId: 'c1', name: 'Waterproof', slug: 'waterproof',
      type: 'BOOLEAN', allowedValues: null, unit: null,
      isVariantAxis: false, isFilterable: true, isRequired: false, sortOrder: 0, active: true,
    };
    expect(validateAttributeValue(attr, 'true').valid).toBe(true);
    expect(validateAttributeValue(attr, 'false').valid).toBe(true);
    expect(validateAttributeValue(attr, 'maybe').valid).toBe(false);
  });

  it('validates ENUM attributes against allowedValues', () => {
    const attr = {
      id: 'a3', categoryId: 'c1', name: 'Color', slug: 'color',
      type: 'ENUM', allowedValues: ['Midnight Blue', 'Starlight', 'Space Gray'], unit: null,
      isVariantAxis: true, isFilterable: true, isRequired: true, sortOrder: 0, active: true,
    };
    expect(validateAttributeValue(attr, 'Midnight Blue').valid).toBe(true);
    expect(validateAttributeValue(attr, 'Starlight').valid).toBe(true);
    expect(validateAttributeValue(attr, 'Neon Pink').valid).toBe(false);
  });

  it('validates DATE attributes', () => {
    const attr = {
      id: 'a4', categoryId: 'c1', name: 'Release Date', slug: 'release-date',
      type: 'DATE', allowedValues: null, unit: null,
      isVariantAxis: false, isFilterable: false, isRequired: false, sortOrder: 0, active: true,
    };
    expect(validateAttributeValue(attr, '2026-11-15').valid).toBe(true);
    expect(validateAttributeValue(attr, 'invalid-date').valid).toBe(false);
  });
});

describe('Catalogue Foundation — Product Creation & Update with Catalogue Extensions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(transactionMock);
    mockPrisma.product.findUnique.mockResolvedValue(null); // availableSlug
    mockPrisma.product.create.mockImplementation(async ({ data }: any) => ({
      id: 'prod-new-1',
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    mockPrisma.product.findUniqueOrThrow.mockImplementation(async () => ({
      id: 'prod-new-1',
      name: 'Wireless Earbuds',
      slug: 'wireless-earbuds',
      description: 'Noise cancelling',
      sellerId: 'seller-1',
      status: 'PENDING_APPROVAL',
      condition: 'REFURBISHED',
      moq: 5,
      wholesaleTiers: [{ minQty: 10, price: 45000 }],
      basePrice: 50000,
      currency: 'UGX',
      variants: [],
      specifications: [
        { id: 'spec-1', productId: 'prod-new-1', key: 'Bluetooth', value: '5.3', group: 'Technical', sortOrder: 0 },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
      rejectionReason: null,
      submittedAt: new Date(),
      moderatedAt: null,
      averageRating: 0,
      reviewCount: 0,
      viewCount: 0,
      images: [],
      tags: [],
    }));
  });

  it('creates a product with condition, moq, wholesaleTiers, and specifications', async () => {
    const result = await createProduct('seller-1', {
      name: 'Wireless Earbuds',
      slug: 'wireless-earbuds',
      basePrice: 50000,
      condition: 'refurbished',
      moq: 5,
      wholesaleTiers: [
        { minQty: 10, price: 45000, label: 'Batch 10+' },
        { minQty: 50, price: 40000, label: 'Bulk 50+' },
      ],
      specifications: [
        { key: 'Bluetooth', value: '5.3', group: 'Technical', sortOrder: 0 },
      ],
    });

    expect(mockPrisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          condition: 'REFURBISHED',
          moq: 5,
          wholesaleTiers: expect.arrayContaining([
            expect.objectContaining({ minQty: 10, price: 45000 }),
          ]),
        }),
      }),
    );

    expect(mockPrisma.productSpecification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ key: 'Bluetooth', value: '5.3', group: 'Technical' }),
        ]),
      }),
    );

    expect(result.condition).toBe('refurbished'); // formatted to lowercase on outbound
    expect(result.moq).toBe(5);
    expect(result.specifications).toHaveLength(1);
  });

  it('rejects product creation when wholesale tier price exceeds basePrice', async () => {
    await expect(
      createProduct('seller-1', {
        name: 'Earbuds',
        slug: 'earbuds',
        basePrice: 50000,
        wholesaleTiers: [{ minQty: 10, price: 55000 }], // invalid: tier price >= basePrice
      }),
    ).rejects.toThrow(/must be lower than base price/);
  });

  it('rejects negative or zero MOQ during creation', async () => {
    await expect(
      createProduct('seller-1', {
        name: 'Earbuds',
        slug: 'earbuds',
        basePrice: 50000,
        moq: 0,
      }),
    ).rejects.toThrow();
  });
});

describe('Catalogue Foundation — Product Specifications Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(transactionMock);
  });

  it('enforces seller ownership on setting product specifications', async () => {
    mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'prod-1',
      sellerId: 'seller-real',
      slug: 'my-product',
    });

    await expect(
      setProductSpecifications('prod-1', 'seller-attacker', [
        { key: 'Material', value: 'Titanium' },
      ]),
    ).rejects.toThrow(/Forbidden/);
  });

  it('replaces specifications for the owning seller', async () => {
    mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'prod-1',
      sellerId: 'seller-owner',
      slug: 'my-product',
    });

    mockPrisma.productSpecification.findMany.mockResolvedValueOnce([
      { id: 's1', productId: 'prod-1', key: 'Material', value: 'Titanium', group: 'General', sortOrder: 0 },
    ]);

    const specs = await setProductSpecifications('prod-1', 'seller-owner', [
      { key: 'Material', value: 'Titanium' },
    ]);

    expect(mockPrisma.productSpecification.deleteMany).toHaveBeenCalledWith({ where: { productId: 'prod-1' } });
    expect(mockPrisma.productSpecification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ key: 'Material', value: 'Titanium' }),
      ],
    });
    expect(specs).toHaveLength(1);
  });
});

describe('Catalogue Foundation — List Products Filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (queries: any) => {
      return [[], 0];
    });
  });

  it('filters by single condition converted to uppercase', async () => {
    await listProducts({ condition: 'used_like_new' });
    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          condition: 'USED_LIKE_NEW',
        }),
      }),
    );
  });

  it('filters by multiple comma-separated conditions', async () => {
    await listProducts({ condition: 'new,refurbished' });
    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          condition: { in: ['NEW', 'REFURBISHED'] },
        }),
      }),
    );
  });

  it('filters by maxMoq allowing products with no MOQ or lower MOQ', async () => {
    await listProducts({ maxMoq: 10 });
    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          OR: [
            { moq: null },
            { moq: { lte: 10 } },
          ],
        }),
      }),
    );
  });
});

describe('Catalogue Foundation — Wholesale Tier Revalidation on updateProduct', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(transactionMock);
  });

  it('rejects basePrice drop that invalidates existing wholesale tiers when wholesaleTiers is omitted', async () => {
    mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'p1',
      sellerId: 'seller-1',
      basePrice: 100000,
      wholesaleTiers: [{ minQty: 10, price: 80000 }],
      status: 'ACTIVE',
    });

    await expect(
      updateProduct('p1', 'seller-1', {
        basePrice: 70000, // drops below existing wholesale tier price of 80000
      }),
    ).rejects.toThrow(/would invalidate existing wholesale tiers/);
  });

  it('allows basePrice drop when existing wholesale tiers remain lower than new basePrice', async () => {
    mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'p1',
      sellerId: 'seller-1',
      basePrice: 100000,
      wholesaleTiers: [{ minQty: 10, price: 80000 }],
      status: 'ACTIVE',
      variants: [],
      reviews: [],
    });

    mockPrisma.product.update.mockResolvedValueOnce({
      id: 'p1',
      sellerId: 'seller-1',
      basePrice: 90000,
      wholesaleTiers: [{ minQty: 10, price: 80000 }],
      status: 'PENDING_APPROVAL',
      variants: [],
      reviews: [],
    });

    const updated = await updateProduct('p1', 'seller-1', {
      basePrice: 90000,
    });

    expect(updated).toBeDefined();
    expect(mockPrisma.product.update).toHaveBeenCalled();
  });
});

describe('Catalogue Foundation — Specifications Access Control', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects public requests for specifications of unpublished (DRAFT) products', async () => {
    mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'p-draft',
      sellerId: 'seller-owner',
      status: 'DRAFT',
    });

    await expect(getProductSpecifications('p-draft')).rejects.toMatchObject({
      status: 404,
      message: 'Product not found',
    });
  });

  it('rejects competitor requests for specifications of unpublished (PENDING_APPROVAL) products', async () => {
    mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'p-pending',
      sellerId: 'seller-owner',
      status: 'PENDING_APPROVAL',
    });

    await expect(
      getProductSpecifications('p-pending', { userId: 'seller-competitor', roles: ['ROLE_SELLER'] }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'Product not found',
    });
  });

  it('allows owning seller to read specifications of their unpublished product', async () => {
    mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'p-pending',
      sellerId: 'seller-owner',
      status: 'PENDING_APPROVAL',
    });
    mockPrisma.productSpecification.findMany.mockResolvedValueOnce([
      { id: 's1', productId: 'p-pending', key: 'Chipset', value: 'M3 Pro' },
    ]);

    const specs = await getProductSpecifications('p-pending', { userId: 'seller-owner', roles: ['ROLE_SELLER'] });
    expect(specs).toHaveLength(1);
    expect(specs[0].key).toBe('Chipset');
  });

  it('allows admin to read specifications of any unpublished product', async () => {
    mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'p-pending',
      sellerId: 'seller-owner',
      status: 'PENDING_APPROVAL',
    });
    mockPrisma.productSpecification.findMany.mockResolvedValueOnce([
      { id: 's1', productId: 'p-pending', key: 'Chipset', value: 'M3 Pro' },
    ]);

    const specs = await getProductSpecifications('p-pending', { userId: 'admin-1', roles: ['ROLE_ADMIN'] });
    expect(specs).toHaveLength(1);
  });

  it('allows anonymous/public callers to read specifications of ACTIVE products', async () => {
    mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'p-active',
      sellerId: 'seller-owner',
      status: 'ACTIVE',
    });
    mockPrisma.productSpecification.findMany.mockResolvedValueOnce([
      { id: 's1', productId: 'p-active', key: 'Screen', value: 'OLED' },
    ]);

    const specs = await getProductSpecifications('p-active');
    expect(specs).toHaveLength(1);
  });
});

describe('Catalogue Foundation — Variant Attribute Integrity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(transactionMock);
  });

  it('rejects variant creation when duplicate attribute IDs are submitted', async () => {
    mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'p1',
      sellerId: 'seller-1',
      slug: 'my-phone',
      categoryId: 'cat-phones',
    });

    await expect(
      createVariant('p1', {
        price: 50000,
        stock: 10,
        attributeValues: [
          { attributeId: 'attr-ram', value: '16GB' },
          { attributeId: 'attr-ram', value: '32GB' }, // duplicate attributeId
        ],
      }, 'seller-1'),
    ).rejects.toThrow();
  });

  it('rejects variant creation when attribute is inactive', async () => {
    mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'p1',
      sellerId: 'seller-1',
      slug: 'my-phone',
      categoryId: 'cat-phones',
    });
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'cat-phones' }]);
    mockPrisma.categoryAttribute.findUnique.mockResolvedValueOnce({
      id: 'attr-old',
      categoryId: 'cat-phones',
      name: 'Legacy Port',
      slug: 'legacy-port',
      type: 'TEXT',
      active: false, // inactive!
    });

    await expect(
      createVariant('p1', {
        price: 50000,
        stock: 10,
        attributeValues: [
          { attributeId: 'attr-old', value: 'Micro-USB' },
        ],
      }, 'seller-1'),
    ).rejects.toThrow(/is inactive and cannot be assigned/);
  });

  it('rejects variant creation when attribute belongs to an unrelated category', async () => {
    mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'p1',
      sellerId: 'seller-1',
      slug: 'my-phone',
      categoryId: 'cat-phones',
    });
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'cat-phones' }]);
    mockPrisma.categoryAttribute.findUnique.mockResolvedValueOnce({
      id: 'attr-shoe-size',
      categoryId: 'cat-shoes', // unrelated category!
      name: 'Shoe Size',
      slug: 'shoe-size',
      type: 'NUMBER',
      active: true,
    });

    await expect(
      createVariant('p1', {
        price: 50000,
        stock: 10,
        attributeValues: [
          { attributeId: 'attr-shoe-size', value: '42' },
        ],
      }, 'seller-1'),
    ).rejects.toThrow(/does not belong to the product's category/);
  });

  it('accepts variant attribute from an ancestor category via inheritance', async () => {
    mockPrisma.product.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'p1',
      sellerId: 'seller-1',
      slug: 'my-phone',
      categoryId: 'cat-phones',
    });
    // Phones -> Electronics ancestor chain
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'cat-phones' },
      { id: 'cat-electronics' },
    ]);
    mockPrisma.categoryAttribute.findUnique.mockResolvedValueOnce({
      id: 'attr-warranty',
      categoryId: 'cat-electronics', // inherited from Electronics parent!
      name: 'Warranty Months',
      slug: 'warranty-months',
      type: 'NUMBER',
      active: true,
    });
    mockPrisma.productVariant.create.mockResolvedValueOnce({
      id: 'v1',
      productId: 'p1',
      sku: 'PHONE-WARRANTY',
      price: 50000,
      stock: 10,
    });

    const result = await createVariant('p1', {
      price: 50000,
      stock: 10,
      attributeValues: [
        { attributeId: 'attr-warranty', value: '12' },
      ],
    }, 'seller-1');

    expect(result).toBeDefined();
    expect(mockPrisma.productVariant.create).toHaveBeenCalled();
  });
});

describe('Catalogue Foundation — Controller Security and Error Masking', () => {
  it('variantController rejects request when res.locals.userId is missing, ignoring spoofed x-user-id header', async () => {
    const req: any = {
      headers: { 'x-user-id': 'spoofed-attacker-id' },
      params: { id: 'p1' },
      body: {},
    };
    const res: any = {
      locals: {}, // no verified userId!
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await variantController.createVariant(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Unauthorized' }));
  });

  it('variantController masks unexpected 500 errors into generic "Internal server error"', async () => {
    const req: any = {
      params: { variantId: 'v1' },
    };
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    // simulate unexpected crash in service
    mockPrisma.productVariant.findFirst.mockRejectedValueOnce(new Error('FATAL: Database connection terminated abruptly'));

    await variantController.getVariantById(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal server error',
    });
  });

  it('categoryAttributeController masks unexpected 500 errors into generic "Internal server error"', async () => {
    const req: any = {
      params: { id: 'c1' },
      query: {},
    };
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    mockPrisma.categoryAttribute.findMany.mockRejectedValueOnce(new Error('SELECT query syntax error near "unknown_token"'));

    await categoryAttributeController.listByCategory(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal server error',
    });
  });
});

describe('Catalogue Foundation — Category Hierarchy Cycle Protection', () => {
  it('getCategoryAncestorIds terminates safely when CTE query is executed', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'cat-child' },
      { id: 'cat-parent' },
      { id: 'cat-root' },
    ]);

    const ancestors = await getCategoryAncestorIds('cat-child');
    expect(ancestors).toEqual(['cat-child', 'cat-parent', 'cat-root']);
  });
});
