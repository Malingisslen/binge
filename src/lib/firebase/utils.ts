import { Timestamp } from 'firebase/firestore';

export function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate();
  if (val instanceof Date) return val;
  return new Date();
}

// Kryptografiskt slumpmässig token för delade hemligheter (invite-länkar).
// Math.random är otillräcklig när hash:en lagrad i Firestore exponeras —
// 128 bitars entropi gör brute-force omöjligt även med GPU-rigs.
export function generateSecureToken(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// SHA-256 som lowercase hex. Matchar Firestore-regelns
// hashing.sha256(s).toHexString() bit för bit.
export async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
