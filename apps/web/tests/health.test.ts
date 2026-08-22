import { describe, expect, it } from 'vitest';

describe('health route', () => {
  it('reports application and database health', async () => {
    process.env.APP_VERSION = 'test';
    const { createHealthHandler } = await import('../lib/health');
    const response = await createHealthHandler(async () => undefined)();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      database: 'ok',
      version: 'test',
    });
  });

  it('returns a degraded response when the database probe fails', async () => {
    const { createHealthHandler } = await import('../lib/health');
    const response = await createHealthHandler(async () => {
      throw new Error('database unavailable');
    })();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'degraded',
      database: 'error',
    });
  });
});
