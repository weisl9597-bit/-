export type DatabaseHealthCheck = () => Promise<void>;

export function createHealthHandler(checkDatabase: DatabaseHealthCheck) {
  return async function healthHandler(): Promise<Response> {
    try {
      await checkDatabase();
      return Response.json({
        status: 'ok',
        database: 'ok',
        version: process.env.APP_VERSION ?? 'dev',
      });
    } catch {
      return Response.json(
        {
          status: 'degraded',
          database: 'error',
          version: process.env.APP_VERSION ?? 'dev',
        },
        { status: 503 },
      );
    }
  };
}
