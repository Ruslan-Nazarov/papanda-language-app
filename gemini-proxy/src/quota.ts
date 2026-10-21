export interface QuotaLimits { perInstallHourly: number; perInstallDaily: number; globalDaily: number }
interface InstallQuota { day: number; hour: string; hourly: number }
export interface QuotaState { day: string; total: number; installs: Record<string, InstallQuota> }
export type QuotaFailure = 'GLOBAL_DAILY' | 'INSTALL_HOURLY' | 'INSTALL_DAILY';

export const reserveQuota = (previous: QuotaState | undefined, installId: string, limits: QuotaLimits, now: Date):
  { state: QuotaState; failure?: QuotaFailure } => {
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  const state = previous?.day === day ? previous : { day, total: 0, installs: {} };
  const existing = Object.hasOwn(state.installs, installId) ? state.installs[installId] : undefined;
  const install = existing ?? { day: 0, hour, hourly: 0 };
  const hourly = install.hour === hour ? install.hourly : 0;
  if (install.day >= limits.perInstallDaily) return { state, failure: 'INSTALL_DAILY' };
  if (hourly >= limits.perInstallHourly) return { state, failure: 'INSTALL_HOURLY' };
  if (state.total >= limits.globalDaily) return { state, failure: 'GLOBAL_DAILY' };
  return { state: { day, total: state.total + 1, installs: {
    ...state.installs, [installId]: { day: install.day + 1, hour, hourly: hourly + 1 },
  } } };
};

/** One coordinator for this small global budget; all three counters commit together. */
export class QuotaLimiter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const { installId, limits } = await request.json() as { installId: string; limits: QuotaLimits };
    const now = new Date();
    const failure = await this.state.storage.transaction(async transaction => {
      const previous = await transaction.get<QuotaState>('quota');
      const result = reserveQuota(previous, installId, limits, now);
      if (!result.failure) await transaction.put('quota', result.state);
      return result.failure;
    });
    return Response.json({ failure });
  }
}
