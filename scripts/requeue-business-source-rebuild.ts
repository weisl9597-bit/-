import { requeueBusinessSourceRebuild } from '@designbao/db/jobs';

const result = await requeueBusinessSourceRebuild('business-source-v2');
console.log(JSON.stringify({ event: 'business_source_rebuild_queued', ...result }));

