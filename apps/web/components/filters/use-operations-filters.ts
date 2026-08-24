'use client';

import type { SelectableBusinessSource } from '@designbao/domain/business-source';
import { useState } from 'react';
import { parseOperationsFilter, type OperationsFilter } from '../../lib/queries/operations-filters';

export type OperationsFilterController = {
  readonly value: OperationsFilter;
  setSource(source: SelectableBusinessSource): void;
  setRegion(regionId: string): void;
  setCity(cityId: string): void;
  setMerchant(merchantId: string): void;
  toSearchParams(extra?: Record<string, string>): URLSearchParams;
};

function paramsFor(value: OperationsFilter, extra: Record<string, string> = {}) {
  const params = new URLSearchParams(extra);
  params.set('source', value.source);
  for (const [key, selected] of [
    ['regionId', value.regionId], ['cityId', value.cityId], ['merchantId', value.merchantId],
  ] as const) {
    if (selected) params.set(key, selected); else params.delete(key);
  }
  return params;
}

export function createOperationsFilterController(
  getValue: () => OperationsFilter,
  setValue: (next: OperationsFilter) => void,
  replaceSearch: (params: URLSearchParams) => void,
): OperationsFilterController {
  const commit = (next: OperationsFilter) => {
    setValue(next);
    replaceSearch(paramsFor(next));
  };
  return {
    get value() { return getValue(); },
    setSource(source) { commit({ source }); },
    setRegion(regionId) {
      commit({ source: getValue().source, ...(regionId ? { regionId } : {}) });
    },
    setCity(cityId) {
      const current = getValue();
      commit({ source: current.source, ...(current.regionId ? { regionId: current.regionId } : {}), ...(cityId ? { cityId } : {}) });
    },
    setMerchant(merchantId) {
      const current = getValue();
      const { merchantId: _currentMerchantId, ...upstream } = current;
      commit(merchantId ? { ...upstream, merchantId } : upstream);
    },
    toSearchParams(extra) { return paramsFor(getValue(), extra); },
  };
}

export function useOperationsFilters(): OperationsFilterController {
  const [value, setValue] = useState<OperationsFilter>(() => (
    typeof window === 'undefined'
      ? { source: 'DESIGNBAO' }
      : parseOperationsFilter(new URL(window.location.href))
  ));
  return createOperationsFilterController(
    () => value,
    setValue,
    (params) => {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      for (const key of ['source', 'regionId', 'cityId', 'merchantId']) url.searchParams.delete(key);
      params.forEach((selected, key) => url.searchParams.set(key, selected));
      window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
      window.dispatchEvent(new Event('operations-filter-change'));
    },
  );
}
