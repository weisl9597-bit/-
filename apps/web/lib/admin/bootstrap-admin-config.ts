export type BootstrapAdminConfiguration = { email: string; password: string; name: string };

export function readBootstrapAdminConfiguration(
  environment: Record<string, string | undefined>,
): BootstrapAdminConfiguration {
  const email = environment.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = environment.BOOTSTRAP_ADMIN_PASSWORD ?? '';
  const name = environment.BOOTSTRAP_ADMIN_NAME?.trim() || '系统管理员';
  if (!email || !email.includes('@')) throw new Error('BOOTSTRAP_ADMIN_EMAIL 必须是有效邮箱');
  if (password.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD 至少需要 12 个字符');
  return { email, password, name };
}

