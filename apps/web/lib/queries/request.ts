import { z } from 'zod';
import type { MerchantListQuery } from './merchants';
import type { MetricCenterQuery } from './metrics';
import { parseOperationsFilter } from './operations-filters';
import type { ProjectListQuery } from './projects';
export { parseOperationsFilter } from './operations-filters';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((value) => new Date(`${value}T00:00:00.000Z`));
const classification = z.enum(['A', 'A_RISK', 'B', 'C_CANDIDATE', 'C', 'ELIMINATED']);

function optionalInteger(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  if (value === null || value === '') return undefined;
  return z.coerce.number().int().positive().parse(value);
}

function triState(value: string | null): boolean | null | undefined {
  if (value === null || value === '') return undefined;
  if (value === 'blank') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid tri-state value: ${value}`);
}

function optionalDate(url: URL, name: string): Date | undefined {
  const value = url.searchParams.get(name);
  return value ? date.parse(value) : undefined;
}

export function parseMetricRequest(url: URL): MetricCenterQuery {
  const ids = (url.searchParams.get('metricIds') ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error('metricIds is required');
  const today = new Date();
  const defaultEnd = today.toISOString().slice(0, 10);
  const defaultStartDate = new Date(today);
  defaultStartDate.setUTCDate(defaultStartDate.getUTCDate() - 29);
  const operations = parseOperationsFilter(url);
  return {
    ...operations,
    metricIds: ids,
    grain: z.enum(['DAY', 'WEEK', 'MONTH']).parse(url.searchParams.get('grain') ?? 'DAY'),
    start: date.parse(url.searchParams.get('start') ?? defaultStartDate.toISOString().slice(0, 10)),
    end: date.parse(url.searchParams.get('end') ?? defaultEnd),
  };
}

export function parseMerchantRequest(url: URL): MerchantListQuery {
  const classificationValue = url.searchParams.get('classification');
  return {
    ...parseOperationsFilter(url),
    cursor: url.searchParams.get('cursor'),
    limit: optionalInteger(url, 'limit'),
    search: url.searchParams.get('search') || undefined,
    classification: classificationValue ? classification.parse(classificationValue) : undefined,
  };
}

export function parseProjectRequest(url: URL): ProjectListQuery {
  const abnormal = url.searchParams.get('abnormal');
  if (abnormal !== null && !['true', 'false'].includes(abnormal)) {
    throw new Error('Invalid abnormal value');
  }
  const alertValue = url.searchParams.get('alert');
  const alert = alertValue === null || alertValue === ''
    ? undefined
    : z.enum(['COACHING', 'IMPROVEMENT', 'ABNORMAL']).parse(alertValue);
  const assignedFrom = optionalDate(url, 'assignedFrom');
  const assignedTo = optionalDate(url, 'assignedTo');
  if (assignedFrom && assignedTo && assignedFrom >= assignedTo) {
    throw new Error('assignedFrom must be before assignedTo');
  }
  return {
    ...parseOperationsFilter(url),
    cursor: url.searchParams.get('cursor'),
    limit: optionalInteger(url, 'limit'),
    abnormal: abnormal === null ? undefined : abnormal === 'true',
    alert,
    assignedFrom,
    assignedTo,
    merchantId: url.searchParams.get('merchantId') || undefined,
    coached: triState(url.searchParams.get('coached')),
    improved: triState(url.searchParams.get('improved')),
  };
}

