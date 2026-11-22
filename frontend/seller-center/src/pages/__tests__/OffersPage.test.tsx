// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ProductOffer } from '../../types/offer.types';

const listMyOffers = vi.fn();
const update = vi.fn();
const del = vi.fn();

vi.mock('../../api/offers.api', () => ({
  offersApi: {
    listMyOffers: (...args: unknown[]) => listMyOffers(...args),
    update: (...args: unknown[]) => update(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const { OffersPage } = await import('../OffersPage');

function makeOffer(overrides: Partial<ProductOffer> = {}): ProductOffer {
  return {
    id: 'off-1',
    productId: 'prod-1',
    variantId: 'var-1',
    sellerId: 'seller-me',
    sellerSku: 'MY-SKU-100',
    price: 32000,
    currency: 'UGX',
    condition: 'NEW',
    moq: 1,
    isBuyBoxWinner: false,
    status: 'ACTIVE',
    stock: 20,
    reserved: 0,
    lowStockThreshold: 5,
    createdAt: new Date().toISOString(),
    product: {
      id: 'prod-1',
      name: 'Kasese Pure Wildflower Honey 1L',
      slug: 'kasese-honey-1l',
      status: 'ACTIVE',
    },
    variant: {
      id: 'var-1',
      sku: 'HNY-1L',
      attributes: { size: '1L' },
    },
    ...overrides,
  };
}

describe('OffersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('fetches offers on mount and renders metrics and table', async () => {
    const offers = [
      makeOffer({ id: 'off-1', isBuyBoxWinner: true, stock: 10 }),
      makeOffer({ id: 'off-2', sellerSku: 'COMP-SKU-2', isBuyBoxWinner: false, stock: 0 }),
      makeOffer({ id: 'off-3', sellerSku: 'INACT-SKU-3', isBuyBoxWinner: false, status: 'INACTIVE', stock: 5 }),
    ];

    listMyOffers.mockResolvedValueOnce({
      total: 3,
      page: 1,
      limit: 100,
      totalPages: 1,
      offers,
    });

    render(
      <MemoryRouter>
        <OffersPage />
      </MemoryRouter>,
    );

    // Initial loading
    expect(screen.getByText('Loading offers…')).toBeTruthy();

    // After load
    await waitFor(() => {
      expect(screen.getByText('My Offers & Competing Listings')).toBeTruthy();
    });

    // Check KPIs
    expect(screen.getByText('Total Offers')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy(); // total offers count
    expect(screen.getByText('🏆 Buy Box Winners')).toBeTruthy();
    expect(screen.getAllByText('1')).toHaveLength(3); // winners, competing, out-of-stock
    expect(screen.getByText('Out of Stock')).toBeTruthy();

    // Check rows rendered
    expect(screen.getByText('MY-SKU-100')).toBeTruthy();
    expect(screen.getByText('COMP-SKU-2')).toBeTruthy();
    expect(screen.getByText('INACT-SKU-3')).toBeTruthy();
  });

  it('navigates to /offers/new when Add Offer button is clicked', async () => {
    const user = userEvent.setup();
    listMyOffers.mockResolvedValueOnce({ total: 0, offers: [] });

    render(
      <MemoryRouter>
        <OffersPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('My Offers & Competing Listings')).toBeTruthy();
    });

    const addBtn = screen.getByRole('button', { name: /List Against Existing Product/i });
    await user.click(addBtn);

    expect(mockNavigate).toHaveBeenCalledWith('/offers/new');
  });

  it('filters table by tab (Buy Box Winners only)', async () => {
    const user = userEvent.setup();
    const offers = [
      makeOffer({ id: 'off-1', sellerSku: 'WINNER-SKU', isBuyBoxWinner: true }),
      makeOffer({ id: 'off-2', sellerSku: 'COMP-SKU', isBuyBoxWinner: false }),
    ];

    listMyOffers.mockResolvedValueOnce({ total: 2, offers });

    render(
      <MemoryRouter>
        <OffersPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('WINNER-SKU')).toBeTruthy();
      expect(screen.getByText('COMP-SKU')).toBeTruthy();
    });

    // Click Buy Box Winners tab
    const winnersTab = screen.getByRole('button', { name: /Buy Box Winners 🏆/i });
    await user.click(winnersTab);

    // Only winner offer should be visible
    expect(screen.getByText('WINNER-SKU')).toBeTruthy();
    expect(screen.queryByText('COMP-SKU')).toBeNull();
  });

  it('filters table by search query', async () => {
    const user = userEvent.setup();
    const offers = [
      makeOffer({ id: 'off-1', sellerSku: 'HONEY-ALPHA' }),
      makeOffer({ id: 'off-2', sellerSku: 'COFFEE-BETA' }),
    ];

    listMyOffers.mockResolvedValueOnce({ total: 2, offers });

    render(
      <MemoryRouter>
        <OffersPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('HONEY-ALPHA')).toBeTruthy();
      expect(screen.getByText('COFFEE-BETA')).toBeTruthy();
    });

    // Type in search box
    const searchInput = screen.getByPlaceholderText(/Search by SKU or product name/i);
    await user.type(searchInput, 'COFFEE');

    // Only coffee offer should remain
    expect(screen.queryByText('HONEY-ALPHA')).toBeNull();
    expect(screen.getByText('COFFEE-BETA')).toBeTruthy();
  });
});
