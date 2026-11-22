import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ProductOffer } from '@/types';
import { storefrontApi, type PublicStore } from '@/api/storefront.api';
import { useFormatPrice } from '@/hooks';
import { BorderRadius, Colors, FontSize, Spacing, Shadow } from '@/constants/theme';

export interface ProductOffersListProps {
  offers: ProductOffer[];
  selectedOfferId?: string | null;
  currency?: string;
  onSelectOffer: (offer: ProductOffer) => void;
  onAddToCartOffer?: (offer: ProductOffer) => void;
}

export function formatOfferCondition(condition: string): string {
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
  currency = 'USD',
  onSelectOffer,
  onAddToCartOffer,
}: ProductOffersListProps) {
  const formatPrice = useFormatPrice();
  const [stores, setStores] = useState<Record<string, PublicStore>>({});

  useEffect(() => {
    const sellerIds = Array.from(new Set(offers.map((o) => o.sellerId))).filter(Boolean);
    let cancelled = false;

    sellerIds.forEach((sellerId) => {
      if (stores[sellerId]) return;
      storefrontApi
        .getStore(sellerId)
        .then((store) => {
          if (!cancelled && store) {
            setStores((prev) => ({ ...prev, [sellerId]: store }));
          }
        })
        .catch(() => {
          // 404 or store not found is normal for sellers without a public storefront
        });
    });

    return () => {
      cancelled = true;
    };
  }, [offers, stores]);

  if (!offers || offers.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Other Sellers on Muni</Text>
        <Text style={styles.subtitle}>
          Compare price, condition, and seller ratings ({offers.length} offer{offers.length === 1 ? '' : 's'})
        </Text>
      </View>

      {offers.map((offer) => {
        const isSelected = selectedOfferId === offer.id;
        const store = stores[offer.sellerId];
        const storeName = store?.storeName ?? `Seller #${offer.sellerId.slice(-6)}`;
        const conditionLabel = formatOfferCondition(offer.condition);
        const isNew = offer.condition === 'NEW';
        const inStock = offer.isInStock ?? (offer.stock ? offer.stock > 0 : true);

        return (
          <View
            key={offer.id}
            style={[styles.card, isSelected && styles.cardSelected]}
            accessibilityRole="region"
            accessibilityLabel={`Offer from ${storeName}`}
          >
            {/* Top row: Badges */}
            <View style={styles.topRow}>
              <View style={styles.badges}>
                <View style={[styles.conditionBadge, isNew ? styles.badgeNew : styles.badgeUsed]}>
                  <Text style={[styles.conditionText, isNew ? styles.textNew : styles.textUsed]}>
                    {conditionLabel}
                  </Text>
                </View>
                {offer.isBuyBoxWinner && (
                  <View style={styles.buyBoxBadge}>
                    <MaterialCommunityIcons name="trophy" size={12} color={Colors.white} />
                    <Text style={styles.buyBoxBadgeText}>Best Price</Text>
                  </View>
                )}
                {isSelected && (
                  <View style={styles.selectedBadge}>
                    <MaterialCommunityIcons name="check" size={12} color={Colors.primaryDark} />
                    <Text style={styles.selectedBadgeText}>Selected</Text>
                  </View>
                )}
              </View>

              <View style={styles.priceContainer}>
                <Text style={styles.price}>
                  {formatPrice(offer.price, offer.currency || currency)}
                </Text>
                {offer.compareAtPrice && offer.compareAtPrice > offer.price && (
                  <Text style={styles.comparePrice}>
                    {formatPrice(offer.compareAtPrice, offer.currency || currency)}
                  </Text>
                )}
              </View>
            </View>

            {/* Condition Note if any */}
            {offer.conditionNote ? (
              <Text style={styles.conditionNote} numberOfLines={2}>
                &ldquo;{offer.conditionNote}&rdquo;
              </Text>
            ) : null}

            {/* Seller info & stock */}
            <View style={styles.sellerRow}>
              <View style={styles.sellerInfo}>
                <View style={styles.sellerNameRow}>
                  <MaterialCommunityIcons
                    name="storefront-outline"
                    size={16}
                    color={Colors.text.secondary}
                  />
                  <Text style={styles.sellerName} numberOfLines={1}>
                    {storeName}
                  </Text>
                </View>
                {store?.rating && store.rating > 0 ? (
                  <View style={styles.ratingRow}>
                    <MaterialCommunityIcons name="star" size={12} color={Colors.rating} />
                    <Text style={styles.ratingText}>
                      {store.rating.toFixed(1)}
                      {store.reviewCount ? ` (${store.reviewCount})` : ''}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.stockInfo}>
                <Text style={[styles.stockText, !inStock && styles.stockOut]}>
                  {inStock ? 'In stock' : 'Out of stock'}
                </Text>
                {offer.moq && offer.moq > 1 && (
                  <Text style={styles.moqText}>Min: {offer.moq} units</Text>
                )}
              </View>
            </View>

            {/* Actions */}
            <View style={styles.actionRow}>
              <Button
                mode={isSelected ? 'contained' : 'outlined'}
                compact
                disabled={!inStock}
                onPress={() => onSelectOffer(offer)}
                style={[styles.selectBtn, isSelected && styles.selectBtnActive]}
                contentStyle={styles.btnContent}
                textColor={isSelected ? Colors.white : Colors.text.primary}
              >
                {isSelected ? 'Current Offer' : 'Select Offer'}
              </Button>
              {onAddToCartOffer && !isSelected && (
                <Button
                  mode="text"
                  compact
                  disabled={!inStock}
                  onPress={() => onAddToCartOffer(offer)}
                  style={styles.buyFromSellerBtn}
                  contentStyle={styles.btnContent}
                  textColor={Colors.primaryDark}
                >
                  Buy from seller
                </Button>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.lg,
    backgroundColor: Colors.background.card,
    marginTop: Spacing.md,
  },
  header: {
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text.primary,
  },
  subtitle: {
    fontSize: FontSize.xs,
    color: Colors.text.muted,
    marginTop: 2,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    ...Shadow.sm,
  },
  cardSelected: {
    borderColor: Colors.primary,
    borderWidth: 2,
    backgroundColor: '#fffdfa',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.xs,
    flex: 1,
    marginRight: Spacing.sm,
  },
  conditionBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  badgeNew: {
    backgroundColor: '#e6f4ea',
  },
  badgeUsed: {
    backgroundColor: '#f1f3f4',
  },
  conditionText: {
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  textNew: {
    color: Colors.success,
  },
  textUsed: {
    color: Colors.text.secondary,
  },
  buyBoxBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    gap: 2,
  },
  buyBoxBadgeText: {
    color: Colors.white,
    fontSize: 10,
    fontWeight: '700',
  },
  selectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3e0',
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    gap: 2,
  },
  selectedBadgeText: {
    color: Colors.primaryDark,
    fontSize: 10,
    fontWeight: '700',
  },
  priceContainer: {
    alignItems: 'flex-end',
  },
  price: {
    fontSize: FontSize.lg,
    fontWeight: '800',
    color: Colors.price,
  },
  comparePrice: {
    fontSize: FontSize.xs,
    color: Colors.text.muted,
    textDecorationLine: 'line-through',
  },
  conditionNote: {
    fontSize: FontSize.xs,
    fontStyle: 'italic',
    color: Colors.text.muted,
    marginTop: Spacing.xs,
    backgroundColor: Colors.gray[50],
    padding: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  sellerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.sm,
    paddingTop: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  sellerInfo: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  sellerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sellerName: {
    fontSize: FontSize.sm,
    color: Colors.text.primary,
    fontWeight: '600',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },
  ratingText: {
    fontSize: FontSize.xs,
    color: Colors.rating,
    fontWeight: '700',
  },
  stockInfo: {
    alignItems: 'flex-end',
  },
  stockText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.success,
  },
  stockOut: {
    color: Colors.error,
  },
  moqText: {
    fontSize: 10,
    color: Colors.text.muted,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  selectBtn: {
    borderRadius: BorderRadius.full,
    borderColor: Colors.border,
  },
  selectBtnActive: {
    backgroundColor: Colors.primary,
  },
  buyFromSellerBtn: {
    borderRadius: BorderRadius.full,
  },
  btnContent: {
    minHeight: 36,
  },
});
