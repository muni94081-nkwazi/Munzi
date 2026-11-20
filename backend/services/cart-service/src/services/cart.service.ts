import { v4 as uuidv4 } from 'uuid';
import { redis } from '../utils/redis.js';
import { Cart, CartItem } from '../models/cart.model.js';
import { quoteCoupon } from '../clients/discount.client.js';
import { availableStockFor, fetchOfferDetails } from '../clients/catalog.client.js';
import dotenv from 'dotenv';

dotenv.config();

const CART_TTL = parseInt(process.env.CART_TTL_SECONDS || '86400', 10);

/**
 * A quantity above what the line permits.
 */
export class CartQuantityError extends Error {
  readonly status = 422;
  constructor(readonly requested: number, readonly maxQuantity: number) {
    super(`Only ${maxQuantity} of this item can be added — you asked for ${requested}.`);
    this.name = 'CartQuantityError';
  }
}

export class CartMoqError extends Error {
  readonly status = 422;
  constructor(readonly requested: number, readonly moq: number) {
    super(`Minimum order quantity is ${moq} — you asked for ${requested}.`);
    this.name = 'CartMoqError';
  }
}

export class CartOfferInactiveError extends Error {
  readonly status = 422;
  constructor(readonly offerId: string, message = `Offer ${offerId} is no longer active.`) {
    super(message);
    this.name = 'CartOfferInactiveError';
  }
}

export class CartOfferNotFoundError extends Error {
  readonly status = 404;
  constructor(readonly offerId: string) {
    super(`Offer ${offerId} was not found.`);
    this.name = 'CartOfferNotFoundError';
  }
}

/**
 * The most of one variant a basket may hold, given what the catalogue has.
 */
async function permittedQuantity(
  productId: string,
  variantId: string | undefined,
  clientMax: number,
): Promise<number> {
  if (!variantId) return clientMax;
  const available = await availableStockFor(productId, variantId);
  return available === null ? clientMax : available;
}

