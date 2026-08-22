const publicExactPaths = new Set(['/login', '/api/session', '/api/health', '/favicon.ico']);

export function isPublicPath(pathname: string): boolean {
  return publicExactPaths.has(pathname) || pathname.startsWith('/_next/');
}

export type AccessDecision =
  | { type: 'allow' }
  | { type: 'redirect'; target: string }
  | { type: 'unauthorized' };

export function getAccessDecision(pathname: string, hasSessionCookie: boolean): AccessDecision {
  if (isPublicPath(pathname) || hasSessionCookie) return { type: 'allow' };
  if (pathname.startsWith('/api/')) return { type: 'unauthorized' };
  return { type: 'redirect', target: `/login?next=${encodeURIComponent(pathname)}` };
}
