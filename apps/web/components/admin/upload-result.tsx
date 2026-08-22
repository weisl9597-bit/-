import React from 'react';

export type UploadResultData = {
  status: 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  totalRows?: number;
  acceptedRows?: number;
  warningCount?: number;
  errorCount?: number;
};

export function UploadResult({ result }: { result: UploadResultData }) {
  const label = result.status === 'FAILED' ? '导入未通过'
    : result.status === 'SUCCEEDED' ? '导入成功'
      : result.status === 'PROCESSING' ? '正在校验与导入' : '已进入处理队列';
  return (
    <section className={`upload-result upload-${result.status.toLowerCase()}`}>
      <div><p className="eyebrow">处理结果</p><h3>{label}</h3></div>
      <dl>
        <div><dt>总行数</dt><dd>{result.totalRows ?? '—'}</dd></div>
        <div><dt>成功</dt><dd>{result.acceptedRows ?? '—'}</dd></div>
        <div><dt>警告</dt><dd>{result.warningCount ?? 0}</dd></div>
        <div><dt>错误</dt><dd>{result.errorCount ?? 0}</dd></div>
      </dl>
    </section>
  );
}
