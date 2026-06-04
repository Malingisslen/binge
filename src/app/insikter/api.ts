import type { InsightsData } from './insights.types';
import type { DateRange } from './state/useDateRange';

/** Raised on a non-OK /api/insights response so the hook can show a message. */
export class InsightsApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'InsightsApiError';
  }
}

export async function fetchInsights(
  token: string,
  range: DateRange,
  signal?: AbortSignal,
): Promise<InsightsData> {
  const params = new URLSearchParams({ range: range.preset });
  if (range.preset === 'custom') {
    params.set('from', range.from);
    params.set('to', range.to);
  }
  const res = await fetch(`/api/insights?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (res.status === 401) throw new InsightsApiError(401, 'Ogiltig behörighet.');
  if (!res.ok) throw new InsightsApiError(res.status, `Serverfel (${res.status}).`);
  const json = (await res.json()) as { success: boolean; data: InsightsData };
  if (!json.success) throw new InsightsApiError(500, 'Kunde inte ladda insikter.');
  return json.data;
}