function createEmptyCart(userId: string): Cart {
  return {
    userId,
    items: [],
    couponDiscount: 0,
    subtotal: 0,
    itemCount: 0,
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + CART_TTL * 1000).toISOString(),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Re-derive the cart's totals, including what its coupon is worth.
 *
 * Asynchronous because the coupon figure now comes from discount-service. It
 * used to be a flat 10% of the subtotal for any code at all, so a customer
 * saw a discount that no service had agreed to and that checkout would not
 * honour.
 *
 * A code that discount-service REJECTS is removed from the cart: leaving it in
 * place would show a coupon worth nothing with no explanation. A code it could
 * not be asked about is kept, because the network is not a verdict on the code
 * — the estimate is simply 0 until the service answers again, and checkout
 * asks once more before charging.
 */
async function recalculateCart(cart: Cart): Promise<Cart> {
  cart.subtotal = round2(cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  cart.itemCount = cart.items.reduce((count, item) => count + item.quantity, 0);

  if (!cart.couponCode || cart.items.length === 0) {
    // An empty basket is not worth a round trip, and a coupon on one should
    // survive until the customer has something to spend it on.
    cart.couponDiscount = 0;
    if (!cart.couponCode) delete cart.couponMessage;
  } else {
    const quote = await quoteCoupon(cart.couponCode, cart.userId, cart.items, cart.subtotal);

    if (quote.outcome === 'applied') {
      // Clamped so a coupon can never make the basket worth less than nothing.
      cart.couponDiscount = round2(Math.min(quote.amount, cart.subtotal));
      delete cart.couponMessage;
    } else if (quote.outcome === 'rejected') {
      delete cart.couponCode;
      cart.couponDiscount = 0;
      cart.couponMessage = quote.reason;
    } else {
      cart.couponDiscount = 0;
      cart.couponMessage = 'We could not check this code just now — it will be applied at checkout if it is still valid.';
    }
  }

  cart.updatedAt = new Date().toISOString();
  cart.expiresAt = new Date(Date.now() + CART_TTL * 1000).toISOString();
  return cart;
}

export class CartService {
  private getCartKey(userId: string): string {
    return `cart:${userId}`;
  }

  async getCart(userId: string): Promise<Cart> {
    const key = this.getCartKey(userId);
    const cartStr = await redis.get(key);
    if (!cartStr) {
      return createEmptyCart(userId);
    }
    return JSON.parse(cartStr) as Cart;
  }

  async saveCart(cart: Cart): Promise<void> {
    const key = this.getCartKey(cart.userId);
    await redis.set(key, JSON.stringify(cart), 'EX', CART_TTL);
  }

  async addItem(userId: string, itemData: Omit<CartItem, 'id' | 'addedAt'>): Promise<Cart> {
    const cart = await this.getCart(userId);

    let finalItemData = { ...itemData };

    if (itemData.offerId) {
      const offer = await fetchOfferDetails(itemData.offerId);
      if (!offer) {
        throw new CartOfferNotFoundError(itemData.offerId);
      }
      if (offer.status !== 'ACTIVE') {
        throw new CartOfferInactiveError(itemData.offerId, `Offer ${itemData.offerId} is not active.`);
      }
      if (offer.product && offer.product.status !== 'ACTIVE') {
        throw new CartOfferInactiveError(itemData.offerId, `Product for offer ${itemData.offerId} is not active.`);
      }

      const existingItem = cart.items.find((i) => i.offerId === itemData.offerId);
      const requested = (existingItem?.quantity ?? 0) + itemData.quantity;

      const moq = offer.moq ?? 1;
      if (requested < moq) {
        throw new CartMoqError(requested, moq);
      }

      if (requested > offer.availableStock) {
        throw new CartQuantityError(requested, offer.availableStock);
      }

      // Calculate unit price according to wholesale tiers if defined
      let unitPrice = offer.price;
      if (offer.wholesaleTiers && offer.wholesaleTiers.length > 0) {
        const applicableTier = [...offer.wholesaleTiers]
          .sort((a, b) => b.minQuantity - a.minQuantity)
          .find((t) => requested >= t.minQuantity);
        if (applicableTier) {
          unitPrice = applicableTier.unitPrice;
        }
      }

      finalItemData = {
        ...itemData,
        sellerId: offer.sellerId, // authoritative seller assignment
        productId: offer.productId,
        variantId: offer.variantId || itemData.variantId,
        price: unitPrice,
        sellerSku: offer.sellerSku ?? itemData.sellerSku,
        condition: offer.condition,
        moq: offer.moq,
        currency: offer.currency || 'UGX',
        maxQuantity: offer.availableStock,
        productName: offer.product?.name || itemData.productName,
        productImage: offer.product?.thumbnail || offer.product?.images?.[0] || itemData.productImage,
        attributes: (offer.variant?.attributes as Record<string, unknown>) || itemData.attributes,
      };

      if (existingItem) {
        existingItem.quantity = requested;
        existingItem.price = unitPrice;
        existingItem.sellerSku = finalItemData.sellerSku;
        existingItem.condition = finalItemData.condition;
        existingItem.moq = finalItemData.moq;
        existingItem.currency = finalItemData.currency;
        existingItem.maxQuantity = finalItemData.maxQuantity;
      } else {
        cart.items.push({
          ...finalItemData,
          id: uuidv4(),
          addedAt: new Date().toISOString(),
        });
      }
    } else {
      const existingItem = cart.items.find(
        (i) => !i.offerId && i.productId === itemData.productId && i.variantId === itemData.variantId && i.sellerId === itemData.sellerId,
      );

      // The quantity the line would end up holding, whether this is a first add
      // or a top-up of one already in the cart.
      const requested = (existingItem?.quantity ?? 0) + itemData.quantity;
      const permitted = await permittedQuantity(itemData.productId, itemData.variantId, itemData.maxQuantity);
      if (requested > permitted) {
        throw new CartQuantityError(requested, permitted);
      }

      if (existingItem) {
        existingItem.quantity = requested;
        // update price in case it changed
        existingItem.price = itemData.price;
      } else {
        cart.items.push({
          ...itemData,
          id: uuidv4(),
          addedAt: new Date().toISOString(),
        });
      }
    }

    await recalculateCart(cart);
    await this.saveCart(cart);
    return cart;
  }

  async updateItemQuantity(userId: string, itemId: string, quantity: number): Promise<Cart> {
    const cart = await this.getCart(userId);
    if (quantity === 0) {
      cart.items = cart.items.filter((i) => i.id !== itemId);
    } else {
      const item = cart.items.find((i) => i.id === itemId);
      if (item) {
        if (item.offerId) {
          const offer = await fetchOfferDetails(item.offerId);
          if (!offer || offer.status !== 'ACTIVE') {
            throw new CartOfferInactiveError(item.offerId, `Offer is no longer active.`);
          }
          if (offer.product && offer.product.status !== 'ACTIVE') {
            throw new CartOfferInactiveError(item.offerId, `Product is no longer active.`);
          }
          const moq = offer.moq ?? 1;
          if (quantity < moq) {
            throw new CartMoqError(quantity, moq);
          }
          if (quantity > offer.availableStock) {
            throw new CartQuantityError(quantity, offer.availableStock);
          }
          let unitPrice = offer.price;
          if (offer.wholesaleTiers && offer.wholesaleTiers.length > 0) {
            const applicableTier = [...offer.wholesaleTiers]
              .sort((a, b) => b.minQuantity - a.minQuantity)
              .find((t) => quantity >= t.minQuantity);
            if (applicableTier) {
              unitPrice = applicableTier.unitPrice;
            }
          }
          item.price = unitPrice;
          item.quantity = quantity;
          item.maxQuantity = offer.availableStock;
        } else {
          const permitted = await permittedQuantity(item.productId, item.variantId, item.maxQuantity);
          if (quantity > permitted) {
            throw new CartQuantityError(quantity, permitted);
          }
          item.quantity = quantity;
        }
      }
    }
    await recalculateCart(cart);
    await this.saveCart(cart);
    return cart;
  }

  async removeItem(userId: string, itemId: string): Promise<Cart> {
    const cart = await this.getCart(userId);
    cart.items = cart.items.filter((i) => i.id !== itemId);
    await recalculateCart(cart);
    await this.saveCart(cart);
    return cart;
  }

  async clearCart(userId: string): Promise<void> {
    const key = this.getCartKey(userId);
    await redis.del(key);
  }

  async applyCoupon(userId: string, code: string): Promise<Cart> {
    const cart = await this.getCart(userId);
    // Trimmed so a stray space cannot store a code that no longer matches the
    // one discount-service is asked about.
    cart.couponCode = code.trim();
    await recalculateCart(cart);
    await this.saveCart(cart);
    return cart;
  }

  async removeCoupon(userId: string): Promise<Cart> {
    const cart = await this.getCart(userId);
    delete cart.couponCode;
    cart.couponDiscount = 0;
    await recalculateCart(cart);
    await this.saveCart(cart);
    return cart;
  }

  async mergeCart(userId: string, guestItems: CartItem[]): Promise<Cart> {
    const cart = await this.getCart(userId);
    
    for (const gItem of guestItems) {
      const existingItem = cart.items.find((i) => {
        if (gItem.offerId && i.offerId) {
          return i.offerId === gItem.offerId;
        }
        return !i.offerId && !gItem.offerId && i.productId === gItem.productId && i.variantId === gItem.variantId && i.sellerId === gItem.sellerId;
      });

      if (existingItem) {
        existingItem.quantity = Math.min(existingItem.quantity + gItem.quantity, existingItem.maxQuantity);
      } else {
        cart.items.push({
          ...gItem,
          id: uuidv4(),
          addedAt: new Date().toISOString(),
        });
      }
    }

    await recalculateCart(cart);
    await this.saveCart(cart);
    return cart;
  }

  async getCartSummary(userId: string): Promise<any> {
    const cart = await this.getCart(userId);
    const sellersMap = new Map<string, { sellerId: string; items: CartItem[]; subtotal: number }>();

    for (const item of cart.items) {
      if (!sellersMap.has(item.sellerId)) {
        sellersMap.set(item.sellerId, { sellerId: item.sellerId, items: [], subtotal: 0 });
      }
      const sellerGroup = sellersMap.get(item.sellerId)!;
      sellerGroup.items.push(item);
      sellerGroup.subtotal += item.price * item.quantity;
    }

    return {
      sellers: Array.from(sellersMap.values()),
      total: cart.subtotal - cart.couponDiscount,
      itemCount: cart.itemCount,
      subtotal: cart.subtotal,
      couponDiscount: cart.couponDiscount
    };
  }
}

export const cartService = new CartService();
