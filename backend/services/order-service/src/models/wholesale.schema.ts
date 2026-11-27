import mongoose, { Schema } from 'mongoose';

// ─── Mongoose Schema — MUNI Wholesale Order ────────────────────────────────────
//
// B2B Wholesale orders represent bulk volume purchases with dynamic pricing tiers,
// MOQ enforcement, trade assurance protection, and escrow lifecycle tracking.

const WholesaleShippingSchema = new Schema(
  {
    address:     { type: String, required: true },
    city:        { type: String, required: true },
    country:     { type: String, default: 'Uganda' },
    phone:       { type: String, required: true },
    contactName: { type: String, default: null },
  },
  { _id: false },
);

export const WholesaleOrderSchema = new Schema(
  {
    _id:                { type: String, required: true }, // domain id, e.g. "WS-..."
    orderNumber:        { type: String, required: true, unique: true },
    userId:             { type: String, required: true },
    sellerId:           { type: String, default: null },
    productId:          { type: String, required: true },
    offerId:            { type: String, default: null },
    variantId:          { type: String, default: null },
    productName:        { type: String, default: null },
    quantity:           { type: Number, required: true, min: 1 },
    moq:                { type: Number, default: 1 },
    unitPrice:          { type: Number, required: true },
    basePrice:          { type: Number, default: null },
    discountPercentage: { type: Number, required: true, default: 0 },
    totalPrice:         { type: Number, required: true },
    currency:           { type: String, default: 'UGX' },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'PAID', 'DISPATCHED', 'DELIVERED', 'CANCELLED'],
      default: 'APPROVED',
      required: true,
    },
    paymentTerms: {
      type: String,
      enum: ['FULL_UPFRONT', 'NET_30', 'NET_60', 'DEPOSIT_MILESTONE'],
      default: 'FULL_UPFRONT',
    },
    tradeAssurance: { type: Boolean, default: true },
    escrowStatus: {
      type: String,
      enum: ['pending', 'held', 'released', 'refunded', 'disputed'],
      default: 'pending',
    },
    depositAmount:      { type: Number, default: 0 },
    shippingAddress:    { type: WholesaleShippingSchema, default: null },
    placedAt:           { type: String, default: null },
    paidAt:             { type: String, default: null },
    shippedAt:          { type: String, default: null },
    deliveredAt:        { type: String, default: null },
    cancelledAt:        { type: String, default: null },
    cancellationReason: { type: String, default: null },
    createdAt:          { type: String, required: true },
    updatedAt:          { type: String, required: true },
  },
  { _id: false, versionKey: false },
);

WholesaleOrderSchema.index({ userId: 1, createdAt: -1 });
WholesaleOrderSchema.index({ sellerId: 1, createdAt: -1 });
WholesaleOrderSchema.index({ status: 1 });
WholesaleOrderSchema.index({ offerId: 1 });

export const WholesaleOrderModel = mongoose.model('WholesaleOrder', WholesaleOrderSchema);
