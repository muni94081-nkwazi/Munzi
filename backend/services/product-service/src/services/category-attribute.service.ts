import { prisma } from '../db/prisma.js';
import { z } from 'zod';
import type { AttributeType } from '../../../../shared/types/product.types.js';

// ── Validation Schemas ────────────────────────────────────────────────────────

export const AttributeTypeSchema = z.enum([
  'TEXT',
  'NUMBER',
  'ENUM',
  'BOOLEAN',
  'COLOR',
  'DATE',
]);

export const CreateCategoryAttributeSchema = z
  .object({
    name:          z.string().min(1).max(100),
    slug:          z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
    type:          AttributeTypeSchema.default('TEXT'),
    allowedValues: z.array(z.string().min(1).max(200)).max(100).optional().nullable(),
    unit:          z.string().max(50).optional().nullable(),
    isVariantAxis: z.boolean().default(false),
    isFilterable:  z.boolean().default(true),
    isRequired:    z.boolean().default(false),
    sortOrder:     z.number().int().default(0),
    active:        z.boolean().default(true),
  })
  .refine(
    (data) => {
      if (data.type === 'ENUM') {
        return Array.isArray(data.allowedValues) && data.allowedValues.length > 0;
      }
      return true;
    },
    {
      message: 'allowedValues must be a non-empty array of strings when type is ENUM',
      path:    ['allowedValues'],
    },
  );

export const UpdateCategoryAttributeSchema = z
  .object({
    name:          z.string().min(1).max(100).optional(),
    slug:          z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
    type:          AttributeTypeSchema.optional(),
    allowedValues: z.array(z.string().min(1).max(200)).max(100).optional().nullable(),
    unit:          z.string().max(50).optional().nullable(),
    isVariantAxis: z.boolean().optional(),
    isFilterable:  z.boolean().optional(),
    isRequired:    z.boolean().optional(),
    sortOrder:     z.number().int().optional(),
    active:        z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.type === 'ENUM' && data.allowedValues !== undefined) {
        return Array.isArray(data.allowedValues) && data.allowedValues.length > 0;
      }
      return true;
    },
    {
      message: 'allowedValues must be a non-empty array of strings when type is ENUM',
      path:    ['allowedValues'],
    },
  );

export type CreateCategoryAttributeInput = z.input<typeof CreateCategoryAttributeSchema>;
export type UpdateCategoryAttributeInput = z.input<typeof UpdateCategoryAttributeSchema>;

// ── Value Validation Helper ───────────────────────────────────────────────────

export interface CategoryAttributeRecord {
  id:            string;
  categoryId:    string;
  name:          string;
  slug:          string;
  type:          AttributeType | string;
  allowedValues: unknown;
  unit?:         string | null;
  isVariantAxis: boolean;
  isFilterable:  boolean;
  isRequired:    boolean;
  sortOrder:     number;
  active:        boolean;
}

/**
 * Validates a given raw string value against a CategoryAttribute's definition and type.
 */
export function validateAttributeValue(
  attribute: CategoryAttributeRecord,
  value: string,
): { valid: boolean; error?: string } {
  if (value === undefined || value === null || typeof value !== 'string') {
    return { valid: false, error: `Attribute "${attribute.name}" requires a non-null string value.` };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (attribute.isRequired) {
      return { valid: false, error: `Attribute "${attribute.name}" is required and cannot be empty.` };
    }
    return { valid: true };
  }

  switch (attribute.type) {
    case 'NUMBER': {
      const num = Number(trimmed);
      if (isNaN(num) || !isFinite(num)) {
        return { valid: false, error: `Attribute "${attribute.name}" must be a valid number, received: "${value}".` };
      }
      return { valid: true };
    }

    case 'BOOLEAN': {
      const lower = trimmed.toLowerCase();
      if (lower !== 'true' && lower !== 'false' && lower !== '1' && lower !== '0') {
        return { valid: false, error: `Attribute "${attribute.name}" must be a boolean ('true' or 'false').` };
      }
      return { valid: true };
    }

    case 'ENUM': {
      const allowed = Array.isArray(attribute.allowedValues) ? (attribute.allowedValues as string[]) : [];
      if (!allowed.includes(trimmed)) {
        return {
          valid: false,
          error: `Attribute "${attribute.name}" value "${value}" is invalid. Allowed values: ${allowed.join(', ')}.`,
        };
      }
      return { valid: true };
    }

    case 'DATE': {
      const timestamp = Date.parse(trimmed);
      if (isNaN(timestamp)) {
        return { valid: false, error: `Attribute "${attribute.name}" must be a valid ISO date string.` };
      }
      return { valid: true };
    }

    case 'COLOR': {
      // Color can be hex #RGB, #RRGGBB, or a standard color name
      if (trimmed.length > 50) {
        return { valid: false, error: `Attribute "${attribute.name}" color value is too long (max 50 chars).` };
      }
      return { valid: true };
    }

    case 'TEXT':
    default: {
      if (trimmed.length > 1000) {
        return { valid: false, error: `Attribute "${attribute.name}" exceeds maximum length of 1000 characters.` };
      }
      return { valid: true };
    }
  }
}

