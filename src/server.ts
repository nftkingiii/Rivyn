import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { loadConfig } from './config.js';
import { ProofError, ProofRequestSchema, ProofService } from './proof.js';

const MAX_BODY_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 20;
const buckets = new Map<string, { count: number; resetAt: number }>();

function securityHeaders(response: ServerResponse) {
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Cache-Control', 'no-store');
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

export function createRivynServer(config = loadConfig(), proofService: ProofBuilder = new ProofService(config)) {
  return createServer(async (request, response) => {
    securityHeaders(response);
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
        return json(response, 200, { ok: true, service: 'rivyn-proof-api', version: '0.1.0' });
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
    console.log(`Rivyn proof API listening on port ${config.port}`);
  });
}
