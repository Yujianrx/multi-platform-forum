import type { FastifyReply, FastifyRequest } from 'fastify';
import { hash } from './core.js';

// Call only AFTER current authentication, scope and file-safety checks.
// No freshness window: a browser must revalidate before reusing private bytes.
export function privateImageUnchanged(req: FastifyRequest, reply: FastifyReply, version: string) {
  const etag = '"' + hash(version) + '"';
  reply
    .header('Cache-Control', 'private, no-cache, must-revalidate')
    .header('Vary', 'Cookie')
    .header('ETag', etag);
  const values = String(req.headers['if-none-match'] || '')
    .split(',')
    .map((v) => v.trim().replace(/^W\//, ''));
  if (values.includes(etag) || values.includes('*')) {
    reply.code(304);
    return true;
  }
  return false;
}

export function staticCacheControl(filename: string) {
  return /[\\/]brand[\\/]optimized[\\/][\w-]+-[a-f0-9]{12}\.(webp|svg)$/.test(filename) ||
    /[\\/]assets[\\/]/.test(filename)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}
