'use client';

import React, { useEffect, useState } from 'react';
import { DashboardView, type DashboardData } from '../components/dashboard/dashboard-view';
import { useOperationsFilters } from '../components/filters/use-operations-filters';
import { AppShell } from '../components/navigation/app-shell';
import type { OperationsFilterOptions } from '../lib/queries/operations-filters';

export default function Page() {
  const filters = useOperationsFilters();
  const [data, setData] = useState<DashboardData | null>(null);
  const [filterOptions, setFilterOptions] = useState<OperationsFilterOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    const query = filters.toSearchParams().toString();
    void fetch(`/api/dashboard?${query}`).then(async (response) => {
      if (!response.ok) throw new Error('首页数据加载失败');
      setData(await response.json() as DashboardData);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  useEffect(load, [
    filters.value.source,
    filters.value.regionId,
    filters.value.cityId,
    filters.value.merchantId,
  ]);
  useEffect(() => {
    void fetch(`/api/filters/operations?source=${filters.value.source}`)
      .then(async (response) => {
        if (response.ok) setFilterOptions(await response.json() as OperationsFilterOptions);
      });
  }, [filters.value.source]);
  return (
    <AppShell>
      {data ? <DashboardView data={data} filters={filters} filterOptions={filterOptions ?? undefined} /> : (
        <section className="loading-state"><p className="eyebrow">运营预警工作台</p><h1>今日需要关注什么？</h1><p>{error ?? '加载运营数据…'}</p>{error && <button onClick={load}>重试</button>}</section>
      )}
    </AppShell>
  );
}

