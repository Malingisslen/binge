/**
 * Rena hjälpfunktioner för TV-kopplingen (BIN-1471). Ingen Firebase-import, så de
 * kan testas utan emulator.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Alfabet utan förväxlingsbara tecken (I, O, 0, 1). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;
export const PAIRING_TTL_MS = 60_000;
/** Raden städas av TTL-policyn; funktionen kontrollerar giltigheten själv eftersom TTL kan dröja ca ett dygn. */
export const PAIRING_ROW_TTL_MS = 10 * 60_000;
export const MIN_POLL_INTERVAL_MS = 4_000;
export const MAX_TV_DEVICES = 5;

export const RATE_LIMITS = {
  start: { max: 10, windowMs: 60 * 60_000 },
  approveUid: { max: 10, windowMs: 60 * 60_000 },
  approveIp: { max: 20, windowMs: 60 * 60_000 },
} as const;

export function generateUserCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** Tar emot "k7m2-9qxh", "K7M2 9QXH" osv. Returnerar null om det inte är en giltig kod. */
export function normalizeUserCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateDeviceSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function generateDeviceId(): string {
  return randomBytes(12).toString('hex');
}

export function secretMatches(secret: unknown, storedHashHex: unknown): boolean {
  if (typeof secret !== 'string' || typeof storedHashHex !== 'string') return false;
  const a = Buffer.from(sha256Hex(secret), 'hex');
  const b = Buffer.from(storedHashHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Enhetsnamn kommer från TV:n (Build.MODEL): kort, utan styrtecken. */
export function sanitizeDeviceName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Google TV';
  const cleaned = raw.replace(/[^\p{L}\p{N} ._()+-]/gu, '').trim().slice(0, 40);
  return cleaned || 'Google TV';
}

export function isExpired(expiresAtMs: number, nowMs: number): boolean {
  return nowMs >= expiresAtMs;
}

export interface RateState { windowStartMs: number; count: number }

/** Fast fönster. Returnerar nästa tillstånd, eller null när gränsen är nådd. */
export function nextRateState(
  prev: RateState | null,
  nowMs: number,
  limit: { max: number; windowMs: number },
): RateState | null {
  if (!prev || nowMs - prev.windowStartMs >= limit.windowMs) return { windowStartMs: nowMs, count: 1 };
  if (prev.count >= limit.max) return null;
  return { windowStartMs: prev.windowStartMs, count: prev.count + 1 };
}

/** IP sparas aldrig i klartext: saltad med dygnet så hashen slutar kunna länkas efter ett dygn. */
export function ipRateKey(prefix: string, ip: string, dayId: string): string {
  return `${prefix}_${sha256Hex(`${dayId}|${ip}`).slice(0, 32)}`;
}

export function tvPrincipalUid(deviceId: string): string {
  return `tv_${deviceId}`;
}

export function pollTooSoon(lastPollMs: number | null, nowMs: number): boolean {
  return lastPollMs != null && nowMs - lastPollMs < MIN_POLL_INTERVAL_MS;
}
