import { describe, it, expect } from 'vitest';
import { SWEDISH_PROVIDERS } from './providers';
// functions/ cannot import client source, so the server keeps a copy. Importing
// both here is the only thing that sees them drift (same technique as
// mediaTypeDocId.parity.test.ts).
import { PROVIDER_NAMES } from '../../../functions/src/shared/providerNames';

describe('PROVIDER_NAMES parity (BIN-1442)', () => {
  it('names every client provider exactly as the client does, and nothing else', () => {
    const client = Object.fromEntries(SWEDISH_PROVIDERS.map(p => [p.id, p.name]));
    expect(PROVIDER_NAMES).toEqual(client);
  });
});
