import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createQueuedStorage } from '../src/services/queuedStorage';

it('slow writes cannot overwrite newer progress, and flush waits for durable data', async () => {
  const disk = new Map<string, string>();
  const releases: (() => void)[] = [];
  let concurrent = 0, maxConcurrent = 0;
  const storage = createQueuedStorage({
    getItem: async key => disk.get(key) ?? null,
    setItem: async (key, value) => {
      maxConcurrent = Math.max(maxConcurrent, ++concurrent);
      await new Promise<void>(resolve => releases.push(resolve));
      disk.set(key, value); concurrent--;
    },
    removeItem: async key => { disk.delete(key); },
  });
  void storage.setItem('progress', 'first');
  await Promise.resolve();
  void storage.setItem('progress', 'second');
  void storage.setItem('progress', 'latest');
  let finished = false;
  const flush = storage.flush().then(() => { finished = true; });
  assert.equal(finished, false);
  releases.shift()!();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disk.get('progress'), 'first');
  assert.equal(finished, false);
  releases.shift()!();
  await flush;
  assert.equal(maxConcurrent, 1);
  assert.equal(disk.get('progress'), 'latest');
});

it('a failed write is visible, does not rehydrate stale disk data, and retries the latest snapshot', async () => {
  let fail = true, saved = 'old';
  let failures: string[] = [];
  const storage = createQueuedStorage({
    getItem: async () => saved,
    setItem: async (_key, value) => { if (fail) throw new Error('Disk full'); saved = value; },
    removeItem: async () => {},
  }, keys => { failures = keys; });
  await storage.setItem('progress', 'first edit');
  await storage.setItem('progress', 'latest edit');
  assert.deepEqual(failures, ['progress']);
  await assert.rejects(storage.flush(), /Disk full/);
  await assert.rejects(storage.getItem('progress'), /Disk full/);
  fail = false;
  await storage.retry();
  assert.equal(saved, 'latest edit');
  assert.deepEqual(failures, []);
});

it('removal is ordered after an in-flight write', async () => {
  let saved: string | null = null;
  let release!: () => void;
  const storage = createQueuedStorage({
    getItem: async () => saved,
    setItem: async (_key, value) => { await new Promise<void>(resolve => { release = resolve; }); saved = value; },
    removeItem: async () => { saved = null; },
  });
  void storage.setItem('progress', 'old');
  await Promise.resolve();
  void storage.removeItem('progress');
  release();
  await storage.flush();
  assert.equal(saved, null);
});

it('a write arriving as the previous promise settles is not stranded', async () => {
  let saved = '';
  const storage = createQueuedStorage({
    getItem: async () => saved,
    setItem: async (_key, value) => {
      saved = value;
      if (value === 'first') queueMicrotask(() => queueMicrotask(() => { void storage.setItem('progress', 'latest'); }));
    },
    removeItem: async () => {},
  });
  await storage.setItem('progress', 'first');
  await new Promise(resolve => setImmediate(resolve));
  await storage.flush();
  assert.equal(saved, 'latest');
});
