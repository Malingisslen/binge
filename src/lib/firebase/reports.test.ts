// BIN-1250. `updateReportStatus` bär en intern motivering. Testen pinnar vad som
// skrivs — klampat vid taket, utelämnat när det är tomt — och att taket är samma tal
// som `firestore.rules` sätter. Reglernas eget beteende prövas i emulatorsviten.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const updateDoc = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}));
vi.mock('./db', () => ({
  fsdb: async () => ({
    db: {},
    doc: (_db: unknown, ...path: string[]) => ({ _path: path.join('/') }),
    updateDoc,
    serverTimestamp: () => 'ts',
  }),
}));

import { updateReportStatus, MAX_DECISION_NOTE } from './reports';

function written(): Record<string, unknown> {
  return updateDoc.mock.calls[0][1] as Record<string, unknown>;
}

beforeEach(() => updateDoc.mockClear());

describe('updateReportStatus — intern motivering (BIN-1250)', () => {
  it('skriver motiveringen trimmad tillsammans med status', async () => {
    await updateReportStatus('r1', 'dismissed', 'admin', '  dubblett av r0  ');
    expect(written()).toEqual({
      status: 'dismissed', actionedByUid: 'admin', updatedAt: 'ts', decisionNote: 'dubblett av r0',
    });
  });

  it('skickar inte fältet alls när motiveringen är tom, så en sparad notering står kvar', async () => {
    await updateReportStatus('r1', 'open', 'admin', '   ');
    expect(written()).not.toHaveProperty('decisionNote');
    await updateReportStatus('r1', 'open', 'admin');
    expect(updateDoc.mock.calls[1][1]).not.toHaveProperty('decisionNote');
  });

  it('en motivering på exakt taket skrivs oförändrad, en över taket kapas till taket', async () => {
    await updateReportStatus('r1', 'actioned', 'admin', 'a'.repeat(MAX_DECISION_NOTE));
    expect(written().decisionNote).toBe('a'.repeat(MAX_DECISION_NOTE));
    updateDoc.mockClear();
    await updateReportStatus('r1', 'actioned', 'admin', 'a'.repeat(MAX_DECISION_NOTE + 1));
    expect(written().decisionNote).toBe('a'.repeat(MAX_DECISION_NOTE));
  });

  it('taket är samma tal som firestore.rules sätter på reports.decisionNote', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const block = rules.slice(rules.indexOf('match /reports/{reportId}'));
    const m = /decisionNote\.size\(\)\s*<=\s*(\d+)/.exec(block);
    expect(m, 'hittade inget tak för decisionNote i reports-blocket').not.toBeNull();
    expect(Number(m![1])).toBe(MAX_DECISION_NOTE);
  });
});
