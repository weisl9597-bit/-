import { prismaUploadDependencies } from '../../../../lib/uploads/prisma-upload-dependencies';
import { createUploadHandler } from '../../../../lib/uploads/upload-handler';

export const runtime = 'nodejs';
export const POST = createUploadHandler(prismaUploadDependencies);
