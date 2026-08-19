'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/layout/PageHeader';
import { classifyDeletionFailure } from '@/lib/authErrors';

/**
 * BIN-816 / ADR 0019 condition 4 — the screen a half-deleted account gets.
 *
 * The panel asked for "a real, persistent screen, not a self-dismissing toast",
 * on every load, reachable while the profile is null. Malin's answer of
 * 2026-08-13 (ADR 0020, question 3) went further: it has to *block*, not merely
 * explain. `firestore.rules`' `isOwner(uid)` never requires `users/{uid}` to
 * exist — it only checks that `request.auth.uid` matches the path — so a session
 * that survives a partial deletion can keep writing new watchlist items and
 * reviews, and the server sweep looks for accounts with no profile document and
 * therefore can never see what that session wrote. Every failed retry was a
 * chance for the data to grow rather than shrink.
 *
 * Replacing the whole shell is what makes the block real. Gating N write paths
 * would leave the N+1st, which is the same objection the panel raised against
 * per-call-site profile guards; if the app never renders a surface that writes,
 * there is no path to miss. The chokepoint in `userDocWrite.ts` stays as the
 * belt for the writes that run outside render (the auth listener, the projection
 * sync).
 *
 * Two ways out, and only two: finish the deletion, or sign out. There is
 * deliberately no "cancel" — by the time this screen exists the cascade has
 * already run, so the account it would restore no longer holds the data anyone
 * would want back.
 */
