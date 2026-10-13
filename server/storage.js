'use strict';
/*
 * File-based storage for orders and uploaded logos.
 * Each order is one JSON file named by its reference. Swap this module for a
 * database adapter with the same methods (exists, save, update, get, list).
 */
const fs = require('fs');
const path = require('path');

const SAFE = /^[A-Za-z0-9._-]+$/;

function createFileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (ref) => {
    if (!SAFE.test(ref)) throw new Error('Unsafe reference');
    return path.join(dir, ref + '.json');
  };
  async function writeAtomic(target, data, exclusive) {
    const tmp = target + '.' + process.pid + '.' + Date.now() + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), { flag: 'wx' });
    if (exclusive) {
      try { await fs.promises.link(tmp, target); } finally { await fs.promises.unlink(tmp).catch(() => {}); }
    } else {
      await fs.promises.rename(tmp, target);
    }
  }
  return {
    async exists(ref) { try { await fs.promises.access(file(ref)); return true; } catch (e) { return false; } },
    async save(order) { await writeAtomic(file(order.reference), order, true); },
    async update(order) { await writeAtomic(file(order.reference), order, false); },
    async get(ref) { return JSON.parse(await fs.promises.readFile(file(ref), 'utf8')); },
    async list() {
      const names = (await fs.promises.readdir(dir)).filter((n) => n.endsWith('.json'));
      const out = [];
      for (const n of names) out.push(JSON.parse(await fs.promises.readFile(path.join(dir, n), 'utf8')));
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
  };
}

function createFileUploads(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    async save(name, buf) {
      if (!SAFE.test(name)) throw new Error('Unsafe file name');
      await fs.promises.writeFile(path.join(dir, name), buf, { flag: 'wx', mode: 0o640 });
    },
    path(name) { if (!SAFE.test(name)) throw new Error('Unsafe file name'); return path.join(dir, name); }
  };
}

module.exports = { createFileStore, createFileUploads };
