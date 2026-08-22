import { db } from '../packages/db/src/client';
import { readBootstrapAdminConfiguration } from '../apps/web/lib/admin/bootstrap-admin-config';
import { hashPassword } from '../apps/web/lib/auth/password';

async function main() {
  const configuration = readBootstrapAdminConfiguration(process.env);
  const passwordHash = await hashPassword(configuration.password);
  const user = await db.user.upsert({
    where: { email: configuration.email },
    create: {
      email: configuration.email,
      passwordHash,
      name: configuration.name,
      role: 'ADMIN',
      active: true,
    },
    update: {
      passwordHash,
      name: configuration.name,
      role: 'ADMIN',
      active: true,
    },
    select: { id: true, email: true },
  });
  process.stdout.write(`管理员已准备：${user.email} (${user.id})\n`);
}

main().finally(() => db.$disconnect()).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

