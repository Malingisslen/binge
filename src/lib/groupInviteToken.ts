const DAY_MS = 24 * 60 * 60 * 1000;
export const AUTO_ROTATE_AFTER_DAYS = 30;
export const STALE_NUDGE_AFTER_DAYS = 180;

export function inviteTokenAgeDays(rotatedAt: Date | null, now: number): number | null {
  if (!rotatedAt) return null;
  const diff = now - rotatedAt.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / DAY_MS);
}
export function inviteTokenAgeLabel(rotatedAt: Date | null, now: number): string | null {
  const days = inviteTokenAgeDays(rotatedAt, now);
  if (days === null) return null;
  if (days < 30) { const unit = days === 1 ? 'dag' : 'dagar'; return `Länken är ${days} ${unit} gammal`; }
  const months = Math.floor(days / 30); const unit = months === 1 ? 'månad' : 'månader';
  return `Länken är ${months} ${unit} gammal`;
}
export function shouldAutoRotateInviteToken(params: {
  isOwner: boolean; tokenIsActive: boolean; rotatedAt: Date | null; now: number;
}): boolean {
  if (!params.isOwner || !params.tokenIsActive) return false;
  const days = inviteTokenAgeDays(params.rotatedAt, params.now);
  if (days === null) return false;
  return days >= AUTO_ROTATE_AFTER_DAYS;
}
