import { prismaUploadStatusDependencies } from '../../../../../lib/uploads/prisma-upload-dependencies';
import { createUploadStatusHandler } from '../../../../../lib/uploads/upload-handler';

export const runtime = 'nodejs';
export const GET = createUploadStatusHandler(prismaUploadStatusDependencies);
