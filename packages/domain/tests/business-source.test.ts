import { describe, expect, it } from 'vitest';

import { normalizeBusinessSource } from '../src/business-source';

describe('normalizeBusinessSource', () => {
  it.each([
    ['设计宝', 'DESIGNBAO'],
    [' 设计宝 ', 'DESIGNBAO'],
    ['小红书', 'XIAOHONGSHU'],
    ['DESIGNBAO', 'DESIGNBAO'],
    ['xiaohongshu', 'XIAOHONGSHU'],
    ['未知渠道', 'OTHER'],
    [null, 'OTHER'],
  ] as const)('maps %j to %s', (input, expected) => {
    expect(normalizeBusinessSource(input)).toBe(expected);
  });
});

