import React, { type ReactNode } from 'react';
import { Sidebar } from './sidebar';

export function AppShell({ children }: { children: ReactNode }) {
  return <div className="app-shell"><Sidebar /><main className="app-main">{children}</main></div>;
}
