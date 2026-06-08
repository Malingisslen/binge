import { describe, it, expect } from 'vitest';
import {
  inviteTokenAgeDays, inviteTokenAgeLabel, shouldAutoRotateInviteToken,
  AUTO_ROTATE_AFTER_DAYS, STALE_NUDGE_AFTER_DAYS,
} from './groupInviteToken';
const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-06-04T12:00:00Z').getTime();

describe('inviteTokenAgeDays', () => {
  it('null when rotatedAt is null', () => { expect(inviteTokenAgeDays(null, now)).toBeNull(); });
  it('whole days since rotation', () => { expect(inviteTokenAgeDays(new Date(now - 10 * DAY), now)).toBe(10); });
  it('floors partial days', () => { expect(inviteTokenAgeDays(new Date(now - (5 * DAY + DAY / 2)), now)).toBe(5); });
  it('clamps future rotatedAt to 0', () => { expect(inviteTokenAgeDays(new Date(now + 3 * DAY), now)).toBe(0); });
});
describe('inviteTokenAgeLabel', () => {
  it('null when unknown', () => { expect(inviteTokenAgeLabel(null, now)).toBeNull(); });
  it('words days under a month', () => { expect(inviteTokenAgeLabel(new Date(now - 5 * DAY), now)).toBe('Länken är 5 dagar gammal'); });
  it('singular dag for one day', () => { expect(inviteTokenAgeLabel(new Date(now - 1 * DAY), now)).toBe('Länken är 1 dag gammal'); });
  it('words whole months ≥ 30 days', () => { expect(inviteTokenAgeLabel(new Date(now - 60 * DAY), now)).toBe('Länken är 2 månader gammal'); });
  it('singular månad for one month', () => { expect(inviteTokenAgeLabel(new Date(now - 30 * DAY), now)).toBe('Länken är 1 månad gammal'); });
});
describe('shouldAutoRotateInviteToken', () => {
  it('false when token inactive', () => { expect(shouldAutoRotateInviteToken({ isOwner: true, tokenIsActive: false, rotatedAt: new Date(now - 200 * DAY), now })).toBe(false); });
  it('false when not owner', () => { expect(shouldAutoRotateInviteToken({ isOwner: false, tokenIsActive: true, rotatedAt: new Date(now - 200 * DAY), now })).toBe(false); });
  it('false when rotatedAt unknown', () => { expect(shouldAutoRotateInviteToken({ isOwner: true, tokenIsActive: true, rotatedAt: null, now })).toBe(false); });
  it('false when younger than threshold', () => { expect(shouldAutoRotateInviteToken({ isOwner: true, tokenIsActive: true, rotatedAt: new Date(now - 29 * DAY), now })).toBe(false); });
  it('true when owner + older than 30 days', () => { expect(shouldAutoRotateInviteToken({ isOwner: true, tokenIsActive: true, rotatedAt: new Date(now - 31 * DAY), now })).toBe(true); });
  it('true at the threshold boundary', () => { expect(shouldAutoRotateInviteToken({ isOwner: true, tokenIsActive: true, rotatedAt: new Date(now - AUTO_ROTATE_AFTER_DAYS * DAY), now })).toBe(true); });
});
describe('constants', () => {
  it('thresholds are 30 and 180 days', () => { expect(AUTO_ROTATE_AFTER_DAYS).toBe(30); expect(STALE_NUDGE_AFTER_DAYS).toBe(180); });
});