// ── Service Methods ───────────────────────────────────────────────────────────

/**
 * Fetch ancestor category IDs for a category, bounded by safe depth to prevent infinite cycles.
 */
export async function getCategoryAncestorIds(categoryId: string): Promise<string[]> {
  try {
    if (typeof (prisma as any).$queryRaw === 'function') {
      const ancestors = await prisma.$queryRaw<Array<{ id: string }>>`
        WITH RECURSIVE ancestors AS (
          SELECT id, "parentId", 0 AS depth, ARRAY[id]::text[] AS visited
          FROM "Category" WHERE id = ${categoryId}
          UNION ALL
          SELECT c.id, c."parentId", a.depth + 1, a.visited || c.id
          FROM "Category" c JOIN ancestors a ON c.id = a."parentId"
          WHERE NOT (c.id = ANY(a.visited)) AND a.depth < 20
        )
        SELECT id FROM ancestors;
      `;
      if (Array.isArray(ancestors) && ancestors.length > 0) {
        return ancestors.map((a) => a.id);
      }
    }
  } catch {
    // fallback for environments where $queryRaw is mocked without CTE support
  }
  return [categoryId];
}

/**
 * Fetch attributes for a category, optionally including attributes inherited from parent categories.
 */
export async function getCategoryAttributes(categoryId: string, includeInherited = true) {
  let categoryIds = [categoryId];

  if (includeInherited) {
    categoryIds = await getCategoryAncestorIds(categoryId);
  }

  return prisma.categoryAttribute.findMany({
    where: {
      categoryId: { in: categoryIds },
      active:     true,
    },
    orderBy: [
      { sortOrder: 'asc' },
      { name: 'asc' },
    ],
  });
}

/**
 * Get a single category attribute by its ID.
 */
export async function getCategoryAttributeById(attributeId: string) {
  return prisma.categoryAttribute.findUnique({
    where: { id: attributeId },
  });
}

/**
 * Create a new category attribute definition under a category.
 */
export async function createCategoryAttribute(categoryId: string, input: CreateCategoryAttributeInput) {
  // Confirm category exists
  await prisma.category.findUniqueOrThrow({
    where: { id: categoryId },
  });

  const validated = CreateCategoryAttributeSchema.parse(input);

  // Check slug uniqueness within category
  const existing = await prisma.categoryAttribute.findUnique({
    where: {
      categoryId_slug: {
        categoryId,
        slug: validated.slug,
      },
    },
  });

  if (existing) {
    throw Object.assign(
      new Error(`An attribute with slug "${validated.slug}" already exists in this category.`),
      { status: 409 },
    );
  }

  return prisma.categoryAttribute.create({
    data: {
      categoryId,
      name:          validated.name,
      slug:          validated.slug,
      type:          validated.type,
      allowedValues: validated.allowedValues ?? undefined,
      unit:          validated.unit ?? null,
      isVariantAxis: validated.isVariantAxis,
      isFilterable:  validated.isFilterable,
      isRequired:    validated.isRequired,
      sortOrder:     validated.sortOrder,
      active:        validated.active,
    },
  });
}

/**
 * Update an existing category attribute definition.
 */
export async function updateCategoryAttribute(
  categoryId: string,
  attributeId: string,
  input: UpdateCategoryAttributeInput,
) {
  const existing = await prisma.categoryAttribute.findUniqueOrThrow({
    where: { id: attributeId },
  });

  if (existing.categoryId !== categoryId) {
    throw Object.assign(new Error('Attribute does not belong to the specified category'), { status: 404 });
  }

  const validated = UpdateCategoryAttributeSchema.parse(input);

  if (validated.slug && validated.slug !== existing.slug) {
    const conflict = await prisma.categoryAttribute.findUnique({
      where: {
        categoryId_slug: {
          categoryId,
          slug: validated.slug,
        },
      },
    });
    if (conflict) {
      throw Object.assign(
        new Error(`An attribute with slug "${validated.slug}" already exists in this category.`),
        { status: 409 },
      );
    }
  }

  return prisma.categoryAttribute.update({
    where: { id: attributeId },
    data:  {
      ...validated,
      allowedValues: validated.allowedValues !== undefined ? (validated.allowedValues ?? undefined) : undefined,
    },
  });
}

/**
 * Soft delete or remove an attribute definition.
 */
export async function deleteCategoryAttribute(categoryId: string, attributeId: string) {
  const existing = await prisma.categoryAttribute.findUniqueOrThrow({
    where: { id: attributeId },
  });

  if (existing.categoryId !== categoryId) {
    throw Object.assign(new Error('Attribute does not belong to the specified category'), { status: 404 });
  }

  // Soft delete by marking active = false
  return prisma.categoryAttribute.update({
    where: { id: attributeId },
    data:  { active: false },
  });
}
