import { describe, it, expect } from 'vitest';
import { dueRotationEvents, type RotationScheduleItem } from './logic';

const TODAY = '2026-08-01';

const item = (over: Partial<RotationScheduleItem> = {}): RotationScheduleItem => ({
  providerId: 76,
  shortName: 'Viaplay',
  cancelDate: '2026-08-01',
  resumeDate: '2026-09-12',
  ...over,
});

describe('dueRotationEvents', () => {
  it('fires a cancel event due today', () => {
    const due = dueRotationEvents([item({ resumeDate: null })], TODAY);
    expect(due).toEqual([{ providerId: 76, shortName: 'Viaplay', kind: 'cancel', date: '2026-08-01' }]);
  });

  it('fires a cancel event due tomorrow (within the default 1-day window)', () => {
    const due = dueRotationEvents([item({ cancelDate: '2026-08-02', resumeDate: null })], TODAY);
    expect(due).toEqual([{ providerId: 76, shortName: 'Viaplay', kind: 'cancel', date: '2026-08-02' }]);
  });

  it('does not fire an event two days out with the default window', () => {
    const due = dueRotationEvents([item({ cancelDate: '2026-08-03', resumeDate: null })], TODAY);
    expect(due).toEqual([]);
  });

  it('does not fire a past event', () => {
    const due = dueRotationEvents([item({ cancelDate: '2026-07-30', resumeDate: null })], TODAY);
    expect(due).toEqual([]);
  });

  it('fires a resume event when it lands in the window, not its far-future cancel', () => {
    const due = dueRotationEvents([item({ cancelDate: '2026-06-01', resumeDate: '2026-08-01' })], TODAY);
    expect(due).toEqual([{ providerId: 76, shortName: 'Viaplay', kind: 'resume', date: '2026-08-01' }]);
  });

  it('yields BOTH cancel and resume when both land in the window', () => {
    const due = dueRotationEvents([item({ cancelDate: '2026-08-01', resumeDate: '2026-08-02' })], TODAY, 2);
    expect(due).toEqual([
      { providerId: 76, shortName: 'Viaplay', kind: 'cancel', date: '2026-08-01' },
      { providerId: 76, shortName: 'Viaplay', kind: 'resume', date: '2026-08-02' },
    ]);
  });

  it('never yields a resume for an open-ended pause — but still yields the cancel', () => {
    const due = dueRotationEvents([item({ cancelDate: '2026-08-01', resumeDate: null })], TODAY);
    expect(due).toEqual([{ providerId: 76, shortName: 'Viaplay', kind: 'cancel', date: '2026-08-01' }]);
  });

  it('respects a wider window', () => {
    const due = dueRotationEvents([item({ cancelDate: '2026-08-05', resumeDate: null })], TODAY, 7);
    expect(due).toEqual([{ providerId: 76, shortName: 'Viaplay', kind: 'cancel', date: '2026-08-05' }]);
  });

  it('handles a multi-item schedule — only the due item fires', () => {
    const due = dueRotationEvents([
      item({ providerId: 76, shortName: 'Viaplay', cancelDate: '2026-08-01', resumeDate: null }),
      item({ providerId: 8, shortName: 'Netflix', cancelDate: '2026-12-01', resumeDate: null }), // far out
    ], TODAY);
    expect(due).toEqual([{ providerId: 76, shortName: 'Viaplay', kind: 'cancel', date: '2026-08-01' }]);
  });
});
