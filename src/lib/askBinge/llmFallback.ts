// BIN-176 — client wrapper for the askBingeParse callable (the LLM fallback).
//
// Called ONLY when the deterministic parser (parseSearch) returned nothing. Returns
// a sanitized AskFilter (the function clamps server-side), or null on ANY failure —
// not-deployed, unauthenticated, rate-limited, or the model gave up. Null = caller
// keeps the deterministic "förstod inte" help state, so the feature degrades
// gracefully and stays fully functional before the function is even deployed.

import type { AskFilter } from './types';

export async function llmParseFallback(query: string): Promise<AskFilter | null> {
  if (typeof window === 'undefined') return null;
  try {
    // Lazy import keeps firebase/functions out of the first-load bundle (as fsdb does).
    const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import('firebase/functions');
    const app = (await import('@/lib/firebase/config')).default;
    const functions = getFunctions(app, 'europe-west1');
    if (process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true') {
      try { connectFunctionsEmulator(functions, '127.0.0.1', 5001); } catch { /* idempotent */ }
    }
    const res = await httpsCallable<{ query: string }, { filter: AskFilter; cached: boolean }>(
      functions,
      'askBingeParse',
    )({ query });
    const filter = res.data?.filter;
    if (!filter || typeof filter !== 'object' || Object.keys(filter).length === 0) return null;
    return filter;
  } catch {
    return null;
  }
}
