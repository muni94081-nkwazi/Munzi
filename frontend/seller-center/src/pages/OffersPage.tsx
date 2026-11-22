import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { offersApi } from '../api/offers.api';
import type { ProductOffer } from '../types/offer.types';
import { OffersTable } from '../components/offers/OffersTable';
import { ROUTES } from '../router/routes';

type TabType = 'ALL' | 'WINNERS' | 'COMPETING' | 'OUT_OF_STOCK' | 'INACTIVE';

export const OffersPage: React.FC = () => {
  const navigate = useNavigate();
  const [offers, setOffers] = useState<ProductOffer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const loadOffers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await offersApi.listMyOffers({ limit: 100 });
      setOffers(res.offers);
    } catch (err: any) {
      setError(err.message || 'Failed to load offers');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadOffers();
  }, []);

  const handleUpdateOffer = async (
    offerId: string,
    updates: { price?: number; stock?: number; status?: ProductOffer['status'] },
  ) => {
    await offersApi.update(offerId, updates);
    await loadOffers();
  };

  const handleDeleteOffer = async (offerId: string) => {
    await offersApi.delete(offerId);
    await loadOffers();
  };

  // Metrics
  const totalOffers = offers.length;
  const buyBoxWinnersCount = offers.filter((o) => o.isBuyBoxWinner && o.status === 'ACTIVE').length;
  const competingCount = offers.filter((o) => !o.isBuyBoxWinner && o.status === 'ACTIVE').length;
  const outOfStockCount = offers.filter((o) => (o.stock - (o.reserved ?? 0)) <= 0).length;

  const filteredOffers = useMemo(() => {
    return offers.filter((offer) => {
      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const skuMatch = offer.sellerSku?.toLowerCase().includes(query);
        const nameMatch = offer.product?.name?.toLowerCase().includes(query);
        const variantSkuMatch = offer.variant?.sku?.toLowerCase().includes(query);
        if (!skuMatch && !nameMatch && !variantSkuMatch) {
          return false;
        }
      }

      // Tab filter
      switch (activeTab) {
        case 'WINNERS':
          return offer.isBuyBoxWinner && offer.status === 'ACTIVE';
        case 'COMPETING':
          return !offer.isBuyBoxWinner && offer.status === 'ACTIVE';
        case 'OUT_OF_STOCK':
          return (offer.stock - (offer.reserved ?? 0)) <= 0;
        case 'INACTIVE':
          return offer.status === 'INACTIVE' || offer.status === 'SUSPENDED';
        default:
          return true;
      }
    });
  }, [offers, activeTab, searchQuery]);

  const statCardStyle: React.CSSProperties = {
    flex: '1 1 180px',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '14px 18px',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>My Offers & Competing Listings</h1>
          <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: 14 }}>
            Manage your pricing, inventory, and Buy Box competitiveness against catalogue products.
          </p>
        </div>
        <div>
          <button
            type="button"
            onClick={() => navigate(ROUTES.OFFER_CREATE || '/offers/new')}
            style={{
              padding: '10px 18px',
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            ➕ List Against Existing Product
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ background: '#fee2e2', border: '1px solid #ef4444', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#991b1b', fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* KPI Stats */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div style={statCardStyle}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Total Offers</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: '#0f172a' }}>{totalOffers}</div>
        </div>
        <div style={statCardStyle}>
          <div style={{ fontSize: 12, color: '#b45309', fontWeight: 600, textTransform: 'uppercase' }}>🏆 Buy Box Winners</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: '#b45309' }}>{buyBoxWinnersCount}</div>
        </div>
        <div style={statCardStyle}>
          <div style={{ fontSize: 12, color: '#2563eb', fontWeight: 600, textTransform: 'uppercase' }}>Competing Offers</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: '#2563eb' }}>{competingCount}</div>
        </div>
        <div style={statCardStyle}>
          <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600, textTransform: 'uppercase' }}>Out of Stock</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: '#dc2626' }}>{outOfStockCount}</div>
        </div>
      </div>

      {/* Controls: Tabs & Search */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { id: 'ALL', label: `All (${totalOffers})` },
            { id: 'WINNERS', label: `Buy Box Winners 🏆 (${buyBoxWinnersCount})` },
            { id: 'COMPETING', label: `Competing (${competingCount})` },
            { id: 'OUT_OF_STOCK', label: `Out of Stock (${outOfStockCount})` },
            { id: 'INACTIVE', label: 'Inactive' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as TabType)}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                border: activeTab === tab.id ? '1px solid #2563eb' : '1px solid #cbd5e1',
                background: activeTab === tab.id ? '#eff6ff' : '#ffffff',
                color: activeTab === tab.id ? '#1d4ed8' : '#475569',
                fontWeight: activeTab === tab.id ? 600 : 500,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div>
          <input
            type="search"
            placeholder="Search by SKU or product name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              fontSize: 13,
              width: 260,
            }}
          />
        </div>
      </div>

      {/* Offers Table */}
      <OffersTable
        offers={filteredOffers}
        isLoading={isLoading}
        onUpdateOffer={handleUpdateOffer}
        onDeleteOffer={handleDeleteOffer}
      />
    </div>
  );
};
