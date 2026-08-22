import { describe, expect, it } from 'vitest';

describe('production website startup', () => {
  it('prepares the administrator before serving the website', async () => {
    const module = await import('../../../scripts/start-web').catch(() => ({}));
    expect(module).toHaveProperty('startProductionWeb');
    if (!('startProductionWeb' in module)) return;

    const events: string[] = [];
    await (module as {
      startProductionWeb(dependencies: {
        bootstrapAdmin(): Promise<void>;
        serveWeb(): Promise<void>;
      }): Promise<void>;
    }).startProductionWeb({
      async bootstrapAdmin() { events.push('administrator-ready'); },
      async serveWeb() { events.push('website-started'); },
    });

    expect(events).toEqual(['administrator-ready', 'website-started']);
  });
});
