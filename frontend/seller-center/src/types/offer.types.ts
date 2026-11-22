export type ProductCondition =
  | 'NEW'
  | 'REFURBISHED'
  | 'USED_LIKE_NEW'
  | 'USED_GOOD'
  | 'USED_FAIR'
  | 'OPEN_BOX'
  | 'FOR_PARTS';

export type OfferStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'OUT_OF_STOCK'
  | 'SUSPENDED';

export interface WholesaleTier {
  minQuantity: number;
  price: number;
}

export interface ProductOffer {
  id: string;
  productId: string;
  variantId: string;
  sellerId: string;
  sellerSku?: string | null;
  price: number;
  compareAtPrice?: number | null;
  currency: string;
  condition: ProductCondition;
  conditionNote?: string | null;
  moq: number;
  wholesaleTiers?: WholesaleTier[] | null;
  isBuyBoxWinner: boolean;
  status: OfferStatus;
  stock: number;
  reserved: number;
  lowStockThreshold: number;
  createdAt: string;
  updatedAt?: string;
  product?: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
  variant?: {
    id: string;
    sku: string;
    attributes: Record<string, string>;
  };
}

export interface CreateOfferInput {
  productId: string;
  variantId: string;
  sellerSku?: string | null;
  price: number;
  compareAtPrice?: number | null;
  currency?: string;
  condition?: ProductCondition;
  conditionNote?: string | null;
  moq?: number;
  wholesaleTiers?: WholesaleTier[] | null;
  stock?: number;
  lowStockThreshold?: number;
  status?: OfferStatus;
}

export interface UpdateOfferInput {
  sellerSku?: string | null;
  price?: number;
  compareAtPrice?: number | null;
  currency?: string;
  condition?: ProductCondition;
  conditionNote?: string | null;
  moq?: number;
  wholesaleTiers?: WholesaleTier[] | null;
  stock?: number;
  lowStockThreshold?: number;
  status?: OfferStatus;
}

export interface ListOffersQuery {
  status?: OfferStatus | string;
  productId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedOffers {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  offers: ProductOffer[];
}
