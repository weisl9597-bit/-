export type SessionHandlerDependencies = {
  authenticate(email: string, password: string): Promise<{ userId: string } | null>;
  createSession(userId: string): Promise<{ rawToken: string; expiresAt: Date }>;
};

export type SessionHandlerOptions = {
  secureCookies: boolean;
};

function redirectTo(request: Request, path: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location: new URL(path, request.url).toString() },
  });
}

export function createSessionHandler(
  dependencies: SessionHandlerDependencies,
  options: SessionHandlerOptions,
) {
  return async function postSession(request: Request): Promise<Response> {
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const password = String(form.get('password') ?? '');
    const authenticated = email && password
      ? await dependencies.authenticate(email, password)
      : null;

    if (!authenticated) return redirectTo(request, '/login?error=invalid_credentials');

    const session = await dependencies.createSession(authenticated.userId);
    const response = redirectTo(request, '/');
    const cookieParts = [
      `designbao_session=${encodeURIComponent(session.rawToken)}`,
      'Path=/',
      `Expires=${session.expiresAt.toUTCString()}`,
      'HttpOnly',
    ];
    if (options.secureCookies) cookieParts.push('Secure');
    cookieParts.push('SameSite=Lax');
    response.headers.set('set-cookie', cookieParts.join('; '));
    return response;
  };
}

export function createCurrentSessionHandler(
  authenticate: (request: Request) => Promise<{ userId: string; role: string } | null>,
) {
  return async function getCurrentSession(request: Request): Promise<Response> {
    const actor = await authenticate(request);
    return actor
      ? Response.json(actor)
      : Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  };
}

function requestCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

export function createDeleteSessionHandler(revoke: (rawToken: string) => Promise<void>) {
  return async function deleteSession(request: Request): Promise<Response> {
    const token = requestCookie(request, 'designbao_session');
    if (token) await revoke(token);
    const response = redirectTo(request, '/login');
    response.headers.set(
      'set-cookie',
      'designbao_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
    );
    return response;
  };
}
