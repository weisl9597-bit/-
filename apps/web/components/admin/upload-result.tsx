import React from 'react';

export type UploadResultData = {
  id?: string;
  status: 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  totalRows?: number;
  acceptedRows?: number;
  warningCount?: number;
  errorCount?: number;
  skippedRows?: number;
  failureStage?: string | null;
  failureMessage?: string | null;
  issues?: Array<{
    code: string;
    sourceSheet: string;
    sourceRow: number | null;
    field: string | null;
    message: string;
  }>;
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
        <div><dt>跳过</dt><dd>{result.skippedRows ?? 0}</dd></div>
        <div><dt>警告</dt><dd>{result.warningCount ?? 0}</dd></div>
        <div><dt>错误</dt><dd>{result.errorCount ?? 0}</dd></div>
      </dl>
      {result.status === 'FAILED' && result.failureMessage && <div className="upload-failure">
        <strong>失败原因{result.failureStage ? `（${result.failureStage}）` : ''}</strong>
        <span>{result.failureMessage}</span>
      </div>}
      {result.issues && result.issues.length > 0 && <div className="upload-issues">
        <h4>跳过原因（最多显示50条）</h4>
        <ul>{result.issues.map((item, index) => <li key={`${item.sourceSheet}-${item.sourceRow}-${item.field}-${index}`}>
          <strong>{item.sourceSheet}{item.sourceRow ? ` 第 ${item.sourceRow} 行` : ''}</strong>
          <span>{item.message}</span>
        </li>)}</ul>
      </div>}
    </section>
  );
}

