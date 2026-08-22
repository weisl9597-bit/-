import type { SopFields } from './types';

export function isSopCompliant(input: SopFields): boolean {
  return input.followWithin30m === true
    && input.needsAnalyzed === true
    && input.hardInvite === false;
}
