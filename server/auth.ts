import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { RequestHandler } from 'express'
import type { Identity } from '../shared/model'
export interface AuthConfig { dev: boolean; testing?:boolean; tenant?: string; client?: string; audience?: string; scope?: string; origin: string }
export function authentication(config: AuthConfig): RequestHandler {
  const keys = config.tenant ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${config.tenant}/discovery/v2.0/keys`)) : undefined
  return async (req, res, next) => {
    if (config.dev) { res.locals.identity = { id: 'local-development', name: 'Local development' } satisfies Identity; return next() }
    try {
      if (!keys || !config.audience || !config.tenant) return res.status(503).json({ error: 'Entra authentication has not been configured.' })
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
      if (!token) return res.status(401).json({ error: 'Sign in with your SDF account.' })
      const { payload } = await jwtVerify(token, keys, { issuer: `https://login.microsoftonline.com/${config.tenant}/v2.0`, audience: config.audience, algorithms: ['RS256'] })
      if (payload.tid !== config.tenant || payload.azp !== config.client || typeof payload.oid !== 'string' || !String(payload.scp ?? '').split(' ').includes('access_as_user')) return res.status(403).json({ error: 'SDF application access is required.' })
      res.locals.identity = { id: payload.oid, name: typeof payload.name === 'string' ? payload.name : 'SDF user' } satisfies Identity
      next()
    } catch { res.status(401).json({ error: 'Your sign-in has expired or is invalid. Sign in again.' }) }
  }
}
