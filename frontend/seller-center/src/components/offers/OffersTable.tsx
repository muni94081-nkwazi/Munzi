import React, { useState } from 'react';
import type { ProductOffer } from '../../types/offer.types';

export interface OffersTableProps {
  offers: ProductOffer[];
  isLoading: boolean;
  onUpdateOffer: (offerId: string, updates: { price?: number; stock?: number; status?: ProductOffer['status'] }) => Promise<void>;
  onDeleteOffer: (offerId: string) => Promise<void>;
}

function formatCondition(condition: string): string {
  switch (condition) {
    case 'NEW':
      return 'Brand New';
    case 'REFURBISHED':
      return 'Refurbished';
    case 'USED_LIKE_NEW':
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

export const OffersTable: React.FC<OffersTableProps> = ({
  offers,
  isLoading,
  onUpdateOffer,
  onDeleteOffer,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftPrice, setDraftPrice] = useState<string>('');
  const [draftStock, setDraftStock] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const startEdit = (offer: ProductOffer) => {
    setEditingId(offer.id);
    setDraftPrice(String(offer.price));
    setDraftStock(String(offer.stock));
    setActionError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setActionError(null);
  };

  const saveEdit = async (offer: ProductOffer) => {
    const nextPrice = Number(draftPrice);
    const nextStock = Number(draftStock);

    if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
      setActionError('Price must be greater than zero');
      return;
    }
    if (!Number.isFinite(nextStock) || nextStock < 0) {
      setActionError('Stock cannot be negative');
      return;
    }

    setIsSaving(true);
    setActionError(null);
    try {
      await onUpdateOffer(offer.id, { price: nextPrice, stock: nextStock });
      setEditingId(null);
    } catch (err: any) {
      setActionError(err.message || 'Failed to update offer');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleStatus = async (offer: ProductOffer) => {
    const nextStatus = offer.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setIsSaving(true);
    try {
      await onUpdateOffer(offer.id, { status: nextStatus });
    } catch (err: any) {
      setActionError(err.message || 'Failed to update status');
    } finally {
      setIsSaving(false);
    }
  };

  const thStyle: React.CSSProperties = {
    padding: '12px 16px',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--color-text-secondary, #64748b)',
    textTransform: 'uppercase',
  };

  const tdStyle: React.CSSProperties = {
    padding: '12px 16px',
    fontSize: 14,
    color: 'var(--color-text-primary, #0f172a)',
  };

  if (isLoading) {
    return (
      <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', padding: 32, textAlign: 'center', color: '#64748b' }}>
        Loading offers…
      </div>
    );
  }

  if (offers.length === 0) {
    return (
      <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', padding: 48, textAlign: 'center', color: '#64748b' }}>
        <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No offers found</p>
        <p style={{ fontSize: 14, margin: 0 }}>List a competing offer against an existing catalogue product to start winning the Buy Box.</p>
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
      {actionError && (
        <div role="alert" style={{ background: '#fee2e2', borderBottom: '1px solid #ef4444', padding: '10px 16px', color: '#991b1b', fontSize: 13 }}>
          {actionError}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: 'var(--color-surface-muted, #f8fafc)' }}>
            <tr>
              <th style={thStyle}>Product / Variant</th>
              <th style={thStyle}>Seller SKU</th>
              <th style={thStyle}>Condition</th>
              <th style={thStyle}>Price (UGX)</th>
              <th style={thStyle}>Stock / Available</th>
              <th style={thStyle}>MOQ / Tiers</th>
              <th style={thStyle}>Buy Box</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((offer, idx) => {
              const isEditing = editingId === offer.id;
              const availableStock = Math.max(0, offer.stock - (offer.reserved ?? 0));
              const isLowStock = availableStock <= (offer.lowStockThreshold ?? 5);

              return (
                <tr
                  key={offer.id}
                  data-testid={`offer-row-${offer.id}`}
                  style={{ borderTop: idx > 0 ? '1px solid #e2e8f0' : 'none' }}
                >
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{offer.product?.name ?? 'Product #' + offer.productId.slice(0, 8)}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      SKU: <code>{offer.variant?.sku ?? offer.variantId.slice(0, 8)}</code>
                    </div>
                  </td>

                  <td style={tdStyle}>
                    <code style={{ fontSize: 13, color: '#475569' }}>{offer.sellerSku || '—'}</code>
                  </td>

                  <td style={tdStyle}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: 600,
                      background: offer.condition === 'NEW' ? '#dcfce7' : '#f1f5f9',
                      color: offer.condition === 'NEW' ? '#15803d' : '#475569',
                    }}>
                      {formatCondition(offer.condition)}
                    </span>
                  </td>

                  <td style={{ ...tdStyle, fontWeight: 700 }}>
                    {isEditing ? (
                      <input
                        type="number"
                        min={1}
                        value={draftPrice}
                        onChange={(e) => setDraftPrice(e.target.value)}
                        aria-label={`Price for offer ${offer.id}`}
                        style={{ width: 90, padding: 4, border: '1px solid #cbd5e1', borderRadius: 4 }}
                      />
                    ) : (
                      <>
                        <span>{offer.price.toLocaleString()}</span>
                        {offer.compareAtPrice && offer.compareAtPrice > offer.price && (
                          <div style={{ fontSize: 11, color: '#94a3b8', textDecoration: 'line-through' }}>
                            {offer.compareAtPrice.toLocaleString()}
                          </div>
                        )}
                      </>
                    )}
                  </td>

                  <td style={tdStyle}>
                    {isEditing ? (
                      <input
                        type="number"
                        min={0}
                        value={draftStock}
                        onChange={(e) => setDraftStock(e.target.value)}
                        aria-label={`Stock for offer ${offer.id}`}
                        style={{ width: 70, padding: 4, border: '1px solid #cbd5e1', borderRadius: 4 }}
                      />
                    ) : (
                      <div>
                        <span style={{ fontWeight: 700, color: availableStock <= 0 ? '#ef4444' : isLowStock ? '#f59e0b' : '#10b981' }}>
                          {availableStock}
                        </span>
                        <span style={{ fontSize: 12, color: '#64748b' }}> ({offer.stock} total)</span>
                        {isLowStock && availableStock > 0 && (
                          <div style={{ fontSize: 11, color: '#b45309', fontWeight: 600 }}>Low stock</div>
                        )}
                        {availableStock <= 0 && (
                          <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>Out of stock</div>
                        )}
                      </div>
                    )}
                  </td>

                  <td style={tdStyle}>
                    <div style={{ fontSize: 13 }}>MOQ: {offer.moq ?? 1}</div>
                    {offer.wholesaleTiers && offer.wholesaleTiers.length > 0 ? (
                      <div style={{ fontSize: 11, color: '#2563eb' }}>
                        {offer.wholesaleTiers.length} bulk tier{offer.wholesaleTiers.length > 1 ? 's' : ''}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>No bulk tiers</div>
                    )}
                  </td>

                  <td style={tdStyle}>
                    {offer.isBuyBoxWinner ? (
                      <span
                        data-testid="buybox-winner-indicator"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 8px',
                          borderRadius: 12,
                          fontSize: 12,
                          fontWeight: 700,
                          background: '#fef3c7',
                          color: '#92400e',
                          border: '1px solid #fcd34d',
                        }}
                      >
                        🏆 Winner
                      </span>
                    ) : (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: 12,
                          fontSize: 12,
                          fontWeight: 500,
                          background: '#f1f5f9',
                          color: '#64748b',
                        }}
                      >
                        Competing
                      </span>
                    )}
                  </td>

                  <td style={tdStyle}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: 600,
                      background: offer.status === 'ACTIVE' ? '#dcfce7' : '#fee2e2',
                      color: offer.status === 'ACTIVE' ? '#166534' : '#991b1b',
                    }}>
                      {offer.status}
                    </span>
                  </td>

                  <td style={tdStyle}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => void saveEdit(offer)}
                          disabled={isSaving}
                          style={{
                            padding: '4px 10px',
                            background: '#10b981',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {isSaving ? '…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={isSaving}
                          style={{
                            padding: '4px 8px',
                            background: 'none',
                            border: '1px solid #cbd5e1',
                            borderRadius: 4,
                            fontSize: 12,
                            color: '#64748b',
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => startEdit(offer)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#2563eb',
                            fontSize: 13,
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          Quick Edit
                        </button>
                        <span style={{ color: '#cbd5e1' }}>|</span>
                        <button
                          type="button"
                          onClick={() => void toggleStatus(offer)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: offer.status === 'ACTIVE' ? '#64748b' : '#166534',
                            fontSize: 13,
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          {offer.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        </button>
                        <span style={{ color: '#cbd5e1' }}>|</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm('Are you sure you want to delete this offer?')) {
                              void onDeleteOffer(offer.id);
                            }
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#dc2626',
                            fontSize: 13,
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
