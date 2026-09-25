import './setup';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useStore, useHydrationState } from '../src/store/useStore';
import { createDefaultProgress } from '../src/store/progressTypes';

it('failed hydration preserves storage and can recover on retry', async () => {
  await useStore.persist.rehydrate();
  const original = useStore.persist.getOptions().storage;
  let writes = 0;
  let corrupt = true;
  const saved = createDefaultProgress();
  saved.activeLanguages = ['fr'];
  useStore.persist.setOptions({ storage: {
    getItem: async () => {
      if (corrupt) throw new Error('Unreadable JSON');
      return { state: saved, version: 0 };
    },
    setItem: async () => { writes++; },
    removeItem: async () => {},
  } });
  try {
    await useStore.persist.rehydrate();
    assert.equal(useHydrationState.getState().ready, false);
    assert.ok(useHydrationState.getState().error);
    assert.equal(writes, 0);
    corrupt = false;
    await useStore.persist.rehydrate();
    assert.equal(useHydrationState.getState().ready, true);
    assert.deepEqual(useStore.getState().activeLanguages, ['fr']);
    assert.ok(useStore.getState().words.length > 0);
  } finally { useStore.persist.setOptions({ storage: original }); }
});
