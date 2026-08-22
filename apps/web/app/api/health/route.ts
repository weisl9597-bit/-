import { Client } from 'pg';
import { createHealthHandler } from '../../../lib/health';

async function checkPostgres(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end().catch(() => undefined);
  }
}

export const GET = createHealthHandler(checkPostgres);
