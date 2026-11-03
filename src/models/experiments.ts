export interface ExperimentRun {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  note: string;
}

export interface ExperimentProgress {
  note: string;
  runs: ExperimentRun[];
}

export const EXPERIMENTS = [{
  id: 'sentence-lessons',
  title: 'Занятия по 5 предложений',
  description: 'Короткие занятия с одной целью, повторением трудных мест, сохранением шага и итогом. Остановка возвращает обычный тренажёр; прогресс занятий сохраняется.',
}] as const;

export type ExperimentId = typeof EXPERIMENTS[number]['id'];

export const activeExperimentRun = (experiment?: ExperimentProgress): ExperimentRun | undefined => {
  const last = experiment?.runs[experiment.runs.length - 1];
  return last?.stoppedAt === null ? last : undefined;
};

/** Validate saved histories, including the single active run at the end. */
export function isExperimentProgress(value: unknown): value is ExperimentProgress {
  if (!value || typeof value !== 'object') return false;
  const experiment = value as ExperimentProgress;
  if (typeof experiment.note !== 'string' || !Array.isArray(experiment.runs)) return false;
  const ids = new Set<string>();
  let previousStop = -Infinity;
  return experiment.runs.every((run, index) => {
    if (!run || typeof run !== 'object' || typeof run.id !== 'string' || !run.id.trim() || ids.has(run.id) ||
      typeof run.note !== 'string' || typeof run.startedAt !== 'string') return false;
    ids.add(run.id);
    const start = Date.parse(run.startedAt);
    if (!Number.isFinite(start) || start < previousStop) return false;
    if (run.stoppedAt === null) return index === experiment.runs.length - 1;
    if (typeof run.stoppedAt !== 'string') return false;
    const stop = Date.parse(run.stoppedAt);
    if (!Number.isFinite(stop) || stop < start) return false;
    previousStop = stop;
    return true;
  });
}
