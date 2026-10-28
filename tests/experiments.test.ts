import './setup';
import { beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../src/store/useStore';
import { createDefaultProgress } from '../src/store/progressTypes';
import { activeExperimentRun, type ExperimentRun } from '../src/models/experiments';
import { previewBackup } from '../src/services/backupFormat';

const id = 'hide-daily-review';
beforeEach(() => { assert.equal(useStore.getState().importProgress(createDefaultProgress()).ok, true); });

it('starts, stops and restarts without duplicating active runs or overwriting history', () => {
  const store = useStore.getState();
  assert.equal(activeExperimentRun(store.experiments[id]), undefined);
  store.stopExperiment(id);
  assert.deepEqual(useStore.getState().experiments, {});
  store.setExperimentNote(id, 'Проверяем пользу блока');
  store.startExperiment(id);
  const first = activeExperimentRun(useStore.getState().experiments[id])!;
  assert.ok(Number.isFinite(Date.parse(first.startedAt)));
  store.startExperiment(id);
  assert.equal(useStore.getState().experiments[id].runs.length, 1);
  store.setExperimentNote(id, 'Без блока экран понятнее', first.id);
  store.stopExperiment(id);
  assert.equal(activeExperimentRun(useStore.getState().experiments[id]), undefined);
  const stopped = useStore.getState().experiments[id].runs[0];
  assert.ok(Date.parse(stopped.stoppedAt!) >= Date.parse(stopped.startedAt));
  store.stopExperiment(id);
  assert.equal(useStore.getState().experiments[id].runs[0], stopped);
  store.startExperiment(id);
  const experiment = useStore.getState().experiments[id];
  assert.equal(experiment.note, 'Проверяем пользу блока');
  assert.equal(experiment.runs.length, 2);
  assert.equal(experiment.runs[0], stopped);
  assert.equal(stopped.note, 'Без блока экран понятнее');
  assert.notEqual(experiment.runs[1].id, first.id);
  assert.equal(activeExperimentRun(experiment), experiment.runs[1]);
  store.setExperimentNote(id, 'Итог первого запуска', first.id);
  assert.equal(useStore.getState().experiments[id].runs[0].note, 'Итог первого запуска');
  assert.equal(useStore.getState().experiments[id].runs[1].note, '');
});

it('keeps experiments in backups and persistence, and preserves them on statistics reset', async () => {
  await useStore.persist.rehydrate();
  const store = useStore.getState();
  store.setExperimentNote(id, 'Общая заметка');
  store.startExperiment(id);
  store.stopExperiment(id);
  store.startExperiment(id);
  const expected = store.exportProgress().experiments;
  store.resetStatistics();
  assert.deepEqual(useStore.getState().experiments, expected);
  const preview = previewBackup(JSON.stringify({ app: 'papanda', version: 1, data: store.exportProgress() }));
  store.importProgress(createDefaultProgress());
  assert.equal(store.importProgress(preview.data).ok, true);
  assert.deepEqual(useStore.getState().experiments, expected);

  const storage = useStore.persist.getOptions().storage;
  let saved = { state: store.exportProgress(), version: 0 };
  useStore.persist.setOptions({ storage: {
    getItem: async () => saved,
    setItem: async (_key, value) => { saved = JSON.parse(JSON.stringify(value)); },
    removeItem: async () => {},
  } });
  try {
    store.setExperimentNote(id, 'Сохранено после изменения');
    assert.deepEqual(saved.state.experiments, useStore.getState().experiments);
    useStore.setState({ experiments: {} });
    // Restore the disk snapshot to simulate a fresh process with empty memory.
    saved.state.experiments = { ...expected, [id]: { ...expected[id], note: 'Сохранено после изменения' } };
    await useStore.persist.rehydrate();
    assert.deepEqual(useStore.getState().experiments, saved.state.experiments);
    assert.ok(activeExperimentRun(useStore.getState().experiments[id]));
  } finally { useStore.persist.setOptions({ storage }); }
});

it('older profiles start with no experiments enabled', () => {
  useStore.getState().startExperiment(id);
  assert.equal(useStore.getState().importProgress({ userWordProgress: {} }).ok, true);
  assert.deepEqual(useStore.getState().experiments, {});
});

it('rejects broken dates, overlapping runs and duplicate IDs atomically', () => {
  const run: ExperimentRun = { id: 'first', startedAt: '2026-10-20T00:00:00Z', stoppedAt: '2026-10-21T00:00:00Z', note: '' };
  const invalid = [
    null,
    { note: 42, runs: [] },
    { note: '', runs: [null] },
    { note: '', runs: [{ ...run, startedAt: 'bad date' }] },
    { note: '', runs: [{ ...run, stoppedAt: 'bad date' }] },
    { note: '', runs: [{ ...run, stoppedAt: '2026-10-19T00:00:00Z' }] },
    { note: '', runs: [{ ...run, stoppedAt: null }, { ...run, id: 'second' }] },
    { note: '', runs: [run, { ...run, id: 'second' }] },
    { note: '', runs: [run, { ...run, startedAt: run.stoppedAt, stoppedAt: null }] },
  ];
  const initial = useStore.getState();
  for (const experiment of invalid) {
    assert.equal(initial.importProgress({ userWordProgress: {}, experiments: { [id]: experiment } }).ok, false);
    assert.equal(useStore.getState(), initial);
  }
});

it('preserves histories for future experiments without activating a known feature', () => {
  const future = { note: 'Будущий эксперимент', runs: [] };
  assert.equal(useStore.getState().importProgress({ userWordProgress: {}, experiments: { future } }).ok, true);
  assert.deepEqual(useStore.getState().exportProgress().experiments.future, future);
  assert.equal(activeExperimentRun(useStore.getState().experiments[id]), undefined);
});
