'use strict';
/*
 * Storage for orders, enquiries and uploaded logos on Vercel.
 *
 * Vercel functions have no persistent disk, so records go to a Redis database
 * over its REST API (Upstash Redis, available from the Vercel Marketplace).
 * No npm package is needed: it is plain fetch.
 *
 * Environment variables (set by the Upstash integration, or by hand):
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *   KV_REST_API_URL        / KV_REST_API_TOKEN          (older Vercel KV names)
 *
 * The store objects have the same methods as server/storage.js
 * (exists, save, update, get, list), so the order and enquiry handlers do not
 * know the difference.
 */
const SAFE = /^[A-Za-z0-9._-]+$/;
// Logos up to this size are also kept in Redis (a free Upstash request is limited to about 1 MB).
// Larger logos still travel to KORE as an attachment on the notification email.
const MAX_LOGO_STORE_BYTES = 700 * 1024;

function redisConfig(env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

function createRedis(env, fetchImpl) {
  const cfg = redisConfig(env);
  if (!cfg) return null;
  const doFetch = fetchImpl || globalThis.fetch;
  return {
    /** Run one Redis command, e.g. cmd(['SET', key, value, 'NX']). */
    async cmd(args) {
      const res = await doFetch(cfg.url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error('Redis error' + (data.error ? ': ' + data.error : ' ' + res.status));
      return data.result;
    }
  };
}

function checkRef(ref) {
  if (typeof ref !== 'string' || !SAFE.test(ref)) throw new Error('Unsafe reference');
  return ref;
}

/** kind: 'order' or 'enquiry'. Keys: kore:<kind>:<reference>, index kore:<kind>s (sorted by time). */
function createRedisStore(redis, kind) {
  const key = (ref) => 'kore:' + kind + ':' + checkRef(ref);
  const index = 'kore:' + kind + 's';
  return {
    async exists(ref) { return (await redis.cmd(['EXISTS', key(ref)])) === 1; },
    async save(record) {
      const ok = await redis.cmd(['SET', key(record.reference), JSON.stringify(record), 'NX']);
      if (ok !== 'OK') throw new Error('Reference already exists');
      await redis.cmd(['ZADD', index, Date.parse(record.createdAt) || Date.now(), record.reference]);
    },
    async update(record) { await redis.cmd(['SET', key(record.reference), JSON.stringify(record)]); },
    async get(ref) {
      const raw = await redis.cmd(['GET', key(ref)]);
      if (!raw) throw new Error('Not found');
      return JSON.parse(raw);
    },
    /** Newest first, at most `limit` records. */
    async list(limit) {
      const refs = await redis.cmd(['ZREVRANGE', index, 0, (limit || 200) - 1]);
      if (!refs || !refs.length) return [];
      const raws = await redis.cmd(['MGET'].concat(refs.map(key)));
      return raws.filter(Boolean).map((r) => JSON.parse(r));
    }
  };
}

/**
 * Logo files. `canDeliverByEmail` says whether the notification email (which
 * carries the logo as an attachment) is configured; when it is, a logo that is
 * too large to store is not an error.
 */
function createRedisUploads(redis, { canDeliverByEmail } = {}) {
  const key = (name) => { if (typeof name !== 'string' || !SAFE.test(name)) throw new Error('Unsafe file name'); return 'kore:logo:' + name; };
  return {
    async save(name, buf) {
      if (buf.length <= MAX_LOGO_STORE_BYTES) {
        await redis.cmd(['SET', key(name), buf.toString('base64')]);
        return;
      }
      if (canDeliverByEmail) return; // too big to store; it goes out as an email attachment
      throw new Error('Logo too large to store without email delivery');
    },
    async read(name) {
      const b64 = await redis.cmd(['GET', key(name)]);
      return b64 ? Buffer.from(b64, 'base64') : null;
    }
  };
}

/** Counts hits per key in a time window. Returns true when `max` is exceeded. */
async function rateLimited(redis, id, max, windowSeconds) {
  const k = 'kore:rl:' + id;
  const n = await redis.cmd(['INCR', k]);
  if (n === 1) await redis.cmd(['EXPIRE', k, windowSeconds]);
  return n > max;
}

module.exports = { redisConfig, createRedis, createRedisStore, createRedisUploads, rateLimited, MAX_LOGO_STORE_BYTES };
