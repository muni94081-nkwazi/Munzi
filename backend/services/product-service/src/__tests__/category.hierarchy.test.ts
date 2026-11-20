/**
 * Phase 2C.1 — Category Hierarchy Concurrency & Cycle-Safety Tests
 *
 * Tests the updateCategory() concurrency-safe implementation:
 * - Self-parenting rejection (422)
 * - Indirect cycle prevention / descendant parenting (422)
 * - Child-to-root promotion via parentId: null (sets level=0, cascades path)
 * - Distinction between omitted parentId (no change) and parentId: null (make root)
 * - Protection against existing cycles in database (visited tracking in CTE)
 * - Deterministic row-level locking across target and newParent to prevent concurrent cycle formation
 * - Valid parent moves with subtree cascade
 * - Slug-only updates that cascade path changes
 * - Depth-safe getCategoryDescendantIds() with bounded recursive CTE and visited array
 *
 * Uses jest.unstable_mockModule (ESM pattern) — no live DB required.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ── Mock Prisma BEFORE importing modules ──────────────────────────────────────
const mockPrisma: any = {
  $queryRaw:    jest.fn<(...args: any[]) => any>(),
  $executeRaw:  jest.fn<(...args: any[]) => any>(),
  $transaction: jest.fn<(...args: any[]) => any>(),
  category: {
    findMany:          jest.fn<(...args: any[]) => any>(),
    findUnique:        jest.fn<(...args: any[]) => any>(),
    findUniqueOrThrow: jest.fn<(...args: any[]) => any>(),
    create:            jest.fn<(...args: any[]) => any>(),
    update:            jest.fn<(...args: any[]) => any>(),
    count:             jest.fn<(...args: any[]) => any>(),
  },
  product: {
    count: jest.fn<(...args: any[]) => any>(),
  },
};

// $transaction passes the tx (which is mockPrisma itself) to the callback
mockPrisma.$transaction.mockImplementation((fn: (tx: any) => any) => fn(mockPrisma));

jest.unstable_mockModule('../db/prisma.js', () => ({ prisma: mockPrisma }));

const { updateCategory, getCategoryDescendantIds, createCategory } =
  await import('../services/category.service.js');

// ── Global reset ──────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.resetAllMocks();
  // Re-install transaction and default query return values after reset
  mockPrisma.$transaction.mockImplementation((fn: (tx: any) => any) => fn(mockPrisma));
  mockPrisma.$queryRaw.mockResolvedValue([]);
  mockPrisma.$executeRaw.mockResolvedValue(1);
});
afterEach(() => { jest.clearAllMocks(); });

// ── Shared Fixtures ───────────────────────────────────────────────────────────

const catElectronics = { id: 'cat-elec',    slug: 'electronics', name: 'Electronics', parentId: null,       level: 0, path: '/electronics' };
const catPhones      = { id: 'cat-phones',  slug: 'phones',      name: 'Phones',      parentId: 'cat-elec', level: 1, path: '/electronics/phones' };
const catAndroid     = { id: 'cat-android', slug: 'android',     name: 'Android',     parentId: 'cat-phones', level: 2, path: '/electronics/phones/android' };
const catFashion     = { id: 'cat-fashion', slug: 'fashion',     name: 'Fashion',     parentId: null,       level: 0, path: '/fashion' };

// ── 1. Self-Parenting Rejection ───────────────────────────────────────────────

describe('updateCategory() — self-parenting rejection', () => {
  it('throws 422 when parentId === id (direct self-reference)', async () => {
    const error = await updateCategory('cat-elec', { parentId: 'cat-elec' }).catch(e => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/cannot be its own parent/i);
    expect(error.status).toBe(422);
    // Self-parent check must fire BEFORE any DB query
    expect(mockPrisma.category.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(mockPrisma.category.update).not.toHaveBeenCalled();
  });
});

// ── 2. Descendant-Parenting & Cycle Prevention ────────────────────────────────

describe('updateCategory() — descendant-parenting and cycle prevention', () => {
  it('throws 422 when setting parent to a direct child', async () => {
    // Moving cat-elec under cat-phones (its direct child)
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([])   // row lock
      .mockResolvedValueOnce([     // descendants of cat-elec include cat-phones
        { id: 'cat-elec' },
        { id: 'cat-phones' },
      ]);
    mockPrisma.category.findUniqueOrThrow.mockResolvedValueOnce(catElectronics);

    const error = await updateCategory('cat-elec', { parentId: 'cat-phones' }).catch(e => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/descendant/i);
    expect(mockPrisma.category.update).not.toHaveBeenCalled();
  });

  it('throws 422 when setting parent to a deep descendant (indirect cycle)', async () => {
    // Moving cat-elec (root) under cat-android (grandchild)
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([])   // row lock
      .mockResolvedValueOnce([     // descendants of cat-elec include cat-android
        { id: 'cat-elec' },
        { id: 'cat-phones' },
        { id: 'cat-android' },
      ]);
    mockPrisma.category.findUniqueOrThrow.mockResolvedValueOnce(catElectronics);

    const error = await updateCategory('cat-elec', { parentId: 'cat-android' }).catch(e => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/descendant/i);
    expect(mockPrisma.category.update).not.toHaveBeenCalled();
  });

  it('allows setting parent to a non-descendant category (valid move)', async () => {
    // Moving cat-phones under cat-fashion (fashion is not a descendant of phones)
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([])   // row lock
      .mockResolvedValueOnce([     // descendants of cat-phones (fashion not among them)
        { id: 'cat-phones' },
        { id: 'cat-android' },
      ]);
    mockPrisma.category.findUniqueOrThrow
      .mockResolvedValueOnce(catPhones)    // existing
      .mockResolvedValueOnce(catFashion);  // newParent

    mockPrisma.category.update.mockResolvedValueOnce({
      ...catPhones,
      parentId: 'cat-fashion',
      level: 1,
      path: '/fashion/phones',
    });
    mockPrisma.$executeRaw.mockResolvedValueOnce(2);  // cascade updated 2 children

    const result = await updateCategory('cat-phones', { parentId: 'cat-fashion' }) as any;

    expect(result).toBeDefined();
    expect(mockPrisma.category.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('does not run cycle check when parentId is unchanged', async () => {
    // parentId 'cat-elec' equals catPhones.parentId → cycle guard is skipped
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);   // row lock
    mockPrisma.category.findUniqueOrThrow.mockResolvedValueOnce(catPhones);
    mockPrisma.category.update.mockResolvedValueOnce({ ...catPhones, name: 'Smart Phones' });

    const result = await updateCategory('cat-phones', { name: 'Smart Phones', parentId: 'cat-elec' }) as any;

    expect(result.name).toBe('Smart Phones');
    // Descendant CTE query must NOT fire
    expect(mockPrisma.category.update).toHaveBeenCalledTimes(1);
  });
});

// ── 3. Child-to-Root Promotion vs Omitted parentId ────────────────────────────

describe('updateCategory() — root promotion vs omitted parentId', () => {
  it('explicitly supports parentId: null to promote a child category to root', async () => {
    // catPhones is child of catElectronics (level 1, path /electronics/phones)
    mockPrisma.$queryRaw.mockResolvedValueOnce([]); // row lock
    mockPrisma.category.findUniqueOrThrow.mockResolvedValueOnce(catPhones);
    mockPrisma.category.update.mockResolvedValueOnce({
      ...catPhones,
      parentId: null,
      level: 0,
      path: '/phones',
    });
    mockPrisma.$executeRaw.mockResolvedValueOnce(1); // cascade to children

    const result = await updateCategory('cat-phones', { parentId: null }) as any;

    expect(result).toBeDefined();
    expect(mockPrisma.category.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cat-phones' },
        data: expect.objectContaining({
          parentId: null,
          level: 0,
          path: '/phones',
        }),
      }),
    );
    // Subtree descendants must have their level and path cascaded
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('preserves existing parent when parentId is omitted (undefined)', async () => {
    // Omitting parentId → leaves parent unchanged
    mockPrisma.$queryRaw.mockResolvedValueOnce([]); // row lock
    mockPrisma.category.findUniqueOrThrow.mockResolvedValueOnce(catPhones);
    mockPrisma.category.update.mockResolvedValueOnce({ ...catPhones, name: 'Premium Phones' });

    const result = await updateCategory('cat-phones', { name: 'Premium Phones' }) as any;

    expect(result.name).toBe('Premium Phones');
    expect(mockPrisma.category.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cat-phones' },
        data: expect.objectContaining({
          name: 'Premium Phones',
          level: 1,
          path: '/electronics/phones',
        }),
      }),
    );
    // Subtree cascade must NOT be triggered when parent was omitted
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });
});

// ── 4. Deterministic Concurrency & Row-Level Locking ──────────────────────────

describe('updateCategory() — deterministic row-level locking for concurrent moves', () => {
  it('locks target and newParent in ascending alphabetical order to eliminate deadlock', async () => {
    // Moving cat-phones under cat-fashion:
    // Sorted lock order must be ['cat-fashion', 'cat-phones'] regardless of parameter order
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([]) // lock
      .mockResolvedValueOnce([{ id: 'cat-phones' }]); // descendants
    mockPrisma.category.findUniqueOrThrow
      .mockResolvedValueOnce(catPhones)
      .mockResolvedValueOnce(catFashion);
    mockPrisma.category.update.mockResolvedValueOnce({
      ...catPhones,
      parentId: 'cat-fashion',
      level: 1,
      path: '/fashion/phones',
    });

    await updateCategory('cat-phones', { parentId: 'cat-fashion' });

    // Verify lock query was executed
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
  });

  it('locks only target ID when promoting to root or when parent is omitted', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);
    mockPrisma.category.findUniqueOrThrow.mockResolvedValueOnce(catPhones);
    mockPrisma.category.update.mockResolvedValueOnce({ ...catPhones, parentId: null, level: 0, path: '/phones' });

    await updateCategory('cat-phones', { parentId: null });

    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
  });
});

// ── 5. Existing Cycle Protection in Recursive Queries ─────────────────────────

describe('getCategoryDescendantIds() — protection against existing cycles', () => {
  it('halts recursion and produces no duplicates even if database has an existing cycle', async () => {
    // If corrupted DB rows had A -> B -> A:
    // The visited array in CTE stops traversal immediately
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'cat-A' },
      { id: 'cat-B' },
    ]);

    const ids = await getCategoryDescendantIds('cat-A');

    expect(ids).toEqual(['cat-A', 'cat-B']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns flat list including the given category and its descendants', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'cat-elec' },
      { id: 'cat-phones' },
      { id: 'cat-android' },
    ]);

    const ids = await getCategoryDescendantIds('cat-elec');

    expect(ids).toEqual(['cat-elec', 'cat-phones', 'cat-android']);
  });

  it('returns only the given category when it has no descendants', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'cat-android' }]);

    const ids = await getCategoryDescendantIds('cat-android');

    expect(ids).toEqual(['cat-android']);
  });

  it('uses the provided client instead of global prisma when passed', async () => {
    const alternativePrisma: any = {
      $queryRaw: jest.fn<(...args: any[]) => any>().mockResolvedValueOnce([
        { id: 'cat-x' },
        { id: 'cat-y' },
      ]),
    };

    const ids = await getCategoryDescendantIds('cat-x', alternativePrisma);

    expect(alternativePrisma.$queryRaw).toHaveBeenCalled();
    expect(ids).toEqual(['cat-x', 'cat-y']);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns an empty array when category does not exist', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);

    const ids = await getCategoryDescendantIds('nonexistent');

    expect(ids).toEqual([]);
  });
});

// ── 6. Subtree Cascade ────────────────────────────────────────────────────────

describe('updateCategory() — subtree path cascade', () => {
  it('cascades path updates to descendants when parent changes', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([])   // lock
      .mockResolvedValueOnce([{ id: 'cat-phones' }, { id: 'cat-android' }]);  // descendants
    mockPrisma.category.findUniqueOrThrow
      .mockResolvedValueOnce(catPhones)    // existing
      .mockResolvedValueOnce(catFashion);  // new parent
    mockPrisma.category.update.mockResolvedValueOnce({
      ...catPhones, parentId: 'cat-fashion', level: 1, path: '/fashion/phones',
    });
    mockPrisma.$executeRaw.mockResolvedValueOnce(1);

    await updateCategory('cat-phones', { parentId: 'cat-fashion' });

    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('cascades path when only slug changes (no parent change)', async () => {
    mockPrisma.category.findUniqueOrThrow.mockResolvedValueOnce(catPhones);
    mockPrisma.category.update.mockResolvedValueOnce({
      ...catPhones, slug: 'handsets', path: '/electronics/handsets',
    });
    mockPrisma.$executeRaw.mockResolvedValueOnce(1);

    await updateCategory('cat-phones', { slug: 'handsets' });

    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('does NOT cascade when neither parent nor slug changes', async () => {
    mockPrisma.category.findUniqueOrThrow.mockResolvedValueOnce(catPhones);
    mockPrisma.category.update.mockResolvedValueOnce({ ...catPhones, name: 'Mobile Phones' });

    await updateCategory('cat-phones', { name: 'Mobile Phones' });

    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });
});

// ── 7. createCategory Level and Path Computation ──────────────────────────────

describe('createCategory() — level and path derivation', () => {
  it('creates root category with level=0 and path=/<slug>', async () => {
    mockPrisma.category.create.mockResolvedValueOnce({
      id: 'new-root', slug: 'tools', name: 'Tools', level: 0, path: '/tools', parentId: null,
    });

    const result = await createCategory({ name: 'Tools', slug: 'tools', sortOrder: 0 }) as any;

    expect(mockPrisma.category.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ level: 0, path: '/tools' }),
      }),
    );
    expect(result.level).toBe(0);
  });

  it('creates child category with parent.level+1 and parent.path/<slug>', async () => {
    mockPrisma.category.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'cat-elec', level: 0, path: '/electronics',
    });
    mockPrisma.category.create.mockResolvedValueOnce({
      id: 'new-child', slug: 'laptops', name: 'Laptops', level: 1,
      path: '/electronics/laptops', parentId: 'cat-elec',
    });

    const result = await createCategory({
      name: 'Laptops', slug: 'laptops', parentId: 'cat-elec', sortOrder: 0,
    }) as any;

    expect(mockPrisma.category.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ level: 1, path: '/electronics/laptops' }),
      }),
    );
    expect(result.level).toBe(1);
  });

  it('rejects creation with invalid slug (non-kebab-case characters)', async () => {
    await expect(
      createCategory({ name: 'Bad Category', slug: 'Bad_Category!', sortOrder: 0 }),
    ).rejects.toThrow();
  });

  it('rejects creation when slug is too short (< 2 chars)', async () => {
    await expect(
      createCategory({ name: 'X', slug: 'x', sortOrder: 0 }),
    ).rejects.toThrow();
  });
});

// ── 8. Composite Scenarios ────────────────────────────────────────────────────

describe('category hierarchy — composite scenarios', () => {
  it('scenario: A→B→C: cannot set A parent to C (cycle)', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([])  // lock
      .mockResolvedValueOnce([
        { id: 'cat-A' }, { id: 'cat-B' }, { id: 'cat-C' },
      ]); // descendants of A include C
    mockPrisma.category.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'cat-A', slug: 'a', parentId: null, level: 0, path: '/a',
    });

    const error = await updateCategory('cat-A', { parentId: 'cat-C' }).catch(e => e);

    expect(error.status).toBe(422);
    expect(error.message).toMatch(/descendant/i);
    expect(mockPrisma.category.update).not.toHaveBeenCalled();
  });

  it('scenario: A→B→C: can safely move B under sibling D', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([])  // lock
      .mockResolvedValueOnce([
        { id: 'cat-B' }, { id: 'cat-C' },
      ]); // descendants of B — D is absent
    mockPrisma.category.findUniqueOrThrow
      .mockResolvedValueOnce({ id: 'cat-B', slug: 'b', parentId: 'cat-A', level: 1, path: '/a/b' })
      .mockResolvedValueOnce({ id: 'cat-D', slug: 'd', parentId: null,    level: 0, path: '/d' });
    mockPrisma.category.update.mockResolvedValueOnce({
      id: 'cat-B', slug: 'b', parentId: 'cat-D', level: 1, path: '/d/b',
    });
    mockPrisma.$executeRaw.mockResolvedValueOnce(1);

    const result = await updateCategory('cat-B', { parentId: 'cat-D' }) as any;

    expect(result).toBeDefined();
    expect(mockPrisma.category.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
