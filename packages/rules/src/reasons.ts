export function percentage(value: number | null): string {
  return value === null ? '无数据' : `${Math.round(value * 10) / 10}%`;
}

export function projectAlertReason(code: string): string {
  const reasons: Record<string, string> = {
    NEEDS_COACHING: '当天数据标记为需辅导。',
    NOT_IMPROVED: '改善情况为“否”。',
    COACHING_BLANK: '是否辅导为空白。',
  };
  return reasons[code] ?? code;
}
