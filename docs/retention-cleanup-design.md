# Retention cleanup cron — design

_Status: design only. Implementation kräver Cloud Functions (Blaze-plan)._

Automatisk städning av gammal data som inte täcks av self-service-radering.
Scheduled Cloud Functions kör på en given cadence och tar bort docs som
passerat sin retention-tid.

## Data-typer att städa

### 1. Tillsammans-sessioner (högsta prio)

- **Retention:** 30 dagar efter `expiresAt`
- **Varför:** Users slutar bry sig efter session. `expiresAt` = create + 7d,
  så en hard-delete efter 30d (= 37d efter create) lämnar en generös margin
  om någon vill se resultatet.
- **Cascade:** delete parent + alla participants + alla swipes
- **Kod:**
  ```ts
  // functions/scheduled/cleanupSessions.ts
  export const cleanupSessions = onSchedule('0 3 * * *', async () => {
    const cutoff = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const q = db.collection('sessions').where('expiresAt', '<', cutoff);
    const snap = await q.get();
    const batch = db.batch();
    for (const doc of snap.docs) {
      // Cascade subcollections
      const [partSnap, swipeSnap] = await Promise.all([
        doc.ref.collection('participants').get(),
        doc.ref.collection('swipes').get(),
      ]);
      for (const p of partSnap.docs) batch.delete(p.ref);
      for (const s of swipeSnap.docs) batch.delete(s.ref);
      batch.delete(doc.ref);
    }
    await batch.commit();
  });
  ```
- **Batch-size-warning:** om > 500 sessions per körning behövs chunking

### 2. Notifikationer (medel prio)

- **Retention:** 90 dagar efter `createdAt`
- **Varför:** notifikationer är ephemera — efter 3 månader är innehållet
  irrelevant + users har troligen klickat/dismissat

### 3. Reports (låg prio)

- **Retention:** behåll öppna + reviewed; delete actioned/dismissed
  efter 1 år
- **Varför:** audit-trail-värde klingar av; GDPR art. 5 (storage limitation)
  förbjuder oändlig retention utan syfte
- **Ta med till raderings-queue, inte auto:** vi kan vilja granska på
  gammal data om vi hittar en återfall-user. Semi-manuell.

### 4. Gammal Firestore PITR

Inte vår fråga — Firebase hanterar själv (7 dagar cap).

## Schedule-cadence

```yaml
cleanupSessions: '0 3 * * *'     # Dagligen kl 03:00 UTC
cleanupNotifications: '0 4 * * 0' # Söndag 04:00 UTC
reviewReportsArchive: 'manual'    # Utföras av admin via console
```

## Triggering

Options:
1. **Firebase Cloud Scheduler** (v2 functions `onSchedule`) — native, enkel
2. **Cloud Tasks** — flexiblare men overkill
3. **External cron (cron-job.org hits en HTTP-endpoint)** — inget Blaze-
   krav men kräver en auth-skyddad endpoint + inte idiomatisk med Firebase

Välj **option 1** — samma billing-plan täcker allt + ingen extern dep.

## Observability

- Varje cleanup-funktion rapporterar: `{ deletedCount, durationMs, error? }`
- Logga till Cloud Logging (automatic)
- Om `deletedCount === 0` i mer än 7 dagar → alarm (funktion bruten?)
- Om `durationMs > 60s` → alarm (för många docs, behöver chunking)

## Fail-safes

- **Dry-run mode:** första deploy körs med `dryRun: true`-flagga som
  loggar vad som skulle raderas men gör ingen faktisk delete. Verifiera
  en vecka innan enforce:ment.
- **Rollback:** PITR ger 7 dagars fönster om cleanup-cron av misstag
  raderar för mycket. Inget separat backup-skikt.

## Implementation-plan (Sprint 10 — monetization)

Ligger bakom Blaze-plan-upgrade (Sprint 10 B24). När det sker:

1. `firebase init functions` i separat subdir
2. Lägg till schemaläggningarna i `functions/src/scheduled/`
3. Deploy med `firebase deploy --only functions`
4. Observe i Cloud Logging 1 vecka i dry-run
5. Flip `dryRun: false`

## Kopplingar

- `docs/data-retention-policy.md` — high-level policy, vi refererar den
  i integritet/page.tsx
- `docs/moderation.md` — §5 nämner rate-limit + manuell retention för
  reports
- `docs/RUNBOOK.md` — loggbok om cleanup-cron bryts

## Öppna frågor

- **Ska vi notify:a user innan delete?** Nuvarande svar: nej (sessionerna
  är ephemera, notifikationer redan lästa, reports privat). Kan omvärderas.
- **Soft-delete vs hard-delete?** Hard. Soft-delete skulle kräva `deletedAt`-
  flagga + filter i alla read-paths, för komplext för fördel:en.
