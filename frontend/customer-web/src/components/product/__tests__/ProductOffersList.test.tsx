// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductOffersList } from '../ProductOffersList';
import type { ProductOffer } from '@/types/product.types';

// Mock useCurrency to return simple formatted strings
vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => ({
    format: (amount: number) => `UGX ${Number(amount).toLocaleString()}`,
  }),
}));

const getStore = vi.fn();
vi.mock('@/api/storefront.api', () => ({
  storefrontApi: {
    getStore: (...args: unknown[]) => getStore(...args),
  },
}));

function makeOffer(overrides: Partial<ProductOffer> = {}): ProductOffer {
  return {
    id: 'off-1',
    productId: 'prod-1',
    variantId: 'var-1',
    sellerId: 'seller-alpha',
    sellerSku: 'ALPHA-SKU-1',
    price: 32000,
    compareAtPrice: 35000,
    currency: 'UGX',
    condition: 'NEW',
    conditionNote: null,
    moq: 1,
    wholesaleTiers: null,
    isBuyBoxWinner: false,
    status: 'ACTIVE',
    isInStock: true,
    stock: 15,
    reserved: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ProductOffersList — Multi-Vendor Comparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStore.mockResolvedValue({
      userId: 'seller-alpha',
      storeName: 'Alpha Tech Store',
      rating: 4.8,
      verificationStatus: 'verified',
    });
  });

  it('renders nothing when offers array is empty', () => {
    const { container } = render(<ProductOffersList offers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders competing offers with price, condition, and seller info', async () => {
    const offers = [
      makeOffer({ id: 'off-1', price: 30000, isBuyBoxWinner: true }),
      makeOffer({
        id: 'off-2',
        sellerId: 'seller-beta',
        sellerSku: 'BETA-SKU',
        price: 34000,
        condition: 'USED_LIKE_NEW',
        isBuyBoxWinner: false,
      }),
    ];

    render(<ProductOffersList offers={offers} selectedOfferId="off-1" />);

    expect(screen.getByRole('heading', { level: 3, name: /Other Sellers on Muni/i })).toBeTruthy();
    expect(screen.getByText('2 offers')).toBeTruthy();

    expect(screen.getByText('UGX 30,000')).toBeTruthy();
    expect(screen.getByText('UGX 34,000')).toBeTruthy();
    expect(screen.getByText('Brand New')).toBeTruthy();
    expect(screen.getByText('Used - Like New')).toBeTruthy();
  });

  it('displays "Best Offer" badge on the Buy Box winner', () => {
    const offers = [
      makeOffer({ id: 'off-winner', price: 29000, isBuyBoxWinner: true }),
      makeOffer({ id: 'off-runnerup', price: 31000, isBuyBoxWinner: false }),
    ];

    render(<ProductOffersList offers={offers} selectedOfferId="off-winner" />);

    const badge = screen.getByText('Best Offer');
    expect(badge).toBeTruthy();
  });

  it('allows user to select an alternative seller offer', async () => {
    const user = userEvent.setup();
    const onSelectOffer = vi.fn();

    const offers = [
      makeOffer({ id: 'off-1', price: 30000, isBuyBoxWinner: true }),
      makeOffer({ id: 'off-2', sellerId: 'seller-beta', price: 32000, isBuyBoxWinner: false }),
    ];

    render(
      <ProductOffersList
        offers={offers}
        selectedOfferId="off-1"
        onSelectOffer={onSelectOffer}
      />,
    );

    // The selected button is disabled and says "Selected"
    const selectedBtn = screen.getByRole('button', { name: /Selected offer from/i });
    expect(selectedBtn.textContent).toBe('Selected');
    expect(selectedBtn).toBeDisabled();

    // The alternative button is enabled
    const selectBtn = screen.getByRole('button', { name: /Select offer from/i });
    expect(selectBtn).not.toBeDisabled();

    await user.click(selectBtn);
    expect(onSelectOffer).toHaveBeenCalledTimes(1);
    expect(onSelectOffer).toHaveBeenCalledWith(offers[1]);
  });

  it('disables actions for out-of-stock offers', () => {
    const offers = [
      makeOffer({ id: 'off-oos', isInStock: false, stock: 0 }),
    ];

    render(
      <ProductOffersList
        offers={offers}
        selectedOfferId={null}
        onSelectOffer={vi.fn()}
        onAddToCartOffer={vi.fn()}
      />,
    );

    expect(screen.getByText('Out of Stock')).toBeTruthy();
    const selectBtn = screen.getByRole('button', { name: /Select offer from/i });
    expect(selectBtn).toBeDisabled();

    const buyBtn = screen.getByRole('button', { name: /Buy from/i });
    expect(buyBtn).toBeDisabled();
  });

  it('allows direct "Buy from Seller" click', async () => {
    const user = userEvent.setup();
    const onAddToCartOffer = vi.fn();

    const offers = [
      makeOffer({ id: 'off-1', sellerId: 'seller-direct', price: 35000 }),
    ];

    render(
      <ProductOffersList
        offers={offers}
        selectedOfferId={null}
        onAddToCartOffer={onAddToCartOffer}
      />,
    );

    const buyBtn = screen.getByRole('button', { name: /Buy from/i });
    await user.click(buyBtn);

    expect(onAddToCartOffer).toHaveBeenCalledTimes(1);
    expect(onAddToCartOffer).toHaveBeenCalledWith(offers[0]);
  });
});
