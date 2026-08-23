'use client';

import React, { useEffect, useState } from 'react';
import type { OperationsFilterOptions } from '../../lib/queries/operations-filters';
import { RebuildBanner } from './rebuild-banner';
import {
  useOperationsFilters,
  type OperationsFilterController,
} from './use-operations-filters';

export function OperationsFilterBar({
  controller: suppliedController,
  options: suppliedOptions,
}: {
  controller?: OperationsFilterController;
  options?: OperationsFilterOptions;
} = {}) {
  const defaultController = useOperationsFilters();
  const controller = suppliedController ?? defaultController;
  const [loadedOptions, setLoadedOptions] = useState<OperationsFilterOptions | null>(suppliedOptions ?? null);
  useEffect(() => {
    if (suppliedOptions) return;
    void fetch(`/api/filters/operations?source=${controller.value.source}`)
      .then(async (response) => {
        if (response.ok) setLoadedOptions(await response.json() as OperationsFilterOptions);
      });
  }, [controller.value.source, suppliedOptions]);
  const options = suppliedOptions ?? loadedOptions;
  const regions = options?.regions ?? [];
  const cities = (options?.cities ?? []).filter((city) => (
    !controller.value.regionId || city.parentId === controller.value.regionId
  ));
  const cityIds = new Set(cities.map((city) => city.id));
  const merchants = (options?.merchants ?? []).filter((merchant) => (
    controller.value.cityId
      ? merchant.organizationId === controller.value.cityId
      : !controller.value.regionId || cityIds.has(merchant.organizationId)
  ));
  return <section className="operations-filter-shell">
    {options && <RebuildBanner status={options.rebuildStatus} />}
    <div className="operations-filter-bar">
      <label><span>业务来源</span><select aria-label="业务来源" value={controller.value.source} onChange={(event) => controller.setSource(event.target.value as 'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL')}>
        <option value="DESIGNBAO">设计宝</option><option value="XIAOHONGSHU">小红书</option><option value="ALL">全部业务</option>
      </select></label>
      <label><span>大区</span><select aria-label="大区" value={controller.value.regionId ?? ''} onChange={(event) => controller.setRegion(event.target.value)}><option value="">全部大区</option>{regions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>城市</span><select aria-label="城市" value={controller.value.cityId ?? ''} onChange={(event) => controller.setCity(event.target.value)}><option value="">全部城市</option>{cities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>商家</span><select aria-label="商家" value={controller.value.merchantId ?? ''} onChange={(event) => controller.setMerchant(event.target.value)}><option value="">全部商家</option>{merchants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
  </section>;
}

