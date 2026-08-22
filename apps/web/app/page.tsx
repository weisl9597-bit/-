'use client';

import React, { useEffect, useState } from 'react';
import { DashboardView, type DashboardData } from '../components/dashboard/dashboard-view';
import { AppShell } from '../components/navigation/app-shell';

export default function Page() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    void fetch('/api/dashboard').then(async (response) => {
      if (!response.ok) throw new Error('首页数据加载失败');
      setData(await response.json() as DashboardData);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  useEffect(load, []);
  return (
    <AppShell>
      {data ? <DashboardView data={data} /> : (
        <section className="loading-state"><p className="eyebrow">运营预警工作台</p><h1>今日需要关注什么？</h1><p>{error ?? '加载运营数据…'}</p>{error && <button onClick={load}>重试</button>}</section>
      )}
    </AppShell>
  );
}
