import { describe, expect, it } from 'vitest';

type SopModule = {
  isSopCompliant: (input: {
    followWithin30m: boolean | null;
    needsAnalyzed: boolean | null;
    hardInvite: boolean | null;
  }) => boolean;
};

async function loadSopModule(): Promise<Partial<SopModule>> {
  return import('../src/sop').catch(() => ({}));
}

describe('designbao SOP compliance', () => {
  it('accepts only follow=yes, analysis=yes and hard invite=no', async () => {
    const module = await loadSopModule();
    expect(module).toHaveProperty('isSopCompliant');

    const isSopCompliant = module.isSopCompliant as SopModule['isSopCompliant'];
    expect(isSopCompliant({ followWithin30m: true, needsAnalyzed: true, hardInvite: false })).toBe(true);
    expect(isSopCompliant({ followWithin30m: true, needsAnalyzed: true, hardInvite: true })).toBe(false);
    expect(isSopCompliant({ followWithin30m: false, needsAnalyzed: true, hardInvite: false })).toBe(false);
    expect(isSopCompliant({ followWithin30m: true, needsAnalyzed: false, hardInvite: false })).toBe(false);
  });

  it('does not treat blank source values as compliant', async () => {
    const { isSopCompliant } = (await loadSopModule()) as SopModule;

    expect(isSopCompliant({ followWithin30m: null, needsAnalyzed: true, hardInvite: false })).toBe(false);
    expect(isSopCompliant({ followWithin30m: true, needsAnalyzed: null, hardInvite: false })).toBe(false);
    expect(isSopCompliant({ followWithin30m: true, needsAnalyzed: true, hardInvite: null })).toBe(false);
  });
});
