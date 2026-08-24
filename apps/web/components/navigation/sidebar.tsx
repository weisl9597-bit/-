'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';

const links = [
  { href: '/', label: '首页', icon: '⌂' },
  { href: '/metrics', label: '指标中心', icon: '⌁' },
  { href: '/merchants', label: '商家中心', icon: '◇' },
  { href: '/projects', label: '项目中心', icon: '▦' },
];

export function buildOperationsHref(pathname: string, search: string): string {
  const current = new URLSearchParams(search);
  const operations = new URLSearchParams();
  for (const key of ['source', 'regionId', 'cityId', 'merchantId']) {
    const value = current.get(key);
    if (value) operations.set(key, value);
  }
  const query = operations.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function Sidebar() {
  const [role, setRole] = useState<string | null>(null);
  const [operationsSearch, setOperationsSearch] = useState('');
  useEffect(() => {
    void fetch('/api/session').then(async (response) => {
      if (response.ok) setRole((await response.json() as { role: string }).role);
    });
    const syncSearch = () => setOperationsSearch(window.location.search);
    syncSearch();
    window.addEventListener('popstate', syncSearch);
    window.addEventListener('operations-filter-change', syncSearch);
    return () => {
      window.removeEventListener('popstate', syncSearch);
      window.removeEventListener('operations-filter-change', syncSearch);
    };
  }, []);
  const logout = () => void fetch('/api/session', { method: 'DELETE' }).finally(() => {
    window.location.assign('/login');
  });
  return (
    <aside className="sidebar">
      <div className="brand"><span>设</span><div><strong>设计宝</strong><small>运营预警工作台</small></div></div>
      <nav aria-label="主导航">
        {links.map((link) => <Link key={link.href} href={buildOperationsHref(link.href, operationsSearch)}><i>{link.icon}</i>{link.label}</Link>)}
      </nav>
      {role === 'ADMIN' && (
        <div className="admin-nav"><small>管理后台</small><Link href="/admin/uploads">数据上传</Link><Link href="/admin/merchant-decisions">商家决策</Link></div>
      )}
      <div className="sidebar-footer"><span><span className="online-dot" /> 系统在线</span>{role && <button onClick={logout}>退出登录</button>}</div>
    </aside>
  );
}
