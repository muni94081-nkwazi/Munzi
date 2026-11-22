// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OffersTable } from '../OffersTable';
import type { ProductOffer } from '../../../types/offer.types';

function makeOffer(overrides: Partial<ProductOffer> = {}): ProductOffer {
  return {
    id: 'off-1',
    productId: 'prod-1',
    variantId: 'var-1',
    sellerId: 'seller-me',
    sellerSku: 'MY-SKU-100',
    price: 32000,
    compareAtPrice: 38000,
    currency: 'UGX',
    condition: 'NEW',
    conditionNote: 'Mint condition',
    moq: 1,
    wholesaleTiers: [{ minQuantity: 10, price: 29000 }],
    isBuyBoxWinner: false,
    status: 'ACTIVE',
    stock: 20,
    reserved: 2,
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

describe('OffersTable Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading indicator when isLoading is true', () => {
    render(
      <OffersTable
        offers={[]}
        isLoading={true}
        onUpdateOffer={vi.fn()}
        onDeleteOffer={vi.fn()}
      />,
    );

    expect(screen.getByText('Loading offers…')).toBeTruthy();
  });

  it('renders empty message when no offers exist', () => {
    render(
      <OffersTable
        offers={[]}
        isLoading={false}
        onUpdateOffer={vi.fn()}
        onDeleteOffer={vi.fn()}
      />,
    );

    expect(screen.getByText('No offers found')).toBeTruthy();
    expect(screen.getByText(/List a competing offer/i)).toBeTruthy();
  });

  it('renders offers with product details, price, condition, stock, and Buy Box status', () => {
    const offers = [
      makeOffer({ id: 'off-1', isBuyBoxWinner: true }),
      makeOffer({
        id: 'off-2',
        sellerSku: 'COMP-SKU-2',
        price: 35000,
        condition: 'REFURBISHED',
        isBuyBoxWinner: false,
      }),
    ];

    render(
      <OffersTable
        offers={offers}
        isLoading={false}
        onUpdateOffer={vi.fn()}
        onDeleteOffer={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Kasese Pure Wildflower Honey 1L')).toHaveLength(2);
    expect(screen.getByText('MY-SKU-100')).toBeTruthy();
    expect(screen.getByText('COMP-SKU-2')).toBeTruthy();
    expect(screen.getByText('Brand New')).toBeTruthy();
    expect(screen.getByText('Refurbished')).toBeTruthy();
    expect(screen.getByText('32,000')).toBeTruthy();
    expect(screen.getByText('35,000')).toBeTruthy();

    // Buy Box winner indicator
    expect(screen.getByTestId('buybox-winner-indicator')).toBeTruthy();
    expect(screen.getByText('🏆 Winner')).toBeTruthy();
    expect(screen.getByText('Competing')).toBeTruthy();
  });

  it('allows quick inline editing of price and stock', async () => {
    const user = userEvent.setup();
    const onUpdateOffer = vi.fn().mockResolvedValue(undefined);
    const offer = makeOffer({ id: 'off-1', price: 30000, stock: 15 });

    render(
      <OffersTable
        offers={[offer]}
        isLoading={false}
        onUpdateOffer={onUpdateOffer}
        onDeleteOffer={vi.fn()}
      />,
    );

    // Click "Quick Edit"
    await user.click(screen.getByRole('button', { name: /Quick Edit/i }));

    const priceInput = screen.getByLabelText(/Price for offer off-1/i);
    const stockInput = screen.getByLabelText(/Stock for offer off-1/i);

    expect((priceInput as HTMLInputElement).value).toBe('30000');
    expect((stockInput as HTMLInputElement).value).toBe('15');

    // Change values
    await user.clear(priceInput);
    await user.type(priceInput, '27500');

    await user.clear(stockInput);
    await user.type(stockInput, '25');

    // Click Save
    await user.click(screen.getByRole('button', { name: /Save/i }));

    expect(onUpdateOffer).toHaveBeenCalledTimes(1);
    expect(onUpdateOffer).toHaveBeenCalledWith('off-1', { price: 27500, stock: 25 });
  });

  it('validates against zero or negative price on quick edit', async () => {
    const user = userEvent.setup();
    const onUpdateOffer = vi.fn();
    const offer = makeOffer({ id: 'off-1', price: 30000 });

    render(
      <OffersTable
        offers={[offer]}
        isLoading={false}
        onUpdateOffer={onUpdateOffer}
        onDeleteOffer={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Quick Edit/i }));

    const priceInput = screen.getByLabelText(/Price for offer off-1/i);
    await user.clear(priceInput);
    await user.type(priceInput, '0');

    await user.click(screen.getByRole('button', { name: /Save/i }));

    expect(screen.getByText('Price must be greater than zero')).toBeTruthy();
    expect(onUpdateOffer).not.toHaveBeenCalled();
  });

  it('toggles offer status between ACTIVE and INACTIVE', async () => {
    const user = userEvent.setup();
    const onUpdateOffer = vi.fn().mockResolvedValue(undefined);
    const offer = makeOffer({ id: 'off-1', status: 'ACTIVE' });

    render(
      <OffersTable
        offers={[offer]}
        isLoading={false}
        onUpdateOffer={onUpdateOffer}
        onDeleteOffer={vi.fn()}
      />,
    );

    // Button should say "Deactivate" for active offer
    const toggleBtn = screen.getByRole('button', { name: /Deactivate/i });
    await user.click(toggleBtn);

    expect(onUpdateOffer).toHaveBeenCalledTimes(1);
    expect(onUpdateOffer).toHaveBeenCalledWith('off-1', { status: 'INACTIVE' });
  });

  it('confirms and calls onDeleteOffer when delete is clicked', async () => {
    const user = userEvent.setup();
    const onDeleteOffer = vi.fn().mockResolvedValue(undefined);
    const offer = makeOffer({ id: 'off-1' });

    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <OffersTable
        offers={[offer]}
        isLoading={false}
        onUpdateOffer={vi.fn()}
        onDeleteOffer={onDeleteOffer}
      />,
    );

    const deleteBtn = screen.getByRole('button', { name: /Delete/i });
    await user.click(deleteBtn);

    expect(window.confirm).toHaveBeenCalled();
    expect(onDeleteOffer).toHaveBeenCalledTimes(1);
    expect(onDeleteOffer).toHaveBeenCalledWith('off-1');
  });
});
