import { describe, expect, it } from 'vitest';

describe('admin upload client flow', () => {
  it('continues tracking the existing batch when the file is a duplicate', async () => {
    const module = await import('../components/admin/upload-client').catch(() => ({}));
    expect(module).toHaveProperty('submitUpload');
    if (!('submitUpload' in module)) return;

    const result = await (module as {
      submitUpload(
        form: FormData,
        request: () => Promise<Response>,
      ): Promise<unknown>;
    }).submitUpload(
      new FormData(),
      async () => Response.json(
        { error: 'DUPLICATE_FILE', batchId: 'batch-existing' },
        { status: 409 },
      ),
    );

    expect(result).toEqual({
      kind: 'track',
      batchId: 'batch-existing',
      status: 'QUEUED',
      message: '该文件已上传，正在读取原批次状态',
    });
  });

  it('returns a Chinese retry message when the upload request fails', async () => {
    const module = await import('../components/admin/upload-client').catch(() => ({}));
    expect(module).toHaveProperty('submitUpload');
    if (!('submitUpload' in module)) return;

    const result = await (module as {
      submitUpload(
        form: FormData,
        request: () => Promise<Response>,
      ): Promise<unknown>;
    }).submitUpload(
      new FormData(),
      async () => { throw new Error('network unavailable'); },
    );

    expect(result).toEqual({
      kind: 'error',
      message: '上传失败，请检查网络后重试',
    });
  });
});
