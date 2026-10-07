import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { RequestHandler } from 'express'
import type { Identity } from '../shared/model'
export interface AuthConfig { dev: boolean; testing?:boolean; tenant?: string; client?: string; origin: string }
export function authentication(config: AuthConfig): RequestHandler {
  const keys = config.tenant ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${config.tenant}/discovery/v2.0/keys`)) : undefined
  return async (req, res, next) => {
    if (config.dev) { res.locals.identity = { id: 'local-development', name: 'Local development', email: 'local@example.test' } satisfies Identity; return next() }
    const signIn = (error: string) => {
      if (req.path.startsWith('/api/') || req.path === '/api') return res.status(401).json({ error })
      return res.redirect(302, '/.auth/login/aad?post_login_redirect_uri=' + encodeURIComponent(config.origin + req.originalUrl))
    }
    try {
      if (!keys || !config.client || !config.tenant) return res.status(503).json({ error: 'Entra authentication has not been configured.' })
      // Easy Auth injects this ID token after authenticating the session. Verify
      // its signature as well: an unsigned principal/header is never sufficient.
      const token = req.get('X-MS-TOKEN-AAD-ID-TOKEN')
      if (!token) {
        return signIn('Sign in with your SDF account.')
      }
      const { payload } = await jwtVerify(token, keys, { issuer: [`https://login.microsoftonline.com/${config.tenant}/v2.0`, `https://sts.windows.net/${config.tenant}/`], audience: config.client, algorithms: ['RS256'], requiredClaims: ['exp','iat','tid','oid'] })
      if (payload.tid !== config.tenant || typeof payload.oid !== 'string' || !payload.oid) return res.status(403).json({ error: 'SDF application access is required.' })
      const email = typeof payload.preferred_username === 'string' ? payload.preferred_username : payload.email
      res.locals.identity = { id: payload.oid, name: typeof payload.name === 'string' ? payload.name : 'SDF user', ...(typeof email === 'string' && /^[^\s@]+@[^\s@]+$/.test(email) ? {email:email.toLowerCase()} : {}) } satisfies Identity
      next()
    } catch { return signIn('Your sign-in has expired or is invalid. Sign in again.') }
  }
}
