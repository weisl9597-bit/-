import type { PeriodBounds, PeriodGrain } from './types';

const SHANGHAI_OFFSET_HOURS = 8;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const weekdayIndex: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

type LocalDate = {
  year: number;
  month: number;
  day: number;
  weekday: number;
};

const shanghaiFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
});

function localDateParts(date: Date): LocalDate {
  const parts = Object.fromEntries(
    shanghaiFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayIndex[parts.weekday ?? 'Sun'] ?? 0,
  };
}

function shiftLocalDate(local: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

function startOfLocalDay(local: Pick<LocalDate, 'year' | 'month' | 'day'>): Date {
  return new Date(Date.UTC(local.year, local.month - 1, local.day, -SHANGHAI_OFFSET_HOURS));
}

function formatLocalDate(local: Pick<LocalDate, 'year' | 'month' | 'day'>): string {
  return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
}

export function getPeriodBounds(date: Date, grain: PeriodGrain): PeriodBounds {
  const local = localDateParts(date);

  if (grain === 'DAY') {
    const start = startOfLocalDay(local);
    return { start, end: new Date(start.getTime() + ONE_DAY_MS - 1), label: formatLocalDate(local) };
  }

  if (grain === 'WEEK') {
    const first = shiftLocalDate(local, -local.weekday);
    const last = shiftLocalDate(first, 6);
    const start = startOfLocalDay(first);
    return {
      start,
      end: new Date(start.getTime() + (7 * ONE_DAY_MS) - 1),
      label: `${formatLocalDate(first)}—${formatLocalDate(last)}`,
    };
  }

  const first = { year: local.year, month: local.month, day: 1 };
  const nextMonth = local.month === 12
    ? { year: local.year + 1, month: 1, day: 1 }
    : { year: local.year, month: local.month + 1, day: 1 };
  const start = startOfLocalDay(first);
  const end = new Date(startOfLocalDay(nextMonth).getTime() - 1);
  return {
    start,
    end,
    label: `${local.year}-${String(local.month).padStart(2, '0')}`,
  };
}
