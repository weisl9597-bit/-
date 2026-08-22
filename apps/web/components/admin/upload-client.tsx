'use client';

import React, { useRef, useState } from 'react';
import { UploadResult, type UploadResultData } from './upload-result';

export function UploadClient() {
  const [result, setResult] = useState<UploadResultData | null>(null);
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage('正在上传…');
    const form = new FormData(event.currentTarget);
    void fetch('/api/admin/uploads', { method: 'POST', body: form }).then(async (response) => {
      const body = await response.json() as { batchId?: string; status?: UploadResultData['status']; error?: string };
      if (!response.ok || !body.batchId) { setMessage(body.error ?? '上传失败'); return; }
      setResult({ status: body.status ?? 'QUEUED' }); setMessage('文件已进入处理队列');
      timer.current = setInterval(() => void fetch(`/api/admin/uploads/${body.batchId}`).then(async (statusResponse) => {
        if (!statusResponse.ok) return;
        const status = await statusResponse.json() as UploadResultData;
        setResult(status);
        if (['SUCCEEDED', 'FAILED'].includes(status.status) && timer.current) clearInterval(timer.current);
      }), 1500);
    });
  };
  return <div><header className="page-heading"><div><p className="eyebrow">管理后台</p><h1>上传每日Excel</h1><p>系统仅读取“项目明细2”和“工作表3”，失败批次不会覆盖已有数据。</p></div></header>
    <section className="panel upload-panel"><form onSubmit={submit}><label><span>数据日期</span><input name="dataDate" type="date" required /></label><label className="file-drop"><span>选择Excel文件</span><input name="file" type="file" accept=".xlsx" required /><small>仅支持.xlsx，最大50MB</small></label><button type="submit">上传并开始校验</button></form>{message && <p className="form-message">{message}</p>}{result && <UploadResult result={result} />}</section>
  </div>;
}
