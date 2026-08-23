'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UploadResult, type UploadResultData } from './upload-result';

type UploadResponseBody = {
  batchId?: string;
  status?: UploadResultData['status'];
  error?: string;
};

type UploadSubmission =
  | {
    kind: 'track';
    batchId: string;
    status: UploadResultData['status'];
    message: string;
  }
  | { kind: 'error'; message: string };

type UploadRequest = (
  input: string,
  init: { method: string; body: FormData },
) => Promise<Response>;

type StatusRequest = (input: string) => Promise<Response>;

const uploadErrorMessages: Record<string, string> = {
  UNAUTHENTICATED: '登录已失效，请重新登录',
  FORBIDDEN: '当前账号没有数据上传权限',
  FILE_REQUIRED: '请选择Excel文件',
  INVALID_DATA_DATE: '请选择正确的数据日期',
  XLSX_ONLY: '仅支持.xlsx格式的Excel文件',
  FILE_TOO_LARGE: '文件不能超过50MB',
  DUPLICATE_FILE: '该文件已经上传',
};

export async function submitUpload(
  form: FormData,
  request: UploadRequest = fetch,
): Promise<UploadSubmission> {
  try {
    const response = await request('/api/admin/uploads', { method: 'POST', body: form });
    const body = await response.json() as UploadResponseBody;
    const duplicate = response.status === 409 && body.error === 'DUPLICATE_FILE';
    if (body.batchId && (response.ok || duplicate)) {
      return {
        kind: 'track',
        batchId: body.batchId,
        status: body.status ?? 'QUEUED',
        message: duplicate
          ? '该文件已上传，正在读取原批次状态'
          : '文件已进入处理队列',
      };
    }
    return {
      kind: 'error',
      message: uploadErrorMessages[body.error ?? ''] ?? '上传失败，请稍后重试',
    };
  } catch {
    return { kind: 'error', message: '上传失败，请检查网络后重试' };
  }
}

export async function loadLatestUpload(
  request: StatusRequest = fetch,
): Promise<UploadResultData | null> {
  try {
    const response = await request('/api/admin/uploads');
    if (!response.ok) return null;
    return await response.json() as UploadResultData | null;
  } catch {
    return null;
  }
}

function statusMessage(result: UploadResultData): string {
  if (result.status === 'SUCCEEDED') return '导入成功';
  if (result.status === 'FAILED') {
    return result.failureMessage ? '导入失败，请查看失败原因' : '导入未通过，请检查文件数据';
  }
  if (result.status === 'PROCESSING') return '正在校验与导入';
  return '文件已进入处理队列';
}

export function UploadClient() {
  const [result, setResult] = useState<UploadResultData | null>(null);
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const trackBatch = useCallback((batchId: string) => {
    if (timer.current) clearInterval(timer.current);
    const poll = async () => {
      try {
        const statusResponse = await fetch(`/api/admin/uploads/${batchId}`);
        if (!statusResponse.ok) return;
        const status = await statusResponse.json() as UploadResultData;
        setResult(status);
        setMessage(statusMessage(status));
        if (['SUCCEEDED', 'FAILED'].includes(status.status) && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
      } catch {
        setMessage('状态查询暂时失败，系统将继续重试');
      }
    };
    timer.current = setInterval(() => void poll(), 1500);
    void poll();
  }, []);

  useEffect(() => {
    let active = true;
    void loadLatestUpload().then((latest) => {
      if (!active || !latest) return;
      setResult(latest);
      setMessage(statusMessage(latest));
      if (latest.id && ['QUEUED', 'PROCESSING'].includes(latest.status)) {
        trackBatch(latest.id);
      }
    });
    return () => {
      active = false;
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [trackBatch]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage('正在上传…');
    const form = new FormData(event.currentTarget);
    const submission = await submitUpload(form);
    setMessage(submission.message);
    if (submission.kind === 'error') return;
    setResult({ id: submission.batchId, status: submission.status });
    trackBatch(submission.batchId);
  };
  return <div><header className="page-heading"><div><p className="eyebrow">管理后台</p><h1>上传每日Excel</h1><p>系统仅读取“项目明细2”和“工作表3”，失败批次不会覆盖已有数据。</p></div></header>
    <section className="panel upload-panel"><form onSubmit={submit}><label><span>数据日期</span><input name="dataDate" type="date" required /></label><label className="file-drop"><span>选择Excel文件</span><input name="file" type="file" accept=".xlsx" required /><small>仅支持.xlsx，最大50MB</small></label><button type="submit">上传并开始校验</button></form>{message && <p className="form-message">{message}</p>}{result && <UploadResult result={result} />}</section>
  </div>;
}

