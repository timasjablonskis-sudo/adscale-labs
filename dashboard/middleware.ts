import { NextRequest, NextResponse } from 'next/server'

const PASSWORD = process.env.DASHBOARD_PASSWORD || 'adscale2026'
const COOKIE   = 'adscale_auth'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // /onboard is always public — clients fill this out
  if (pathname.startsWith('/onboard')) {
    return NextResponse.next()
  }

  // Check auth cookie
  const auth = req.cookies.get(COOKIE)?.value
  if (auth === PASSWORD) {
    return NextResponse.next()
  }

  // Not authed — redirect to login
  const loginUrl = req.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.searchParams.set('from', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    '/((?!login|api/auth|_next/static|_next/image|favicon.ico|onboard).*)',
  ],
}
