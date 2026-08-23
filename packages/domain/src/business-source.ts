export type ActualBusinessSource = 'DESIGNBAO' | 'XIAOHONGSHU' | 'OTHER';

export type SelectableBusinessSource = 'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL';

export function normalizeBusinessSource(value: unknown): ActualBusinessSource {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === '设计宝') return 'DESIGNBAO';
  if (normalized === '小红书') return 'XIAOHONGSHU';
  return 'OTHER';
}

