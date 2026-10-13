'use strict';
/*
 * Print saved orders and enquiries as JSON, newest first.
 *   node scripts/export-orders.js > orders.json
 *
 * Reads from Redis when UPSTASH_REDIS_REST_URL/TOKEN (or KV_REST_API_URL/TOKEN)
 * are set, otherwise from the local data/ folders used by `npm run dev`.
 * On Vercel, get the variables onto your machine with: vercel env pull .env.local
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { createRedis, createRedisStore } = require('../lib/redis');
const { createFileStore } = require('../server/storage');

(async () => {
  const redis = createRedis(process.env);
  const orders = redis ? createRedisStore(redis, 'order') : createFileStore(path.join(ROOT, 'data', 'orders'));
  const enquiries = redis ? createRedisStore(redis, 'enquiry') : createFileStore(path.join(ROOT, 'data', 'enquiries'));
  const out = { source: redis ? 'redis' : 'local files', orders: await orders.list(), enquiries: await enquiries.list() };
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
