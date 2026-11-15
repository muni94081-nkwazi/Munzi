import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ── Mock Prisma ───────────────────────────────────────────────────────────────
const mockPrisma = {
  category: {
    findUniqueOrThrow: jest.fn<(...args: any[]) => any>(),
  },
  categoryAttribute: {
    findMany:   jest.fn<(...args: any[]) => any>(),
    findUnique: jest.fn<(...args: any[]) => any>(),
    findUniqueOrThrow: jest.fn<(...args: any[]) => any>(),
    create:     jest.fn<(...args: any[]) => any>(),
    update:     jest.fn<(...args: any[]) => any>(),
  },
  $queryRaw: jest.fn<(...args: any[]) => any>(),
};

jest.unstable_mockModule('../db/prisma.js', () => ({ prisma: mockPrisma }));

const {
  getCategoryAttributes,
  createCategoryAttribute,
  updateCategoryAttribute,
  deleteCategoryAttribute,
} = await import('../services/category-attribute.service.js');

describe('Category Attributes Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCategoryAttributes', () => {
    it('resolves ancestors via CTE when includeInherited=true', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { id: 'cat-phones' },
        { id: 'cat-electronics' },
      ]);

      mockPrisma.categoryAttribute.findMany.mockResolvedValueOnce([
        { id: 'attr-1', categoryId: 'cat-electronics', name: 'Brand', slug: 'brand', type: 'TEXT', sortOrder: 0, active: true },
        { id: 'attr-2', categoryId: 'cat-phones', name: 'Screen Size', slug: 'screen-size', type: 'NUMBER', unit: 'inches', sortOrder: 1, active: true },
      ]);

      const attributes = await getCategoryAttributes('cat-phones', true);

      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(mockPrisma.categoryAttribute.findMany).toHaveBeenCalledWith({
        where: {
          categoryId: { in: ['cat-phones', 'cat-electronics'] },
          active:     true,
        },
        orderBy: [
          { sortOrder: 'asc' },
          { name: 'asc' },
        ],
      });
      expect(attributes).toHaveLength(2);
    });

    it('queries only target category when includeInherited=false', async () => {
      mockPrisma.categoryAttribute.findMany.mockResolvedValueOnce([
        { id: 'attr-2', categoryId: 'cat-phones', name: 'Screen Size', slug: 'screen-size', type: 'NUMBER', sortOrder: 1, active: true },
      ]);

      const attributes = await getCategoryAttributes('cat-phones', false);

      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
      expect(mockPrisma.categoryAttribute.findMany).toHaveBeenCalledWith({
        where: {
          categoryId: { in: ['cat-phones'] },
          active:     true,
        },
        orderBy: [
          { sortOrder: 'asc' },
          { name: 'asc' },
        ],
      });
      expect(attributes).toHaveLength(1);
    });
  });

  describe('createCategoryAttribute', () => {
    it('creates an attribute when category exists and slug is unique', async () => {
      mockPrisma.category.findUniqueOrThrow.mockResolvedValueOnce({ id: 'cat-1', name: 'Phones' });
      mockPrisma.categoryAttribute.findUnique.mockResolvedValueOnce(null); // no conflict
      mockPrisma.categoryAttribute.create.mockImplementation(async ({ data }: any) => ({
        id: 'attr-new',
        ...data,
      }));

      const created = await createCategoryAttribute('cat-1', {
        name:          'Storage Capacity',
        slug:          'storage-capacity',
        type:          'ENUM',
        allowedValues: ['64GB', '128GB', '256GB'],
        isVariantAxis: true,
      });

      expect(mockPrisma.categoryAttribute.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            categoryId:    'cat-1',
            name:          'Storage Capacity',
            slug:          'storage-capacity',
            type:          'ENUM',
            allowedValues: ['64GB', '128GB', '256GB'],
            isVariantAxis: true,
          }),
        }),
      );
      expect(created.id).toBe('attr-new');
    });

    it('rejects duplicate slug within the same category with 409', async () => {
      mockPrisma.category.findUniqueOrThrow.mockResolvedValueOnce({ id: 'cat-1', name: 'Phones' });
      mockPrisma.categoryAttribute.findUnique.mockResolvedValueOnce({ id: 'attr-existing', slug: 'storage' });

      await expect(
        createCategoryAttribute('cat-1', {
          name: 'Storage',
          slug: 'storage',
          type: 'TEXT',
        }),
      ).rejects.toThrow(/already exists in this category/);
    });

    it('rejects ENUM type without allowedValues with validation error', async () => {
      mockPrisma.category.findUniqueOrThrow.mockResolvedValueOnce({ id: 'cat-1', name: 'Phones' });

      await expect(
        createCategoryAttribute('cat-1', {
          name: 'Color',
          slug: 'color',
          type: 'ENUM',
          // allowedValues omitted
        }),
      ).rejects.toThrow();
    });
  });

  describe('updateCategoryAttribute', () => {
    it('updates definition when attribute belongs to category', async () => {
      mockPrisma.categoryAttribute.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'attr-1',
        categoryId: 'cat-1',
        slug: 'screen-size',
      });
      mockPrisma.categoryAttribute.update.mockResolvedValueOnce({
        id: 'attr-1',
        name: 'Display Size',
        unit: 'inches',
      });

      const updated = await updateCategoryAttribute('cat-1', 'attr-1', {
        name: 'Display Size',
        unit: 'inches',
      });

      expect(mockPrisma.categoryAttribute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'attr-1' },
          data:  expect.objectContaining({ name: 'Display Size', unit: 'inches' }),
        }),
      );
      expect(updated.name).toBe('Display Size');
    });

    it('rejects update if attribute belongs to a different category', async () => {
      mockPrisma.categoryAttribute.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'attr-1',
        categoryId: 'cat-other',
      });

      await expect(
        updateCategoryAttribute('cat-1', 'attr-1', { name: 'New Name' }),
      ).rejects.toThrow(/does not belong to the specified category/);
    });
  });

  describe('deleteCategoryAttribute', () => {
    it('soft deletes attribute by setting active=false', async () => {
      mockPrisma.categoryAttribute.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'attr-1',
        categoryId: 'cat-1',
      });
      mockPrisma.categoryAttribute.update.mockResolvedValueOnce({
        id: 'attr-1',
        active: false,
      });

      const result = await deleteCategoryAttribute('cat-1', 'attr-1');
      expect(mockPrisma.categoryAttribute.update).toHaveBeenCalledWith({
        where: { id: 'attr-1' },
        data:  { active: false },
      });
      expect(result.active).toBe(false);
    });
  });
});
