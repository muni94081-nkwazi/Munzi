import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { offersApi } from '../api/offers.api';
import type { ProductCondition, WholesaleTier } from '../types/offer.types';
import { ROUTES } from '../router/routes';

interface CatalogProduct {
  id: string;
  name: string;
  slug?: string;
  basePrice?: number;
  price?: number;
  category?: { name: string } | string;
  images?: string[];
  imageUrls?: string[];
}

interface ProductVariant {
  id: string;
  sku: string;
  price: number;
  stock?: number;
  attributes?: Record<string, string>;
}

export const OfferCreatePage: React.FC = () => {
  const navigate = useNavigate();

  // Search Step
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<CatalogProduct[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // Selected Product & Variants Step
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [isLoadingVariants, setIsLoadingVariants] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');

  // Offer Form Fields
  const [sellerSku, setSellerSku] = useState('');
  const [price, setPrice] = useState('');
  const [compareAtPrice, setCompareAtPrice] = useState('');
  const [condition, setCondition] = useState<ProductCondition>('NEW');
  const [conditionNote, setConditionNote] = useState('');
  const [stock, setStock] = useState('10');
  const [lowStockThreshold, setLowStockThreshold] = useState('5');
  const [moq, setMoq] = useState('1');

  // Wholesale Tiers (B2B)
  const [wholesaleTiers, setWholesaleTiers] = useState<WholesaleTier[]>([]);
  const [tierMinQty, setTierMinQty] = useState('');
  const [tierPrice, setTierPrice] = useState('');

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setHasSearched(true);
    setFormError(null);
    try {
      const results = await offersApi.searchCatalog(searchQuery.trim());
      setSearchResults(results);
    } catch (err: any) {
      setFormError(err.message || 'Error searching catalog');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectProduct = async (prod: CatalogProduct) => {
    setSelectedProduct(prod);
    setIsLoadingVariants(true);
    setVariants([]);
    setSelectedVariantId('');
    setFormError(null);

    try {
      const varList = await offersApi.getProductVariants(prod.id);
      setVariants(varList);
      if (varList.length > 0) {
        setSelectedVariantId(varList[0].id);
        if (varList[0].price) {
          setPrice(String(varList[0].price));
        }
      } else {
        const defaultPrice = prod.price ?? prod.basePrice;
        if (defaultPrice) {
          setPrice(String(defaultPrice));
        }
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to load product variants');
    } finally {
      setIsLoadingVariants(false);
    }
  };

  const handleAddTier = () => {
    const minQ = Number(tierMinQty);
    const p = Number(tierPrice);

    if (!Number.isFinite(minQ) || minQ <= 1) {
      setFormError('Wholesale tier minimum quantity must be greater than 1');
      return;
    }
    if (!Number.isFinite(p) || p <= 0) {
      setFormError('Wholesale tier price must be greater than zero');
      return;
    }
    const currentPrice = Number(price);
    if (Number.isFinite(currentPrice) && currentPrice > 0 && p >= currentPrice) {
      setFormError('Wholesale tier price must be lower than your standard selling price');
      return;
    }

    setWholesaleTiers([...wholesaleTiers, { minQuantity: minQ, price: p }].sort((a, b) => a.minQuantity - b.minQuantity));
    setTierMinQty('');
    setTierPrice('');
    setFormError(null);
  };

  const handleRemoveTier = (index: number) => {
    setWholesaleTiers(wholesaleTiers.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) {
      setFormError('Please select a catalogue product to list against');
      return;
    }

    if (!selectedVariantId && variants.length > 0) {
      setFormError('Please select a variant for your offer');
      return;
    }

    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setFormError('Selling price must be greater than zero');
      return;
    }

    const numericCompareAt = compareAtPrice.trim() ? Number(compareAtPrice) : undefined;
    if (numericCompareAt !== undefined && numericCompareAt < numericPrice) {
      setFormError('Compare-at price must be greater than or equal to selling price');
      return;
    }

    const numericStock = Number(stock);
    if (!Number.isFinite(numericStock) || numericStock < 0) {
      setFormError('Stock cannot be negative');
      return;
    }

    const numericMoq = Number(moq);
    if (!Number.isFinite(numericMoq) || numericMoq < 1) {
      setFormError('Minimum order quantity (MOQ) must be at least 1');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      await offersApi.create({
        productId: selectedProduct.id,
        variantId: selectedVariantId || variants[0]?.id || selectedProduct.id,
        sellerSku: sellerSku.trim() || undefined,
        price: numericPrice,
        compareAtPrice: numericCompareAt,
        condition,
        conditionNote: conditionNote.trim() || undefined,
        stock: numericStock,
        lowStockThreshold: Number(lowStockThreshold) || 5,
        moq: numericMoq,
        wholesaleTiers: wholesaleTiers.length > 0 ? wholesaleTiers : undefined,
      });

      navigate(ROUTES.OFFERS || '/offers');
    } catch (err: any) {
      setFormError(err.message || 'Failed to create offer');
    } finally {
      setIsSubmitting(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 24,
    marginBottom: 24,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    fontSize: 14,
    marginTop: 4,
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 4,
  };

  return (
    <div style={{ maxWidth: 840, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => navigate(ROUTES.OFFERS || '/offers')}
          style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0, fontSize: 14, marginBottom: 8 }}
        >
          &larr; Back to Offers
        </button>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>List Competing Offer Against Existing Product</h1>
        <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: 14 }}>
          Search for an existing product in the Muni catalogue and list your own competing offer, stock, and pricing.
        </p>
      </div>

      {formError && (
        <div role="alert" style={{ background: '#fee2e2', border: '1px solid #ef4444', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#991b1b', fontSize: 14 }}>
          {formError}
        </div>
      )}

      {/* STEP 1: Search Catalogue */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px 0' }}>Step 1: Find Existing Catalogue Product</h2>

        {!selectedProduct ? (
          <div>
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10 }}>
              <input
                type="search"
                placeholder="Search by product title, brand, or SKU…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ ...inputStyle, flex: 1, marginTop: 0 }}
              />
              <button
                type="submit"
                disabled={isSearching}
                style={{
                  padding: '8px 20px',
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: isSearching ? 'default' : 'pointer',
                }}
              >
                {isSearching ? 'Searching…' : 'Search'}
              </button>
            </form>

            {hasSearched && !isSearching && searchResults.length === 0 && (
              <p style={{ marginTop: 16, color: '#64748b', fontSize: 14 }}>
                No products found matching "{searchQuery}". If this product is brand new to Muni, create a new product listing instead.
              </p>
            )}

            {searchResults.length > 0 && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {searchResults.map((prod) => (
                  <div
                    key={prod.id}
                    data-testid={`search-result-${prod.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      border: '1px solid #e2e8f0',
                      borderRadius: 6,
                      padding: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{prod.name}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        ID: <code>{prod.id}</code> {prod.price ? `• UGX ${prod.price.toLocaleString()}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSelectProduct(prod)}
                      style={{
                        padding: '6px 14px',
                        background: '#eff6ff',
                        color: '#1d4ed8',
                        border: '1px solid #bfdbfe',
                        borderRadius: 6,
                        fontWeight: 600,
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      Select Product
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Selected Product</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{selectedProduct.name}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>ID: <code>{selectedProduct.id}</code></div>
            </div>
            <button
              type="button"
              onClick={() => { setSelectedProduct(null); setVariants([]); }}
              style={{
                padding: '6px 12px',
                background: 'none',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                fontSize: 12,
                color: '#64748b',
                cursor: 'pointer',
              }}
            >
              Change Product
            </button>
          </div>
        )}
      </div>

      {/* STEP 2: Select Variant & Offer Details */}
      {selectedProduct && (
        <form onSubmit={handleSubmit}>
          <div style={cardStyle}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px 0' }}>Step 2: Variant & Offer Details</h2>

            {isLoadingVariants ? (
              <p style={{ color: '#64748b', fontSize: 14 }}>Loading variants…</p>
            ) : variants.length > 0 ? (
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Select Product Variant / SKU <span style={{ color: '#dc2626' }}>*</span></label>
                <select
                  value={selectedVariantId}
                  onChange={(e) => setSelectedVariantId(e.target.value)}
                  style={inputStyle}
                  required
                >
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.sku} {v.attributes ? `(${Object.entries(v.attributes).map(([k, val]) => `${k}: ${val}`).join(', ')})` : ''} — Reference Price: UGX {v.price.toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ marginBottom: 20, color: '#64748b', fontSize: 13 }}>
                This canonical product has a single base variant.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <label style={labelStyle}>Your Selling Price (UGX) <span style={{ color: '#dc2626' }}>*</span></label>
                <input
                  type="number"
                  min={1}
                  required
                  placeholder="e.g. 35000"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Compare-at / Strike-through Price (UGX)</label>
                <input
                  type="number"
                  min={1}
                  placeholder="Optional, e.g. 40000"
                  value={compareAtPrice}
                  onChange={(e) => setCompareAtPrice(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <label style={labelStyle}>Condition <span style={{ color: '#dc2626' }}>*</span></label>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as ProductCondition)}
                  style={inputStyle}
                >
                  <option value="NEW">Brand New</option>
                  <option value="REFURBISHED">Refurbished</option>
                  <option value="USED_LIKE_NEW">Used - Like New</option>
                  <option value="USED_GOOD">Used - Good</option>
                  <option value="USED_FAIR">Used - Fair</option>
                  <option value="OPEN_BOX">Open Box</option>
                  <option value="FOR_PARTS">For Parts</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Seller Internal SKU (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. MY-STORE-HNY-01"
                  value={sellerSku}
                  onChange={(e) => setSellerSku(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Condition Note (Optional)</label>
              <textarea
                placeholder="Describe condition details, included accessories, or warranty terms…"
                rows={3}
                maxLength={500}
                value={conditionNote}
                onChange={(e) => setConditionNote(e.target.value)}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
              <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right' }}>{conditionNote.length}/500</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Stock Quantity <span style={{ color: '#dc2626' }}>*</span></label>
                <input
                  type="number"
                  min={0}
                  required
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Low Stock Alert Threshold</label>
                <input
                  type="number"
                  min={0}
                  value={lowStockThreshold}
                  onChange={(e) => setLowStockThreshold(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Minimum Order Qty (MOQ)</label>
                <input
                  type="number"
                  min={1}
                  value={moq}
                  onChange={(e) => setMoq(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>
          </div>

          {/* STEP 3: B2B Wholesale Pricing Tiers */}
          <div style={cardStyle}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px 0' }}>B2B Bulk & Wholesale Pricing Tiers (Optional)</h2>
            <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 16px 0' }}>
              Incentivize bulk B2B purchases by offering tiered volume discounts.
            </p>

            {wholesaleTiers.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Min Quantity</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Unit Price (UGX)</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wholesaleTiers.map((tier, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600 }}>{tier.minQuantity}+ units</td>
                        <td style={{ padding: '8px 12px' }}>UGX {tier.price.toLocaleString()}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => handleRemoveTier(idx)}
                            style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Min Quantity</label>
                <input
                  type="number"
                  min={2}
                  placeholder="e.g. 10"
                  value={tierMinQty}
                  onChange={(e) => setTierMinQty(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Tier Unit Price (UGX)</label>
                <input
                  type="number"
                  min={1}
                  placeholder="e.g. 30000"
                  value={tierPrice}
                  onChange={(e) => setTierPrice(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <button
                type="button"
                onClick={handleAddTier}
                style={{
                  padding: '9px 16px',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: '#334155',
                }}
              >
                Add Tier
              </button>
            </div>
          </div>

          {/* Form Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginBottom: 40 }}>
            <button
              type="button"
              onClick={() => navigate(ROUTES.OFFERS || '/offers')}
              style={{
                padding: '10px 20px',
                background: '#fff',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                fontSize: 14,
                color: '#64748b',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: '10px 24px',
                background: '#16a34a',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: isSubmitting ? 'default' : 'pointer',
              }}
            >
              {isSubmitting ? 'Publishing Offer…' : 'Publish Competing Offer'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
