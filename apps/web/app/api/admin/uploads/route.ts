import {
  prismaUploadDependencies,
  prismaUploadStatusDependencies,
} from '../../../../lib/uploads/prisma-upload-dependencies';
import {
  createLatestUploadHandler,
  createUploadHandler,
} from '../../../../lib/uploads/upload-handler';

export const runtime = 'nodejs';
export const GET = createLatestUploadHandler(prismaUploadStatusDependencies);
export const POST = createUploadHandler(prismaUploadDependencies);

