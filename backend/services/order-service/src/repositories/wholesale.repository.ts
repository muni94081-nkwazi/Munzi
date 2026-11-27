import { WholesaleOrderModel } from '../models/wholesale.schema.js';
import type { WholesaleOrder } from '../services/wholesale.service.js';

export interface IWholesaleRepository {
  create(order: WholesaleOrder): Promise<WholesaleOrder>;
  findById(id: string): Promise<WholesaleOrder | null>;
  findByUserId(id: string, userId: string): Promise<WholesaleOrder | null>;
  listByUserId(userId: string): Promise<WholesaleOrder[]>;
  listBySellerId(sellerId: string): Promise<WholesaleOrder[]>;
  updateStatus(
    id: string,
    status: WholesaleOrder['status'],
    extra?: Partial<WholesaleOrder>,
  ): Promise<WholesaleOrder | null>;
  updateEscrowStatus(
    id: string,
    escrowStatus: NonNullable<WholesaleOrder['escrowStatus']>,
  ): Promise<WholesaleOrder | null>;
  updateStatusAtomic(
    id: string,
    allowedCurrentStatuses: WholesaleOrder['status'][],
    targetStatus: WholesaleOrder['status'],
    extra?: Partial<WholesaleOrder>,
  ): Promise<WholesaleOrder | null>;
  updateEscrowStatusAtomic(
    id: string,
    allowedCurrentStatuses: NonNullable<WholesaleOrder['escrowStatus']>[],
    targetEscrowStatus: NonNullable<WholesaleOrder['escrowStatus']>,
    extra?: Partial<WholesaleOrder>,
  ): Promise<WholesaleOrder | null>;
}

function toDomain(doc: Record<string, unknown>): WholesaleOrder {
  const { _id, ...rest } = doc;
  return { id: _id as string, ...(rest as Omit<WholesaleOrder, 'id'>) };
}

export class MongoWholesaleRepository implements IWholesaleRepository {
  async create(order: WholesaleOrder): Promise<WholesaleOrder> {
    const { id, ...rest } = order;
    const doc = await WholesaleOrderModel.create({ _id: id, ...rest });
    return toDomain(doc.toObject());
  }

  async findById(id: string): Promise<WholesaleOrder | null> {
    const doc = await WholesaleOrderModel.findById(id).lean().exec();
    return doc ? toDomain(doc as Record<string, unknown>) : null;
  }

  async findByUserId(id: string, userId: string): Promise<WholesaleOrder | null> {
    const doc = await WholesaleOrderModel.findOne({ _id: id, userId }).lean().exec();
    return doc ? toDomain(doc as Record<string, unknown>) : null;
  }

  async listByUserId(userId: string): Promise<WholesaleOrder[]> {
    const docs = await WholesaleOrderModel.find({ userId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return docs.map((d) => toDomain(d as Record<string, unknown>));
  }

  async listBySellerId(sellerId: string): Promise<WholesaleOrder[]> {
    const docs = await WholesaleOrderModel.find({ sellerId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return docs.map((d) => toDomain(d as Record<string, unknown>));
  }

  async updateStatus(
    id: string,
    status: WholesaleOrder['status'],
    extra?: Partial<WholesaleOrder>,
  ): Promise<WholesaleOrder | null> {
    const now = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      status,
      updatedAt: now,
      ...extra,
    };
    if (status === 'PAID' && !updatePayload.paidAt) updatePayload.paidAt = now;
    if (status === 'DISPATCHED' && !updatePayload.shippedAt) updatePayload.shippedAt = now;
    if (status === 'DELIVERED' && !updatePayload.deliveredAt) updatePayload.deliveredAt = now;
    if (status === 'CANCELLED' && !updatePayload.cancelledAt) updatePayload.cancelledAt = now;

    const doc = await WholesaleOrderModel.findByIdAndUpdate(
      id,
      { $set: updatePayload },
      { new: true },
    )
      .lean()
      .exec();
    return doc ? toDomain(doc as Record<string, unknown>) : null;
  }

  async updateEscrowStatus(
    id: string,
    escrowStatus: NonNullable<WholesaleOrder['escrowStatus']>,
  ): Promise<WholesaleOrder | null> {
    const doc = await WholesaleOrderModel.findByIdAndUpdate(
      id,
      { $set: { escrowStatus, updatedAt: new Date().toISOString() } },
      { new: true },
    )
      .lean()
      .exec();
    return doc ? toDomain(doc as Record<string, unknown>) : null;
  }

  async updateStatusAtomic(
    id: string,
    allowedCurrentStatuses: WholesaleOrder['status'][],
    targetStatus: WholesaleOrder['status'],
    extra?: Partial<WholesaleOrder>,
  ): Promise<WholesaleOrder | null> {
    const now = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      status: targetStatus,
      updatedAt: now,
      ...extra,
    };
    if (targetStatus === 'PAID' && !updatePayload.paidAt) updatePayload.paidAt = now;
    if (targetStatus === 'DISPATCHED' && !updatePayload.shippedAt) updatePayload.shippedAt = now;
    if (targetStatus === 'DELIVERED' && !updatePayload.deliveredAt) updatePayload.deliveredAt = now;
    if (targetStatus === 'CANCELLED' && !updatePayload.cancelledAt) updatePayload.cancelledAt = now;

    const doc = await WholesaleOrderModel.findOneAndUpdate(
      { _id: id, status: { $in: allowedCurrentStatuses } },
      { $set: updatePayload },
      { new: true },
    )
      .lean()
      .exec();
    return doc ? toDomain(doc as Record<string, unknown>) : null;
  }

  async updateEscrowStatusAtomic(
    id: string,
    allowedCurrentStatuses: NonNullable<WholesaleOrder['escrowStatus']>[],
    targetEscrowStatus: NonNullable<WholesaleOrder['escrowStatus']>,
    extra?: Partial<WholesaleOrder>,
  ): Promise<WholesaleOrder | null> {
    const now = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      escrowStatus: targetEscrowStatus,
      updatedAt: now,
      ...extra,
    };
    const doc = await WholesaleOrderModel.findOneAndUpdate(
      { _id: id, escrowStatus: { $in: allowedCurrentStatuses } },
      { $set: updatePayload },
      { new: true },
    )
      .lean()
      .exec();
    return doc ? toDomain(doc as Record<string, unknown>) : null;
  }
}

export const wholesaleRepository: IWholesaleRepository = new MongoWholesaleRepository();