export function DeletionLimbo() {
  const { deleteAccount, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFinish = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      // `deleteAccount` returns early WITHOUT throwing when `auth.currentUser` is
      // null — a revoked token between render and click. That reads as success
      // here, and the screen would sit on "Slutför…" forever with no error and
      // no way out but a reload (integration review, 2026-08-13). On a real
      // success the provider unmounts this screen, so releasing the button is
      // harmless there and load-bearing here.
      setBusy(false);
    } catch (err: unknown) {
      // Same classifier as the settings page, deliberately — see authErrors.
      // The two screens say different things about the same four codes, but they
      // must never disagree about WHICH code they are looking at.
      //
      // BIN-936: nor about which BUTTON they name. The wordings differ on purpose —
      // the settings page narrates this state from a screen about to unmount and hands
      // the reader on, while this screen owns the action and says so in the present
      // tense — but "Slutför raderingen" below is the one thing both sides spell, so it
      // is the one thing that can silently drift. `DeleteAccountSection.test.tsx`
      // (describe "BIN-936") renders this component and reads the button's real label
      // rather than repeating it; run that test if you touch either wording.
      const kind = classifyDeletionFailure(err instanceof Error ? err.message : '');
      setError(
        kind === 'preflight' || kind === 'recent-login'
          ? 'Sessionen är för gammal. Logga ut, logga in igen och tryck på Slutför raderingen.'
          : kind === 'partial'
            ? 'Raderingen kom en bit till men blev inte klar. Tryck på Slutför raderingen igen.'
            : 'Det gick inte just nu. Kontrollera anslutningen och försök igen.',
      );
      setBusy(false);
    }
  };

  return (
    <main id="main" tabIndex={-1} className="canvas outline-none">
      <div className="max-w-[46rem]">
        <PageHeader
          crumb="Konto"
          title="Din radering är påbörjad men inte klar"
          // Deliberately says "kan" and not "hann": this screen is also what a
          // user sees when the cascade failed on its very FIRST chunk, where
          // nothing was deleted at all (.claude/rules/accepted-deviations.md,
          // 2026-08-13). Claiming the data is gone would be the mirror image of
          // the lie BIN-876 was filed about, and DeletionLimbo.test.tsx pins
          // that this screen asserts neither extreme.
          standfirst="En del av din data kan redan vara borttagen, men själva kontot finns kvar. Tills raderingen är klar kan du inte spara något nytt här."
        />

        {/*
          The automatic-cleanup promise is CONDITIONAL, and saying so is the whole
          point. `retentionCleanup`'s sweep keys on the ABSENCE of `users/{uid}`,
          so it never fires while the profile document is still there — which is
          exactly the state a cascade that failed on its first chunk leaves, with
          all the data intact (`.claude/rules/accepted-deviations.md`, 2026-08-13),
          and the commonest transient failure there is. An unconditional "we will
          clean it up" told the person least likely to be swept that they could
          walk away. That is the BIN-876 defect class reproduced inside the screen
          added to fix it (whole-diff integration review, 2026-08-13).
        */}
        <p className="text-sm text-ink-2 mt-6">
          Det här är inte ett fel du behöver felsöka — det räcker att slutföra
          raderingen. Har vi redan hunnit ta bort din profil städas kontot bort
          automatiskt inom sju dygn; annars är det den här knappen som avslutar
          raderingen.
        </p>

        {/*
          BIN-877 (#19 Kundsupport, BIN-813:s panel) — den enda vägen till en
          människa. Den är TILLAGD, inte inskriven i något av det ovanstående:
          rubriken, ingressen och stycket om sopningen är juridiskt godkänd text
          och står ordagrant kvar (biljettens acceptans + BIN-813 villkor 4).

          Skälet den behövs just här: en användare vars radering fastnat står på
          en skärm som har bytt ut hela appen, har ingen annan sida att gå till,
          och kan hamna i lägen knappen inte löser — kaskaden faller på en grupp
          som hunnit raderas av sin ägare, eller en session som aldrig blir
          färsk nog. Utan en adress är enda utvägen att ge upp med kontot kvar.
          Adressen är inget nytt löfte: integritetspolicyn §1 pekar redan ut
          hej@binge.nu för raderingsbegäran, och art. 12 lägger ansvaret att
          svara på oss.
        */}
        <p className="text-sm text-ink-2 mt-3">
          Kommer du inte vidare? Mejla{' '}
          <a href="mailto:hej@binge.nu" className="text-acc-deep">hej@binge.nu</a>
          {' '}så hjälper vi dig att slutföra raderingen.
        </p>

        {error && (
          <p role="alert" className="mt-4 rounded bg-danger-soft px-3 py-2 text-sm text-danger-ink">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={handleFinish}
            disabled={busy}
            className="btn btn-danger btn-sm disabled:opacity-50"
          >
            {busy ? 'Slutför…' : 'Slutför raderingen'}
          </button>
          <button onClick={() => void signOut()} className="btn btn-ghost btn-sm">
            Logga ut
          </button>
        </div>

        {/*
          BIN-911 — sjudygnslöftet ovan är sant på DEN HÄR enheten och bara här.
          Efter ADR 0022 (Malins accept 2026-08-15) gäller det inte för den som
          senare laddar en inloggad sida på en enhet UTAN markören: profilen
          återskapas, kontot lämnar sopningens urval permanent, och de sju dygnen
          inträffar aldrig. För den gruppen är meningen fel för gott, inte
          tillfälligt — och den låsta texten får inte skrivas om (juridiskt
          godkänd, BIN-877:s acceptans + BIN-813 villkor 4).

          Malins val 2026-08-16 var en HANDLING i stället för ett förbehåll om
          enheter: skärmen ska vara lugnande och kort, och en brasklapp gör den
          oroligare utan att hjälpa.

          #19 Kundsupports blinda kritik (2026-08-17) rättade vilken handling det
          skulle vara, och rättelsen är hela poängen med den här raden:

          "om du ångrar dig" vore fel verb. Det antyder en ångra-knapp som inte
          finns (se kommentaren om det medvetna frånvarot av avbryt ovan). Den som
          vill BEHÅLLA kontot har ingen självbetjäningsväg alls — RUNBOOK §5f är ett
          supportmedierat fall-till-fall-beslut som bara kan rädda det kaskaden
          inte hunnit ta. En rad som bjuder in till det skickar folk till ett svar
          som oftast gör dem besvikna.

          Den ärliga handlingen är den här: den här skärmen är den enda som ERBJUDER
          att slutföra en påbörjad radering,
          och knappen fungerar ÄVEN efter att en annan enhet återskapat profilen —
          `collectDeletionRefs` byggs om från Firestore vid varje försök och
          raderingar mot redan borta dokument är no-ops (RUNBOOK §5f). Det är en
          verklig, kodverifierad utväg.

          Precision, efter helhetsgranskningen 2026-08-17: den här kommentaren sa först
          "att slutföra fungerar BARA härifrån", och det tog i. Raderingen kan också
          slutföras genom att STARTA OM den från inställningssidan på den andra enheten —
          `DeleteAccountSection` anropar samma `deleteAccount()`, och ADR 0022:s accept
          vilar just på att "radera igen startar om kedjan". Det som är sant är att ingen
          annan yta erbjuder att slutföra en redan PÅBÖRJAD radering. Den användarsynliga
          raden påverkas inte: den säger bara att raderingen inte fortsätter av sig själv
          på den andra enheten, vilket stämmer.

          Vad raden INTE gör, sagt rakt ut så ingen tror mer om den: den når inte
          personen i det ögonblick skadan sker. Den som aldrig återvänder hit ser
          den aldrig. Den når dem som får ett kaskadfel och läser skärmen i samma
          sittning, före de rört någon annan enhet — en meningsfull del av
          populationen, inte hela.

          Placerad som hjälptext intill knappen, inte som en tredje paragraf
          (#19:s villkor): skärmen har redan två textblock efter den låsta, och en
          orolig läsare ska inte behöva ta sig igenom ett till.
        */}
        <p className="text-xs text-ink-3 mt-2">
          Raderingen slutförs härifrån. Loggar du in på en annan enhet fortsätter den inte
          där — kom tillbaka hit och tryck på knappen.
        </p>
      </div>
    </main>
  );
}
