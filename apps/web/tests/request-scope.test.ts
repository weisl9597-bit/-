import { afterEach, describe, expect, it, vi } from 'vitest';
import { badRequest } from '../lib/api/request-scope';

afterEach(() => vi.restoreAllMocks());

describe('public API error boundary', () => {
  it('maps scope failures to a stable forbidden response', async () => {
    const response = badRequest(new Error('MERCHANT_OUT_OF_SCOPE'));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'FORBIDDEN_FILTER' });
  });

  it('does not expose unexpected internal error messages', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = badRequest(new Error('password=super-secret database connection failed'));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe('{"error":"INTERNAL_ERROR"}');
    expect(body).not.toContain('super-secret');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('super-secret');
  });
});
