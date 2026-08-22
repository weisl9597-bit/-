import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAccessDecision } from './lib/auth/middleware-policy';

export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production' && process.env.E2E_BYPASS_AUTH === '1') {
    return NextResponse.next();
  }
  const decision = getAccessDecision(
    request.nextUrl.pathname,
    Boolean(request.cookies.get('designbao_session')?.value),
  );
  if (decision.type === 'allow') return NextResponse.next();
  if (decision.type === 'unauthorized') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(new URL(decision.target, request.url));
}

export const config = {
  matcher: ['/((?!.*\\..*).*)'],
};
