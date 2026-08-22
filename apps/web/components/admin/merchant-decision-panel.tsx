'use client';

import React, { useState } from 'react';

type DecisionType = 'CONFIRM_C' | 'TEMP_EXEMPT' | 'PERMANENT_EXCLUDE' | 'MANUAL_CLASSIFICATION';

export function MerchantDecisionPanel({
  merchantId,
  merchantName,
  suggested,
  reason,
  onSaved,
}: {
  merchantId: string;
  merchantName: string;
  suggested: string;
  reason: string;
  onSaved(): void;
}) {
  const [type, setType] = useState<DecisionType>('CONFIRM_C');
  const [message, setMessage] = useState('');
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('正在保存…');
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    void fetch('/api/admin/merchant-decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (response) => {
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setMessage(result.error ?? '保存失败');
        return;
      }
      setMessage('已保存并记录审计日志');
      onSaved();
    });
  };
  return (
    <article className="decision-card">
      <header><div><strong>{merchantName}</strong><small>{merchantId}</small></div><span className="class-badge">建议 {suggested}</span></header>
      <p className="decision-reason">{reason}</p>
      <form onSubmit={submit}>
        <input type="hidden" name="merchantId" value={merchantId} />
        <label><span>处理方式</span><select name="type" value={type} onChange={(event) => setType(event.target.value as DecisionType)}>
          <option value="CONFIRM_C">确认进入C类</option>
          <option value="TEMP_EXEMPT">临时豁免</option>
          <option value="PERMANENT_EXCLUDE">永久排除</option>
          <option value="MANUAL_CLASSIFICATION">手动调整分类</option>
        </select></label>
        {type === 'MANUAL_CLASSIFICATION' && <label><span>目标分类</span><select name="classification" defaultValue="B">{['A','A_RISK','B','C_CANDIDATE','C','ELIMINATED'].map((item) => <option key={item}>{item}</option>)}</select></label>}
        {type === 'TEMP_EXEMPT' && <label><span>豁免结束日期</span><input name="endDate" type="date" required /></label>}
        <label className="decision-reason-input"><span>操作原因</span><textarea name="reason" rows={2} required placeholder="请填写判断依据，保存后不可删除" /></label>
        <button type="submit">保存决策</button>
      </form>
      {message && <small className="form-message">{message}</small>}
    </article>
  );
}

