/**
 * Runtime security hardening (M6.2).
 *
 * Registered BEFORE cors so helmet's response headers apply to CORS preflights
 * and early rejections (TLS guard). Touches only cross-cutting concerns:
 * helmet, log/err serialization, CORS/TLS guards. Route handlers are untouched.
 */
import helmet from '@fastify/helmet';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ServerConfig } from './config.js';

type CspProfile = ServerConfig['helmetCsp'];

interface CspDirectives {
  'default-src': string[];
  'script-src': string[];
  'style-src': string[];
  'img-src': string[];
  'connect-src': string[];
  'frame-src'?: string[];
  'frame-ancestors': string[];
  'base-uri': string[];
  'form-action': string[];
}

/** CSP directives per profile. `relaxed-for-ui` is default to let Turnstile + hCaptcha iframes load.
 *  FCaptcha's widget is served from the operator's own FCaptcha host (typically same-origin or
 *  reverse-proxied), so no third-party allowances are hardcoded for it — operators who run FCaptcha
 *  on a separate origin can add it to CSP via a reverse-proxy `script-src` allowlist. */
function cspDirectives(profile: CspProfile): CspDirectives | false {
  if (profile === 'off') return false;
  const base: CspDirectives = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'connect-src': ["'self'", 'wss:', 'https:'],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };
  if (profile === 'strict') return base;
  return {
    ...base,
    'script-src': [
      "'self'",
      'https://challenges.cloudflare.com',
      'https://js.hcaptcha.com',
    ],
    'frame-src': [
      "'self'",
      'https://challenges.cloudflare.com',
      'https://newassets.hcaptcha.com',
      'https://*.hcaptcha.com',
    ],
    'connect-src': [
      "'self'",
      'wss:',
      'https:',
      'https://challenges.cloudflare.com',
      'https://hcaptcha.com',
      'https://*.hcaptcha.com',
    ],
  };
}

const SCRUB_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-faucet-api-key',
  'x-faucet-signature',
  'x-faucet-nonce',
  'x-faucet-timestamp',
  'x-faucet-csrf',
  'x-faucet-totp',
  'x-faucet-admin-token',
];

const SCRUB_FIELDS = /^(password|passphrase|totp|apiKey|hmacSecret|privateKey|signature|csrf|sessionToken)$/i;

/** Pino redact paths cover header + known secret body fields. Pino's `redact` runs before transports. */
export function buildRedactPaths(): string[] {
  const headerPaths = SCRUB_HEADERS.flatMap((h) => [
    `req.headers["${h}"]`,
    `request.headers["${h}"]`,
    `res.headers["${h}"]`,
    `response.headers["${h}"]`,
  ]);
  const fieldPaths = [
    'password',
    'passphrase',
    'walletPassphrase',
    'keyPassphrase',
    'adminPassword',
    'totp',
    'apiKey',
    'hmacSecret',
    'privateKey',
    'signature',
    'csrf',
    'sessionToken',
    '*.password',
    '*.passphrase',
    '*.walletPassphrase',
    '*.keyPassphrase',
    '*.adminPassword',
    '*.totp',
    '*.apiKey',
    '*.hmacSecret',
    '*.privateKey',
    '*.signature',
    '*.csrf',
    '*.sessionToken',
  ];
  return [...headerPaths, ...fieldPaths];
}

export function scrubObject<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrubObject(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SCRUB_FIELDS.test(k)) {
      out[k] = '[REDACTED]';
    } else if (SCRUB_HEADERS.includes(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      out[k] = scrubObject(v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

function hasTls(req: FastifyRequest): boolean {
  const proto = req.headers['x-forwarded-proto'];
  const protoStr = Array.isArray(proto) ? proto[0] : proto;
  if (typeof protoStr === 'string' && protoStr.toLowerCase().split(',')[0]?.trim() === 'https') {
    return true;
  }
  if (req.protocol === 'https') return true;
  const socket = (req.raw as unknown as { socket?: { encrypted?: boolean } }).socket;
  return socket?.encrypted === true;
}

export async function applyHardening(app: FastifyInstance, config: ServerConfig): Promise<void> {
  // Wildcard CORS with TLS enforcement enabled would expose credentialed admin endpoints
  // to any origin — refuse to start rather than silently accept it. Dev mode is exempt.
  if (config.tlsRequired && !config.dev && config.corsOrigins === true) {
    throw new Error(
      "Wildcard CORS ('*') is not allowed when FAUCET_TLS_REQUIRED=true. " +
        'Set FAUCET_CORS_ORIGINS to a comma-separated list, or set FAUCET_DEV=1 for local testing.',
    );
  }
  if (!config.dev && config.corsOrigins === true) {
    app.log.warn(
      'FAUCET_CORS_ORIGINS=* in non-dev mode; prefer an explicit allow-list in production',
    );
  }
  if (config.helmetCsp === 'off') {
    app.log.warn('helmetCsp=off; CSP disabled — only use for debugging');
  }

  const directives = cspDirectives(config.helmetCsp);
  // In dev mode the server is served over plain HTTP; helmet's default
  // `upgrade-insecure-requests` directive tells strict UAs (notably WebKit)
  // to rewrite every http://127.0.0.1 asset URL to https, which fails the
  // TLS handshake and leaves the SPA blank. Only emit that directive when
  // TLS is actually required.
  const cspWithUpgrade = directives
    ? config.dev || !config.tlsRequired
      ? { directives: directives as unknown as Record<string, string[]>, useDefaults: false }
      : { directives: directives as unknown as Record<string, string[]> }
    : false;
  await app.register(helmet, {
    contentSecurityPolicy: cspWithUpgrade,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: { maxAge: 15_552_000, includeSubDomains: true },
  });

  if (config.tlsRequired && !config.dev) {
    app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      if (hasTls(req)) return;
      reply.code(426).header('upgrade', 'TLS/1.2, HTTP/1.1').send({
        error: 'TLS required',
        code: 'TLS_REQUIRED',
      });
    });
  }

  if (!config.dev) {
    app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
      req.log.error({ err }, 'request failed');
      const status =
        typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
          ? err.statusCode
          : 500;
      reply.code(status).send({
        error: status >= 500 ? 'internal error' : err.name || 'error',
        code: err.code ?? 'INTERNAL',
      });
    });
  }
}
