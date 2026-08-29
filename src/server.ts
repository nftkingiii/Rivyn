import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { ZodError } from 'zod';
import { loadConfig } from './config.js';
import { ProofError, ProofRequestSchema, ProofService } from './proof.js';

const MAX_BODY_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 20;
const buckets = new Map<string, { count: number; resetAt: number }>();

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function commonSecurityHeaders(response: ServerResponse) {
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function apiSecurityHeaders(response: ServerResponse) {
  commonSecurityHeaders(response);
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('Cache-Control', 'no-store');
}

function webSecurityHeaders(response: ServerResponse) {
  commonSecurityHeaders(response);
  response.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'");
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type']?.split(';', 1)[0];
  if (contentType !== 'application/json') throw new ProofError('UNSUPPORTED_MEDIA_TYPE', 'application/json required', 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new ProofError('BODY_TOO_LARGE', 'Request body exceeds 8 KiB', 413);
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ProofError('INVALID_JSON', 'Malformed JSON', 400); }
}

function clientKey(request: IncomingMessage) {
  return request.socket.remoteAddress ?? 'unknown';
}

function rateLimited(request: IncomingMessage) {
  const now = Date.now();
  const key = clientKey(request);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT;
}

type ProofBuilder = { build(input: ReturnType<typeof ProofRequestSchema.parse>): Promise<unknown> };

async function serveWeb(request: IncomingMessage, response: ServerResponse, webRoot: string) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = resolve(webRoot, requested);
  const safeRoot = `${resolve(webRoot)}${sep}`;
  if (candidate !== resolve(webRoot) && !candidate.startsWith(safeRoot)) return false;

  let file = candidate;
  try {
    if (!(await stat(file)).isFile()) return false;
  } catch {
    file = resolve(webRoot, 'index.html');
    try {
      if (!(await stat(file)).isFile()) return false;
    } catch {
      return false;
    }
  }

  webSecurityHeaders(response);
  response.statusCode = 200;
  response.setHeader('Content-Type', MIME_TYPES[extname(file)] ?? 'application/octet-stream');
  response.setHeader('Cache-Control', file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable');
  if (request.method === 'HEAD') return response.end(), true;
  createReadStream(file).pipe(response);
  return true;
}

export function createRivynServer(config = loadConfig(), proofService: ProofBuilder = new ProofService(config), webRoot = resolve('dist-web')) {
  return createServer(async (request, response) => {
    const isApiRequest = request.url === '/healthz' || request.url?.startsWith('/v1/') || request.method === 'OPTIONS';
    if (!isApiRequest && await serveWeb(request, response, webRoot)) return;
    apiSecurityHeaders(response);
    const origin = request.headers.origin;
    if (origin && config.allowedOrigins.has(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    } else if (origin) {
      return json(response, 403, { error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed' } });
    }
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.statusCode = 204;
      return response.end();
    }
    if (rateLimited(request)) return json(response, 429, { error: { code: 'RATE_LIMITED', message: 'Try again later' } });

    try {
      if (request.method === 'GET' && request.url === '/healthz') {
        return json(response, 200, {
          ok: true,
          service: 'rivyn',
          version: '0.1.0',
          revision: process.env.APP_REVISION ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? 'development',
        });
      }
      if (request.method === 'POST' && request.url === '/v1/proofs') {
        const input = ProofRequestSchema.parse(await readJson(request));
        return json(response, 200, await proofService.build(input));
      }
      return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
    } catch (error) {
      if (error instanceof ProofError) return json(response, error.status, { error: { code: error.code, message: error.message } });
      if (error instanceof ZodError) return json(response, 422, { error: { code: 'VALIDATION_ERROR', message: 'Invalid request fields' } });
      return json(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'Request failed' } });
    }
  });
}

if (process.env.NODE_ENV !== 'test') {
  const config = loadConfig();
  createRivynServer(config).listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Rivyn service listening on port ${config.port}\n`);
  });
}
