/**
 * Offer Routing & Authorization Test Suite (Gate 3A)
 *
 * Verifies that the API Gateway exposes ProductOffer endpoints to the appropriate
 * actors while enforcing role-based access control:
 *
 * 1. Public Customers:
 *    - GET /api/v1/offers/:id is public and proxies to product-service.
 *    - POST/PUT/DELETE /api/v1/offers is refused with 405 (read-only mount).
 * 2. Sellers:
 *    - POST /api/v1/seller/offers requires ROLE_SELLER and proxies to product-service.
 *    - GET /api/v1/seller/offers requires ROLE_SELLER and proxies to product-service.
 *    - Anonymous callers receive 401.
 *    - Customers (ROLE_CUSTOMER) receive 403.
 * 3. Administrators:
 *    - GET /api/v1/admin/offers requires ROLE_ADMIN and proxies to product-service.
 *    - PATCH /api/v1/admin/offers/:id/moderate requires ROLE_ADMIN.
 *    - Sellers receive 403 on admin routes.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import http from 'node:http';
import { Socket } from 'node:net';

process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';
process.env.INTERNAL_IDENTITY_SECRET = 'test-internal-identity-secret-32-chars-plus';

const proxy = jest.fn((_req: any, res: any, target: string) => {
  res.status(200).json({ proxiedTo: target });
});

jest.unstable_mockModule('../utils/proxy.js', () => ({
  proxy,
  registerTargets: jest.fn(),
}));

const { createAccessToken } = await import('../../../shared/utils/token.js');
const { customerRoutes } = await import('../routes/customer.routes.js');
const { sellerRoutes }   = await import('../routes/seller.routes.js');
const { adminRoutes }    = await import('../routes/admin.routes.js');
const { optionalAuth, stripClientIdentity } = await import('../middleware/auth.middleware.js');

const TARGETS: Record<string, string> = new Proxy(
  { product: 'http://product-service:4002' },
  { get: (t: any, k: string) => t[k] ?? `http://${String(k)}-service` },
);

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use(stripClientIdentity);
  app.use(optionalAuth);
  app.use('/api/v1',        customerRoutes(TARGETS));
  app.use('/api/v1/seller', sellerRoutes(TARGETS));
  app.use('/api/v1/admin',  adminRoutes(TARGETS));
  app.use((_req, res) => { res.status(404).json({ error: 'NOT_FOUND' }); });
  return app;
}

const app = buildApp();

function dispatch(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  token?: string,
  body?: any,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const sock = new Socket();
    const req = new http.IncomingMessage(sock);
    req.method = method;
    req.url = path;
    req.headers = {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
    if (body) {
      (req as any).body = body;
    }

    const res = new http.ServerResponse(req);
    let capturedBody = '';
    res.write = (chunk: any) => {
      if (chunk) capturedBody += chunk.toString();
      return true;
    };
    res.end = (chunk: any) => {
      if (chunk) capturedBody += chunk.toString();
      let parsed = capturedBody;
      try { parsed = JSON.parse(capturedBody); } catch {}
      resolve({ status: res.statusCode, body: parsed });
      return res;
    };

    (app as any).handle(req, res, () => {
      resolve({ status: 404, body: null });
    });
  });
}

const customerToken = createAccessToken('customer-1', ['ROLE_CUSTOMER']);
const sellerToken   = createAccessToken('seller-1',   ['ROLE_SELLER']);
const adminToken    = createAccessToken('admin-1',    ['ROLE_ADMIN']);

beforeEach(() => {
  proxy.mockClear();
});

describe('Gate 3A: Public Customer Offer Discovery (/api/v1/offers)', () => {
  it('allows an anonymous shopper to read an offer by id', async () => {
    const { status } = await dispatch('GET', '/api/v1/offers/off-123');

    expect(status).toBe(200);
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][2]).toBe('http://product-service:4002');
  });

  it('rejects POST /api/v1/offers with 405 Method Not Allowed (read-only prefix)', async () => {
    const { status, body } = await dispatch('POST', '/api/v1/offers', undefined, { price: 1000 });

    expect(status).toBe(405);
    expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
    expect(proxy).not.toHaveBeenCalled();
  });

  it('rejects DELETE /api/v1/offers/off-123 on the public prefix with 405', async () => {
    const { status, body } = await dispatch('DELETE', '/api/v1/offers/off-123');

    expect(status).toBe(405);
    expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
    expect(proxy).not.toHaveBeenCalled();
  });
});

describe('Gate 3A: Seller Offer Management (/api/v1/seller/offers)', () => {
  it('returns 401 to an unauthenticated caller attempting to create an offer', async () => {
    const { status, body } = await dispatch('POST', '/api/v1/seller/offers');

    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(proxy).not.toHaveBeenCalled();
  });

  it('returns 403 to a customer attempting to create an offer', async () => {
    const { status, body } = await dispatch('POST', '/api/v1/seller/offers', customerToken);

    expect(status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(proxy).not.toHaveBeenCalled();
  });

  it('proxies POST /api/v1/seller/offers to product-service for an authenticated seller', async () => {
    const { status } = await dispatch('POST', '/api/v1/seller/offers', sellerToken, {
      productId: 'prod-1',
      variantId: 'var-1',
      price: 50000,
    });

    expect(status).toBe(200);
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][2]).toBe('http://product-service:4002');
  });

  it('proxies GET /api/v1/seller/offers to product-service for an authenticated seller', async () => {
    const { status } = await dispatch('GET', '/api/v1/seller/offers', sellerToken);

    expect(status).toBe(200);
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][2]).toBe('http://product-service:4002');
  });

  it('proxies PUT /api/v1/seller/offers/:id to product-service for an authenticated seller', async () => {
    const { status } = await dispatch('PUT', '/api/v1/seller/offers/off-1', sellerToken, { price: 48000 });

    expect(status).toBe(200);
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][2]).toBe('http://product-service:4002');
  });

  it('proxies DELETE /api/v1/seller/offers/:id to product-service for an authenticated seller', async () => {
    const { status } = await dispatch('DELETE', '/api/v1/seller/offers/off-1', sellerToken);

    expect(status).toBe(200);
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][2]).toBe('http://product-service:4002');
  });
});

describe('Gate 3A: Admin Offer Moderation (/api/v1/admin/offers)', () => {
  it('returns 401 to an anonymous caller attempting to view admin offers', async () => {
    const { status, body } = await dispatch('GET', '/api/v1/admin/offers');

    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(proxy).not.toHaveBeenCalled();
  });

  it('returns 403 to a seller attempting to access admin offers', async () => {
    const { status, body } = await dispatch('GET', '/api/v1/admin/offers', sellerToken);

    expect(status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(proxy).not.toHaveBeenCalled();
  });

  it('proxies GET /api/v1/admin/offers to product-service for an administrator', async () => {
    const { status } = await dispatch('GET', '/api/v1/admin/offers', adminToken);

    expect(status).toBe(200);
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][2]).toBe('http://product-service:4002');
  });

  it('proxies PATCH /api/v1/admin/offers/:id/moderate to product-service for an administrator', async () => {
    const { status } = await dispatch('PATCH', '/api/v1/admin/offers/off-1/moderate', adminToken, {
      status: 'SUSPENDED',
      reason: 'Counterfeit check',
    });

    expect(status).toBe(200);
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][2]).toBe('http://product-service:4002');
  });
});

describe('Gate 3B.1: Admin Buy Box Recalculation Route (/api/v1/admin/buybox/recalculate)', () => {
  it('returns 401 to an anonymous caller attempting to recalculate Buy Box', async () => {
    const { status, body } = await dispatch('POST', '/api/v1/admin/buybox/recalculate', undefined, { variantId: 'var-1' });

    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(proxy).not.toHaveBeenCalled();
  });

  it('returns 403 to a customer attempting to recalculate Buy Box', async () => {
    const { status, body } = await dispatch('POST', '/api/v1/admin/buybox/recalculate', customerToken, { variantId: 'var-1' });

    expect(status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(proxy).not.toHaveBeenCalled();
  });

  it('returns 403 to a seller attempting to recalculate Buy Box', async () => {
    const { status, body } = await dispatch('POST', '/api/v1/admin/buybox/recalculate', sellerToken, { variantId: 'var-1' });

    expect(status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(proxy).not.toHaveBeenCalled();
  });

  it('proxies POST /api/v1/admin/buybox/recalculate to product-service for an administrator', async () => {
    const { status } = await dispatch('POST', '/api/v1/admin/buybox/recalculate', adminToken, { variantId: 'var-1' });

    expect(status).toBe(200);
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][2]).toBe('http://product-service:4002');
  });
});
