import { describe, it, expect, vi } from 'vitest';
import type { DocumentReference } from 'firebase/firestore';
import { applyDeletionPlan, DELETION_CHUNK, type DeletionWriteKit } from './accountDeletion';
import { CASCADE_PARTIAL } from '../authErrors';

/**
 * BIN-876 / ADR 0020 condition 5 — the PRODUCER of the partial-cascade signal.
 *
 * `applyDeletionPlan` commits in ≤450-op chunks. Each chunk is atomic; the run
 * of chunks is not. Whether it tags the failure decides which of two opposite
 * sentences a half-erased user reads — "en del av din data kan redan vara
 * borttagen" or "Ingenting har raderats." Four tests pin the consumer of that
 * tag and none pinned its producer, so mutating `if (committedChunks === 0)
 * throw err;` to always rethrow untagged survived the entire 3000-test suite
 * (test review, 2026-08-13). Every `CASCADE_PARTIAL` fixture in the repo was a
 * string built by hand in a UI test.
 *
 * `applyDeletionPlan` takes an injected `DeletionWriteKit`, so the boundary can
 * be driven directly: fail on commit N and assert which side of it we are on.
 */

/** A ref only needs to be an object here — nothing dereferences it. */
function refs(n: number): DocumentReference[] {
  return Array.from({ length: n }, (_, i) => ({ id: `d${i}` } as unknown as DocumentReference));
}

/** A kit whose Nth `commit()` (1-based) rejects; all others resolve. */
function kitFailingOnCommit(failOn: number) {
  let commits = 0;
  const commit = vi.fn(async () => {
    commits += 1;
    if (commits === failOn) throw new Error('FirebaseError: client is offline');
  });
  const kit = {
    db: {},
    writeBatch: () => ({ delete: vi.fn(), update: vi.fn(), commit }),
    serverTimestamp: () => 'ts',
  } as unknown as DeletionWriteKit;
  return { kit, commit };
}

const EMPTY = { memberLeaveUpdates: [], editorLeaveUpdates: [] };

describe('applyDeletionPlan — vad felet säger om hur långt det hann', () => {
  it('en lyckad plan kastar inget och committar en klump per 450 refs', async () => {
    const { kit, commit } = kitFailingOnCommit(0);

    await applyDeletionPlan(kit, { refs: refs(DELETION_CHUNK + 1), ...EMPTY });

    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('fel på FÖRSTA klumpen lämnas OTAGGAT — ingenting hann committas', async () => {
    // Den här grenen är hela grunden för att den generiska texten får säga
    // "Ingenting har raderats." Taggas den, börjar appen skrämma folk vars data
    // är helt intakt.
    const { kit } = kitFailingOnCommit(1);

    // Ett anrop, båda påståendena — kitets räknare är delad, så ett andra anrop
    // hade failat på en annan klump och prövat något annat än det som står här.
    const err = await applyDeletionPlan(kit, { refs: refs(10), ...EMPTY })
      .then(() => null, (e: unknown) => e as Error);

    expect(err?.message).toContain('client is offline');
    expect(err?.message).not.toContain(CASCADE_PARTIAL);
  });

  it('fel på ANDRA klumpen TAGGAS — första klumpen är redan borta', async () => {
    // Kärnan i BIN-876. Utan taggen läser användaren "Ingenting har raderats"
    // om ett konto som just förlorat 450 dokument.
    const { kit, commit } = kitFailingOnCommit(2);

    await expect(applyDeletionPlan(kit, { refs: refs(DELETION_CHUNK + 1), ...EMPTY }))
      .rejects.toThrow(CASCADE_PARTIAL);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('originalfelet finns kvar som `cause`, inte bortslängt', async () => {
    const { kit } = kitFailingOnCommit(2);

    const err = await applyDeletionPlan(kit, { refs: refs(DELETION_CHUNK + 1), ...EMPTY })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    // Både den ursprungliga meningen (för loggen) och orsakskedjan (för
    // felsökning) ska överleva ompaketeringen.
    expect((err as Error).message).toContain('client is offline');
    expect(((err as Error & { cause?: unknown }).cause as Error).message).toContain('client is offline');
  });

  it('ett fel i medlemsutträdes-fasen taggas också — raderingarna kom före', async () => {
    // Uppdateringsloopen körs EFTER alla raderingar, så allt som failar där har
    // per definition redan tömt kontot. Grenen glöms lätt bort eftersom den
    // ligger i en annan loop än den som testet ovan träffar.
    const { kit } = kitFailingOnCommit(2);

    await expect(applyDeletionPlan(kit, {
      refs: refs(10),
      memberLeaveUpdates: [{ ref: refs(1)[0], newMemberUids: [] }],
      editorLeaveUpdates: [],
    })).rejects.toThrow(CASCADE_PARTIAL);
  });

  it('DELETION_CHUNK håller sig under Firestores tak på 500', async () => {
    // Fixturerna ovan härleds ur konstanten, så de följer med om den ändras —
    // 450 → 600 överlevde hela filen (testgranskningen 2026-08-13). Taket är
    // Firestores, inte vårt, och att spränga det gör varje klump ogiltig.
    expect(DELETION_CHUNK).toBeLessThan(500);
    expect(DELETION_CHUNK).toBeGreaterThan(100);
  });

  it('en tom plan committar ingenting och kastar ingenting', async () => {
    const { kit, commit } = kitFailingOnCommit(1);

    await applyDeletionPlan(kit, { refs: [], ...EMPTY });

    expect(commit).not.toHaveBeenCalled();
  });
});
