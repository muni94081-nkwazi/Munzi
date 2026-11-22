// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const searchCatalog = vi.fn();
const getProductVariants = vi.fn();
const createOffer = vi.fn();

vi.mock('../../api/offers.api', () => ({
  offersApi: {
    searchCatalog: (...args: unknown[]) => searchCatalog(...args),
    getProductVariants: (...args: unknown[]) => getProductVariants(...args),
    create: (...args: unknown[]) => createOffer(...args),
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

const { OfferCreatePage } = await import('../OfferCreatePage');

describe('OfferCreatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders catalogue search step initially', () => {
    render(
      <MemoryRouter>
        <OfferCreatePage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/List Competing Offer Against Existing Product/i)).toBeTruthy();
    expect(screen.getByText(/Step 1: Find Existing Catalogue Product/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Search by product title, brand, or SKU/i)).toBeTruthy();
  });

  it('searches the catalogue and selects a product to view variants', async () => {
    const user = userEvent.setup();
    searchCatalog.mockResolvedValueOnce([
      {
        id: 'prod-honey-1',
        name: 'Kasese Pure Wildflower Honey 1L',
        price: 35000,
      },
    ]);

    getProductVariants.mockResolvedValueOnce([
      {
        id: 'var-1',
        sku: 'HNY-1L',
        price: 35000,
        attributes: { size: '1L' },
      },
      {
        id: 'var-2',
        sku: 'HNY-500ML',
        price: 20000,
        attributes: { size: '500ml' },
      },
    ]);

    render(
      <MemoryRouter>
        <OfferCreatePage />
      </MemoryRouter>,
    );

    // Type query and search
    const searchInput = screen.getByPlaceholderText(/Search by product title, brand, or SKU/i);
    await user.type(searchInput, 'honey');
    await user.click(screen.getByRole('button', { name: /^Search$/i }));

    // Search results displayed
    await waitFor(() => {
      expect(screen.getByText('Kasese Pure Wildflower Honey 1L')).toBeTruthy();
    });

    // Select product
    const selectBtn = screen.getByRole('button', { name: /Select Product/i });
    await user.click(selectBtn);

    // Product is selected and variants loaded
    await waitFor(() => {
      expect(screen.getByText(/Step 2: Variant & Offer Details/i)).toBeTruthy();
    });

    expect(getProductVariants).toHaveBeenCalledWith('prod-honey-1');
    expect(screen.getByText(/HNY-1L/)).toBeTruthy();
    expect(screen.getByText(/HNY-500ML/)).toBeTruthy();
  });

  it('allows adding wholesale tiers and validates compare-at price', async () => {
    const user = userEvent.setup();
    searchCatalog.mockResolvedValueOnce([
      { id: 'prod-honey-1', name: 'Kasese Pure Honey 1L', price: 35000 },
    ]);
    getProductVariants.mockResolvedValueOnce([
      { id: 'var-1', sku: 'HNY-1L', price: 35000 },
    ]);

    render(
      <MemoryRouter>
        <OfferCreatePage />
      </MemoryRouter>,
    );

    // Select product
    await user.type(screen.getByPlaceholderText(/Search by product title/i), 'honey');
    await user.click(screen.getByRole('button', { name: /^Search$/i }));
    await waitFor(() => expect(screen.getByText(/Select Product/i)).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Select Product/i }));

    await waitFor(() => expect(screen.getByText(/Step 2: Variant & Offer Details/i)).toBeTruthy());

    // Set price lower than compare-at
    const priceInput = screen.getByPlaceholderText('e.g. 35000');
    await user.clear(priceInput);
    await user.type(priceInput, '30000');

    const compareAtInput = screen.getByPlaceholderText('Optional, e.g. 40000');
    await user.type(compareAtInput, '25000'); // Invalid: compareAt < price

    // Try submitting
    await user.click(screen.getByRole('button', { name: /Publish Competing Offer/i }));

    expect(screen.getByText(/Compare-at price must be greater than or equal to selling price/i)).toBeTruthy();
    expect(createOffer).not.toHaveBeenCalled();

    // Fix compareAt
    await user.clear(compareAtInput);
    await user.type(compareAtInput, '35000');

    // Add Wholesale Tier
    const minQtyInput = screen.getByPlaceholderText('e.g. 10');
    const tierPriceInput = screen.getByPlaceholderText('e.g. 30000');
    await user.type(minQtyInput, '10');
    await user.type(tierPriceInput, '27000');
    await user.click(screen.getByRole('button', { name: /Add Tier/i }));

    // Tier is rendered in table
    expect(screen.getByText('10+ units')).toBeTruthy();
    expect(screen.getByText(/27,000/)).toBeTruthy();

    // Now submit
    createOffer.mockResolvedValueOnce({ id: 'off-new-1', price: 30000 });
    await user.click(screen.getByRole('button', { name: /Publish Competing Offer/i }));

    await waitFor(() => expect(createOffer).toHaveBeenCalledTimes(1));
    expect(createOffer.mock.calls[0][0]).toMatchObject({
      productId: 'prod-honey-1',
      variantId: 'var-1',
      price: 30000,
      compareAtPrice: 35000,
      condition: 'NEW',
      wholesaleTiers: [{ minQuantity: 10, price: 27000 }],
    });

    expect(mockNavigate).toHaveBeenCalledWith('/offers');
  });
});
