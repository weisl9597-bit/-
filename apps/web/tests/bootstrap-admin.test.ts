import { describe, expect, it } from 'vitest';
import { readBootstrapAdminConfiguration } from '../lib/admin/bootstrap-admin-config';

describe('initial administrator bootstrap', () => {
  it('normalizes a valid administrator configuration', () => {
    expect(readBootstrapAdminConfiguration({
      BOOTSTRAP_ADMIN_EMAIL: ' Admin@Example.com ',
      BOOTSTRAP_ADMIN_PASSWORD: 'safe-password-2026',
      BOOTSTRAP_ADMIN_NAME: '数据管理员',
    })).toEqual({ email: 'admin@example.com', password: 'safe-password-2026', name: '数据管理员' });
  });

  it('rejects missing credentials and short passwords', () => {
    expect(() => readBootstrapAdminConfiguration({})).toThrow('BOOTSTRAP_ADMIN_EMAIL');
    expect(() => readBootstrapAdminConfiguration({
      BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com', BOOTSTRAP_ADMIN_PASSWORD: 'short',
    })).toThrow('12');
  });
});
