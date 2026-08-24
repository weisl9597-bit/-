import { db } from '@designbao/db/client';
import { requeueBusinessSourceRebuild } from '@designbao/db/jobs';

async function main() {
  const result = await requeueBusinessSourceRebuild('business-source-v2');
  process.stdout.write(`${JSON.stringify({ event: 'business_source_rebuild_queued', ...result })}\n`);
}

main().finally(() => db.$disconnect()).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
