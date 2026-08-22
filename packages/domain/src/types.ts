export type PeriodGrain = 'DAY' | 'WEEK' | 'MONTH';

export type PeriodBounds = {
  start: Date;
  end: Date;
  label: string;
};

export type SopFields = {
  followWithin30m: boolean | null;
  needsAnalyzed: boolean | null;
  hardInvite: boolean | null;
};
