import { PrismaClient } from '@prisma/client';

const globalDatabase = globalThis as typeof globalThis & {
  designbaoDatabase?: PrismaClient;
};

export const db = globalDatabase.designbaoDatabase ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalDatabase.designbaoDatabase = db;
}
