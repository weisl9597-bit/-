import React from 'react';
import type { BusinessSourceRebuildStatus } from '../../lib/queries/rebuild-status';

export function RebuildBanner({ status }: { status: BusinessSourceRebuildStatus }) {
  if (status.state === 'IDLE' || status.state === 'SUCCEEDED') return null;
  return <aside className={`rebuild-banner rebuild-${status.state.toLowerCase()}`}>
    {status.state === 'FAILED'
      ? `历史数据重建有 ${status.failed} 个批次失败，请联系管理员。`
      : `历史数据正在重建：${status.completed}/${status.total}，完成前部分日期可能暂无数据。`}
  </aside>;
}

