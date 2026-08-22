import { describe, expect, it } from 'vitest';

type PeriodModule = {
  getPeriodBounds: (
    date: Date,
    grain: 'DAY' | 'WEEK' | 'MONTH',
  ) => { start: Date; end: Date; label: string };
};

async function loadPeriodModule(): Promise<Partial<PeriodModule>> {
  return import('../src/period').catch(() => ({}));
}

describe('Asia/Shanghai reporting periods', () => {
  it('uses Sunday through Saturday for a weekly period', async () => {
    const module = await loadPeriodModule();
    expect(module).toHaveProperty('getPeriodBounds');

    const period = module.getPeriodBounds?.(new Date('2026-08-21T10:00:00+08:00'), 'WEEK');
    expect(period).toEqual({
      start: new Date('2026-08-16T00:00:00+08:00'),
      end: new Date('2026-08-22T23:59:59.999+08:00'),
      label: '2026-08-16—2026-08-22',
    });
  });

  it('starts a new weekly period on Sunday', async () => {
    const { getPeriodBounds } = (await loadPeriodModule()) as PeriodModule;
    const period = getPeriodBounds(new Date('2026-08-23T00:01:00+08:00'), 'WEEK');

    expect(period.start).toEqual(new Date('2026-08-23T00:00:00+08:00'));
    expect(period.end).toEqual(new Date('2026-08-29T23:59:59.999+08:00'));
  });

  it('returns calendar day and month boundaries in Shanghai time', async () => {
    const { getPeriodBounds } = (await loadPeriodModule()) as PeriodModule;

    expect(getPeriodBounds(new Date('2026-08-21T23:30:00+08:00'), 'DAY')).toEqual({
      start: new Date('2026-08-21T00:00:00+08:00'),
      end: new Date('2026-08-21T23:59:59.999+08:00'),
      label: '2026-08-21',
    });
    expect(getPeriodBounds(new Date('2026-08-21T10:00:00+08:00'), 'MONTH')).toEqual({
      start: new Date('2026-08-01T00:00:00+08:00'),
      end: new Date('2026-08-31T23:59:59.999+08:00'),
      label: '2026-08',
    });
  });
});
