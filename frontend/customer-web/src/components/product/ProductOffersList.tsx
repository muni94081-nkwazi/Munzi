import React, { useEffect, useState } from 'react';
import type { ProductOffer } from '@/types/product.types';
import { useCurrency } from '@/hooks/useCurrency';
import { storefrontApi, type PublicStore } from '@/api/storefront.api';
import styles from './ProductOffersList.module.css';

export interface ProductOffersListProps {
  offers: ProductOffer[];
  selectedOfferId?: string | null;
  onSelectOffer?: (offer: ProductOffer) => void;
  onAddToCartOffer?: (offer: ProductOffer) => void;
}

function conditionClass(condition: string): string {
  switch (condition) {
    case 'NEW':
      return styles.conditionNew;
    case 'REFURBISHED':
    case 'OPEN_BOX':
      return styles.conditionRefurbished;
    default:
      return styles.conditionUsed;
  }
}

function formatCondition(condition: string): string {
  switch (condition) {
    case 'NEW':
      return 'Brand New';
    case 'REFURBISHED':
      return 'Refurbished';
    case 'USED_LIKE_NEW':
    case 'LIKE_NEW':
      return 'Used - Like New';
    case 'USED_GOOD':
      return 'Used - Good';
    case 'USED_FAIR':
      return 'Used - Fair';
    case 'OPEN_BOX':
      return 'Open Box';
    case 'FOR_PARTS':
      return 'For Parts';
    default:
      return condition;
  }
}

export function ProductOffersList({
  offers,
  selectedOfferId,
  onSelectOffer,
  onAddToCartOffer,
}: ProductOffersListProps) {
  const { format: formatPrice } = useCurrency();
  const [stores, setStores] = useState<Record<string, PublicStore>>({});

  useEffect(() => {
    // Resolve seller stores for all competing offers
    const sellerIds = Array.from(new Set(offers.map((o) => o.sellerId))).filter(Boolean);
    let cancelled = false;

    sellerIds.forEach((sellerId) => {
      storefrontApi
        .getStore(sellerId)
        .then((store) => {
          if (!cancelled && store) {
            setStores((prev) => ({ ...prev, [sellerId]: store }));
          }
        })
        .catch(() => {
          // Store not found or unconfigured — graceful fallback to seller ID
        });
    });

    return () => {
      cancelled = true;
    };
  }, [offers]);

  if (!offers || offers.length === 0) {
    return null;
  }

  return (
    <section className={styles.container} aria-label="Other Sellers on Muni">
      <div className={styles.header}>
        <h3 className={styles.title}>
          Other Sellers on Muni
          <span className={styles.countBadge}>{offers.length} offers</span>
        </h3>
      </div>

      <div className={styles.offersList}>
        {offers.map((offer) => {
          const isSelected = selectedOfferId === offer.id;
          const store = stores[offer.sellerId];
          const sellerName = store?.storeName || offer.sellerSku || `Seller #${offer.sellerId.slice(-6)}`;
          const rating = store?.rating;
          const conditionCls = conditionClass(offer.condition);

          return (
            <div
              key={offer.id}
              className={`${styles.offerCard} ${isSelected ? styles.selectedCard : ''}`}
              data-testid={`offer-card-${offer.id}`}
            >
              <div className={styles.sellerSection}>
                <div className={styles.sellerHeader}>
                  <span className={styles.sellerName}>{sellerName}</span>
                  {offer.isBuyBoxWinner && (
                    <span className={styles.buyBoxBadge} title="Featured Buy Box Winner">
                      Best Offer
                    </span>
                  )}
                  <span className={`${styles.conditionBadge} ${conditionCls}`}>
                    {formatCondition(offer.condition)}
                  </span>
                </div>

                <div className={styles.sellerMeta}>
                  {rating !== undefined && rating > 0 && (
                    <span>★ {rating.toFixed(1)}</span>
                  )}
                  {store?.verificationStatus === 'verified' && (
                    <span>Verified Merchant</span>
                  )}
                  <span
                    className={`${styles.stockStatus} ${
                      offer.isInStock ? styles.inStock : styles.outOfStock
                    }`}
                  >
                    {offer.isInStock ? 'In Stock' : 'Out of Stock'}
                  </span>
                </div>
              </div>

              <div className={styles.pricingSection}>
                <span className={styles.price}>{formatPrice(offer.price)}</span>
                {offer.compareAtPrice && offer.compareAtPrice > offer.price && (
                  <span className={styles.comparePrice}>
                    {formatPrice(offer.compareAtPrice)}
                  </span>
                )}
              </div>

              <div className={styles.actionsSection}>
                {onSelectOffer && (
                  <button
                    type="button"
                    className={`${styles.selectButton} ${
                      isSelected ? styles.selectedButton : ''
                    }`}
                    onClick={() => onSelectOffer(offer)}
                    disabled={isSelected || !offer.isInStock}
                    aria-label={isSelected ? `Selected offer from ${sellerName}` : `Select offer from ${sellerName}`}
                  >
                    {isSelected ? 'Selected' : 'Select Offer'}
                  </button>
                )}

                {onAddToCartOffer && (
                  <button
                    type="button"
                    className={styles.selectButton}
                    onClick={() => onAddToCartOffer(offer)}
                    disabled={!offer.isInStock}
                    aria-label={`Buy from ${sellerName}`}
                  >
                    Buy from Seller
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
