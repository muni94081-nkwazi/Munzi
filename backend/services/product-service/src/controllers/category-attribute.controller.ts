import type { Request, Response } from 'express';
import * as attributeService from '../services/category-attribute.service.js';

function fail(res: Response, error: any): void {
  if (error.name === 'ZodError') {
    res.status(422).json({ success: false, message: 'Validation failed', issues: error.issues });
    return;
  }
  if (error.code === 'P2025') {
    res.status(404).json({ success: false, message: 'Not found' });
    return;
  }
  const status = typeof error.status === 'number' ? error.status : 500;
  res.status(status).json({
    success: false,
    message: status >= 500 ? 'Internal server error' : error.message,
  });
  if (status >= 500) console.error('[product-service] CategoryAttribute error:', error);
}

export async function listByCategory(req: Request, res: Response) {
  try {
    const categoryId = req.params.id;
    const includeInherited = req.query.includeInherited !== 'false';
    const attributes = await attributeService.getCategoryAttributes(categoryId, includeInherited);
    res.status(200).json({ success: true, data: attributes });
  } catch (error: any) {
    fail(res, error);
  }
}

export async function create(req: Request, res: Response) {
  try {
    const categoryId = req.params.id;
    const attribute = await attributeService.createCategoryAttribute(categoryId, req.body);
    res.status(201).json({ success: true, data: attribute });
  } catch (error: any) {
    fail(res, error);
  }
}

export async function update(req: Request, res: Response) {
  try {
    const { id: categoryId, attrId } = req.params;
    const attribute = await attributeService.updateCategoryAttribute(categoryId, attrId, req.body);
    res.status(200).json({ success: true, data: attribute });
  } catch (error: any) {
    fail(res, error);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    const { id: categoryId, attrId } = req.params;
    const attribute = await attributeService.deleteCategoryAttribute(categoryId, attrId);
    res.status(200).json({ success: true, data: attribute });
  } catch (error: any) {
    fail(res, error);
  }
}
