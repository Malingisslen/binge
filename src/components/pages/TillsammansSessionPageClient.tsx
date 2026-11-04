'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Users, Share2, ChevronLeft, Check, X, Ban, LayoutGrid, Table2, Copy } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSession, getStoredParticipantId, storeParticipantId } from '@/hooks/useSession';
import { joinSession, recordSwipe, setSessionCandidates, undoVeto } from '@/lib/firebase/sessions';
import { generateSecureToken } from '@/lib/firebase/utils';
import { posterUrl } from '@/lib/tmdb/client';
import { SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';
import { scoreCandidates, pickMatches, nextCandidate, participantSwipeProgress, candidateKey } from '@/lib/together/matching';
import { nextMatchAnnouncement, INITIAL_MATCH_ANNOUNCEMENT_STATE } from '@/lib/together/matchAnnouncement';
import { useSessionTasteVectors } from '@/hooks/useSessionTasteVectors';
import { computeSessionProviders, generateCandidates } from '@/lib/together/candidates';
import { canRerun, rerunExcludeIds } from '@/lib/together/rerun';
import { VETO_UNDO_STRIP_MS, isSignedInOwnSeat, canUndoVetoOn, myVetoedCandidate } from '@/lib/together/vetoUndo';
import { isWatchableBy, whoCanWatch } from '@/lib/together/watchable';
import { genreLabel } from '@/lib/tmdb/genreLabels';
import { toneForId } from '@/lib/duotone';
import { PageHeader } from '@/components/layout/PageHeader';
import { usePageMeta } from '@/hooks/usePageMeta';
import { LoadingView } from '@/components/ui/LoadingView';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import type { SessionCandidate, SessionParticipant, SessionSwipe, TogetherSession, VoteKind } from '@/types';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import { MAX_SESSION_DISPLAY_NAME } from '@/lib/clampText';
import { Eyebrow, eyebrowClass } from '@/components/ui/Eyebrow';
import { buttonClass, Button } from '@/components/ui/Button';
import { thClass } from '@/components/ui/tableHead';
import { fieldClass } from '@/components/ui/Field';
import { cardClass } from '@/components/ui/Card';
import { tagClass } from '@/components/ui/Badge';
import { formatDecimal } from '@/lib/formatDecimal';
import { VetoConfirmDialog, VETO_TRIGGER_ATTR } from '@/components/together/VetoConfirmDialog';
import { ShareSessionButton } from '@/components/together/ShareSessionButton';

export default function TillsammansSessionPageClient({ id }: { id: string }) {
  const { session, participants, swipes, loading, notFound, expired } = useSession(id);
  const { uid, user } = useAuth();
  // X5: unik dokumenttitel per session när den laddats (rör inte indexability).
  usePageMeta({ title: session ? `Tillsammans hos ${session.hostName}` : 'Tillsammans' });

  const [participantId, setParticipantId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const stored = getStoredParticipantId(id);
    if (stored) setParticipantId(stored);
    else if (uid) setParticipantId(uid);
  }, [id, uid]);

  const myParticipant = useMemo(
    () => participants.find(p => p.id === participantId) ?? null,
    [participants, participantId],
  );

  if (loading) {
    return <LoadingView variant="detail" label="Laddar session…" />;
  }

  if (notFound || !session) {
    return (
      <>
        <header>
          <div className="crumb">Tillsammans · session hittades inte</div>
          <h1 className="page-h1">Den här länken funkar inte.</h1>
          <p className="stand">Sessionen kan ha gått ut, länken kan vara felstavad eller så är uppkopplingen långsam. Tillsammans-sessioner lever i 7 dagar.</p>
          <div className="actions">
            <Button type="button" variant="ghost" onClick={() => window.location.reload()}>Försök igen</Button>
            <Link href="/tillsammans/ny" className={buttonClass()}>Skapa en ny session</Link>
          </div>
        </header>
      </>
    );
  }

  if (expired) {
    return (
      <>
        <header>
          <div className="crumb">Tillsammans · utgången</div>
          <h1 className="page-h1">Den här sessionen har gått ut.</h1>
          <p className="stand">Tillsammans-sessioner är aktiva i 7 dagar. Starta en ny för att fortsätta röstning.</p>
          <div className="actions">
            <Link href="/tillsammans/ny" className={buttonClass()}>Skapa en ny session</Link>
          </div>
        </header>
      </>
    );
  }

  if (!myParticipant) {
    return (
      <JoinSessionForm
        sessionId={id}
        existingUid={uid}
        existingName={user?.displayName ?? ''}
        existingProviders={user?.myProviders ?? []}
        onJoined={(pid) => setParticipantId(pid)}
      />
    );
  }

  return (
    <SessionMain
      sessionId={id}
      session={session}
      participants={participants}
      swipes={swipes}
      me={myParticipant}
    />
  );
}

function JoinSessionForm({
  sessionId,
  existingUid,
  existingName,
  existingProviders,
  onJoined,
}: {
  sessionId: string;
  existingUid: string | null;
  existingName: string;
  existingProviders: number[];
  onJoined: (pid: string) => void;
}) {
  const [name, setName] = useState(existingName);
  const [providers, setProviders] = useState<number[]>(existingProviders);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flatrate = SWEDISH_PROVIDERS.filter(p => p.type === 'flatrate');

  const toggleProvider = (id: number) => {
    setProviders(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const n = name.trim();
    if (!n) { setError('Ange ett namn'); return; }
    if (providers.length === 0) { setError('Välj minst en streamingtjänst'); return; }

    setSubmitting(true);
    try {
      const pid = existingUid ?? generateSecureToken();
      await joinSession({
        sessionId,
        participantId: pid,
        uid: existingUid,
        displayName: n,
        providers,
      });
      storeParticipantId(sessionId, pid);
      onJoined(pid);
    } catch (err) {
      console.error(err);
      setError('Kunde inte gå med. Försök igen.');
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader crumb="Tillsammans" title="Gå med i sessionen" icon={<Users size={20} className="text-acc-deep" />} />
      <p className="text-xs text-ink-3 mb-4 mt-3 leading-relaxed">
        Någon har bjudit in dig att välja film tillsammans. Skriv ditt namn och kryssa för vilka streamingtjänster du har — bara titlar ni delar visas.
      </p>

      <form onSubmit={submit} className={cardClass()}>
        <div className="px-3 py-2.5 border-b border-rule-2">
          <label htmlFor="tillsammans-namn" className="block text-xs text-ink-3 mb-1">Ditt namn</label>
          <input
            id="tillsammans-namn"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="T.ex. Erik"
            maxLength={MAX_SESSION_DISPLAY_NAME}
            className={fieldClass({ className: 'w-full max-w-[260px]' })}
          />
        </div>
        <div className="px-3 py-2.5">
          <Eyebrow className="mb-1.5">Dina streamingtjänster</Eyebrow>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
            {flatrate.map(p => {
              const selected = providers.includes(p.id);
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-1.5 px-2 py-1 border rounded-sm cursor-pointer text-xs ${
                    selected ? 'border-acc-deep bg-acc-deep/[0.08]' : 'border-rule bg-surface'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleProvider(p.id)}
                    className="accent-acc-deep w-[12px] h-[12px]"
                  />
                  <span className="w-[6px] h-[6px] rounded-full" style={{ background: p.color }} />
                  {p.name}
                </label>
              );
            })}
          </div>
        </div>
        {error && (
          <div className="px-3 py-2 text-xs text-danger-ink bg-danger-soft border-t border-danger">{error}</div>
        )}
        <div className="px-3 py-2 border-t border-rule-2">
          <Button
            type="submit"
            disabled={submitting}
            variant="acc" size="sm" className="disabled:opacity-50"
          >
            {submitting ? 'Går med…' : 'Gå med'}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function SessionMain({
  sessionId,
  session,
  participants,
  swipes,
  me,
}: {
  sessionId: string;
  session: ReturnType<typeof useSession>['session'] & object;
  participants: SessionParticipant[];
  swipes: ReturnType<typeof useSession>['swipes'];
  me: SessionParticipant;
}) {
  const [view, setView] = useState<'card' | 'table'>('card');
  const [shareCopied, setShareCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const [vetoConfirm, setVetoConfirm] = useState<SessionCandidate | null>(null);
  const [saving, setSaving] = useState(false);
  // Senaste röstade titeln (inte veto). Inloggade kan lägga om rösten; reglerna
  // släpper inte anonyma gäster förbi en redan lagd röst.
  const [lastVoted, setLastVoted] = useState<SessionCandidate | null>(null);
  const [reVote, setReVote] = useState<SessionCandidate | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  // Ångra veto (BIN-1490): remsan efter ett nyss lagt veto, och utfallet av ett ångrande.
  const [vetoStrip, setVetoStrip] = useState<SessionCandidate | null>(null);
  const vetoStripTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (vetoStripTimer.current) clearTimeout(vetoStripTimer.current); }, []);
  const [vetoUndoNotice, setVetoUndoNotice] = useState<'done' | 'failed' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [matchAnnouncement, setMatchAnnouncement] = useState('');
  const matchState = useRef(INITIAL_MATCH_ANNOUNCEMENT_STATE);

  // Re-evaluera "live"-statusen var 3:e sekund så banner blinkar av/på i takt
  // med att deltagare går idle. onSnapshot räcker inte — lastActiveAt ändras
  // bara på nya svepningar.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(t);
  }, []);

  const liveParticipants = useMemo(
    () => participants.filter(p => now - p.lastActiveAt.getTime() < 10_000),
    [participants, now],
  );
  const isFullyLive = participants.length >= 2 && liveParticipants.length === participants.length;

  const effectiveProviders = useMemo(
    () => computeSessionProviders(participants, session.config.providerMode),
    [participants, session.config.providerMode],
  );

  const filteredCandidates = useMemo(() => {
    const noSharedService = session.config.providerMode === 'intersect' && effectiveProviders.length === 0;
    // Titlarna är taggade med vilka tjänster de ligger på, så varje deltagare
    // kan prövas för sig. Otaggade titlar (äldre sessioner) följer det gamla
    // snittet av tjänster.
    return session.candidates.filter(c =>
      c.providers.length === 0
        ? !noSharedService
        : isWatchableBy(c, participants, session.config.providerMode)
    );
  }, [session.candidates, participants, effectiveProviders, session.config.providerMode]);

  const tasteByPid = useSessionTasteVectors(participants);

  const scored = useMemo(
    () => scoreCandidates({
      candidates: filteredCandidates,
      participants,
      swipes,
      tasteByPid,
      aggregation: session.config.aggregation,
    }),
    [filteredCandidates, participants, swipes, tasteByPid, session.config.aggregation],
  );

  const matches = useMemo(
    () => pickMatches(scored, participants.length),
    [scored, participants.length],
  );

  // Swipes load after the session doc, so matches that exist when the page opens appear a moment
  // later; the baseline only counts as set once swipes have arrived, so those are not announced.
  useEffect(() => {
    const result = nextMatchAnnouncement(matchState.current, matches, swipes.length);
    matchState.current = result.state;
    if (result.announcement) setMatchAnnouncement(result.announcement);
  }, [matches, swipes.length]);

  const next = useMemo(
    () => nextCandidate({ candidates: filteredCandidates, swipes, participantId: me.id }),
    [filteredCandidates, swipes, me.id],
  );

  const progress = useMemo(
    () => participantSwipeProgress(swipes, filteredCandidates, me.id),
    [swipes, filteredCandidates, me.id],
  );

  const ownSeat = isSignedInOwnSeat(me);
  const canUndo = !!lastVoted && ownSeat;
  const vetoedByMe = useMemo(
    () => (ownSeat ? myVetoedCandidate(scored, me.id) : null),
    [ownSeat, scored, me.id],
  );
  const cardCandidate = reVote ?? next;

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/tillsammans/${sessionId}/` : '';

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setShareCopied(false), 2000);
    } catch {/* ignore */}
  };

  const onVote = async (cand: SessionCandidate, vote: VoteKind) => {
    if (saving) return;
    if (vote === 'veto' && me.vetoRemaining <= 0) return;
    // Veto kräver bekräftelse för just den här titeln. En bekräftelse som
    // gällde en annan titel (t.ex. armerad i tabellen) räknas inte.
    if (vote === 'veto' && !(vetoConfirm && candidateKey(vetoConfirm) === candidateKey(cand))) {
      setVetoConfirm(cand);
      return;
    }
    setVetoConfirm(null);
    setVoteError(null);
    setVetoUndoNotice(null);
    setSaving(true);
    try {
      await recordSwipe({ sessionId, tmdbId: cand.tmdbId, mediaType: cand.mediaType, participantId: me.id, vote });
      setReVote(null);
      setLastVoted(vote === 'veto' ? null : cand);
      if (vote === 'veto' && ownSeat) showVetoStrip(cand);
    } catch (e) {
      console.error(e);
      setVoteError('Din röst kunde inte sparas. Kolla uppkopplingen och försök igen.');
    } finally {
      setSaving(false);
    }
  };

  const showVetoStrip = (cand: SessionCandidate | null) => {
    if (vetoStripTimer.current) clearTimeout(vetoStripTimer.current);
    vetoStripTimer.current = null;
    setVetoStrip(cand);
    if (cand) vetoStripTimer.current = setTimeout(() => setVetoStrip(null), VETO_UNDO_STRIP_MS);
  };

  const onUndoVeto = async (cand: SessionCandidate) => {
    if (saving || !ownSeat) return;
    setVoteError(null);
    setVetoUndoNotice(null);
    setSaving(true);
    try {
      await undoVeto({ sessionId, participantId: me.id, tmdbId: cand.tmdbId, mediaType: cand.mediaType });
      showVetoStrip(null);
      setVetoUndoNotice('done');
    } catch (e) {
      console.error(e);
      setVetoUndoNotice('failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header>
        <div className="crumb">
          Grupper · Tillsammans · session #{sessionId.slice(0, 6)}
        </div>
        <h1 className="page-h1">Vad ska vi se ikväll?</h1>
        <p className="stand">
          {participants.length === 1
            ? 'Du är ensam i rummet. Dela länken nedan så kan andra gå med.'
            : `${participants.length} i rummet. ${session.config.providerMode === 'intersect' ? 'Alla' : 'Någon'} har — gemensamma tjänster: ${effectiveProviders.length}.`}
        </p>
        <div className="actions">
          <Link href="/tillsammans/ny" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
            <ChevronLeft size={12} /> Ny session
          </Link>
          {isFullyLive && (
            <span className="chip acc">
              <span className="live-dot" aria-hidden="true" /> alla aktiva nu
            </span>
          )}
          <span className={eyebrowClass({ size: 'xs', className: 'ml-auto' })}>
            veto kvar: {me.vetoRemaining}
          </span>
        </div>
      </header>

      <div className={cardClass('mb-2')}>
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-rule-2 text-xs">
          <Share2 size={12} className="text-ink-3" />
          <code className="text-xxs flex-1 truncate text-ink-2">{shareUrl || 'Hämtar länk…'}</code>
          <Button
            type="button"
            onClick={copyShare}
            variant="ghost" size="xs" className="flex items-center gap-1 min-h-11"
          >
            <Copy size={10} />
            {shareCopied ? 'Kopierad!' : 'Kopiera'}
          </Button>
          <ShareSessionButton url={shareUrl} />
        </div>
        <div className="px-3 py-1.5 flex items-center gap-2 flex-wrap text-xs">
          <Eyebrow as="span">Deltagare:</Eyebrow>
          {participants.map(p => {
            const prog = participantSwipeProgress(swipes, filteredCandidates, p.id);
            const isMe = p.id === me.id;
            const isLive = liveParticipants.some(lp => lp.id === p.id);
            return (
              <span
                key={p.id}
                className={isMe ? tagClass('acc', 'font-semibold') : tagClass('ink')}
                title={`${prog.done}/${prog.total} svepningar${isLive ? ' · aktiv nu' : ''}`}
              >
                {isLive && (
                  <>
                    <span className="w-[5px] h-[5px] rounded-full bg-season-done" aria-hidden="true" />
                    <span className="sr-only">aktiv nu, </span>
                  </>
                )}
                {p.displayName}{p.isHost ? ' ★' : ''} <span className="text-ink-3">({prog.done}/{prog.total})</span>
              </span>
            );
          })}
        </div>
        {tasteByPid.size > 0 && (
          <div className="px-3 py-1.5 border-t border-rule-2 text-xxs text-ink-3">
            Smakpoängen bygger bara på det vännerna delar offentligt, så den kan vara ofullständig.
          </div>
        )}
        <div className="px-3 py-1.5 border-t border-rule-2 flex items-center justify-between text-xxs text-ink-3">
          <span>
            Läge: {session.config.providerMode === 'intersect' ? 'Alla har' : 'Någon har'} ·
            {' '}{session.config.mediaType === 'movie' ? 'Filmer' : session.config.mediaType === 'tv' ? 'Serier' : 'Blandat'}
            {' · '}Gemensamma tjänster: {effectiveProviders.length}
          </span>
          <div className="flex gap-0.5">
            <button
              type="button"
              aria-pressed={view === 'card'}
              onClick={() => setView('card')}
              className={`px-2 py-0.5 rounded-sm border text-xxs flex items-center gap-1 ${view === 'card' ? 'bg-acc-deep/[0.1] border-acc-deep text-acc-deep' : 'bg-surface border-rule text-ink-2'}`}
            >
              <LayoutGrid size={10} /> Kort
            </button>
            <button
              type="button"
              aria-pressed={view === 'table'}
              onClick={() => setView('table')}
              className={`px-2 py-0.5 rounded-sm border text-xxs flex items-center gap-1 ${view === 'table' ? 'bg-acc-deep/[0.1] border-acc-deep text-acc-deep' : 'bg-surface border-rule text-ink-2'}`}
            >
              <Table2 size={10} /> Tabell
            </button>
          </div>
        </div>
      </div>

      <div className="mb-2">
        <JustWatchCredit />
      </div>

      {matches.length > 0 && (
        <MatchList matches={matches} session={session} participants={participants} />
      )}

      <div className="sr-only" aria-live="polite" aria-atomic="true">{matchAnnouncement}</div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{voteError ?? ''}</div>

      {voteError && (
        <div className="mb-2 px-3 py-2 text-xs text-danger-ink bg-danger-soft border border-danger/30 rounded-sm">{voteError}</div>
      )}

      {vetoStrip && (
        <div role="status" className={cardClass('mb-2 px-3 py-1.5 flex items-center gap-2 text-xs')}>
          <span className="flex-1">Veto lagt.</span>
          <Button type="button" variant="ghost" size="xs" className="min-h-11" disabled={saving} onClick={() => onUndoVeto(vetoStrip)}>
            Ångra veto
          </Button>
        </div>
      )}
      {/* Alltid monterad, så att skärmläsare hör kvittot när texten dyker upp. */}
      <div role="status">
        {vetoUndoNotice === 'done' && (
          <div className={cardClass('mb-2 px-3 py-1.5 text-xs text-ink-2')}>
            Veto ångrat. Du har ditt veto kvar.
          </div>
        )}
      </div>
      {vetoUndoNotice === 'failed' && (
        <div role="alert" className="mb-2 px-3 py-2 text-xs text-danger-ink bg-danger-soft border border-danger/30 rounded-sm">
          Vetot kunde inte ångras. Kolla uppkopplingen och försök igen.
        </div>
      )}

      {filteredCandidates.length === 0 ? (
        <div className={cardClass('px-3 py-4 text-xs text-ink-3')}>
          Inga titlar matchar era gemensamma tjänster just nu.
          {session.config.providerMode === 'intersect' && effectiveProviders.length === 0 && (
            <div className="mt-2">Prova att byta till &quot;Någon har&quot;-läge i en ny session.</div>
          )}
        </div>
      ) : view === 'card' ? (
        cardCandidate ? (
          <>
            <SwipeCard
              cand={cardCandidate}
              me={me}
              participants={participants}
              onVote={onVote}
              progress={progress}
              myVote={scored.find(r => candidateKey(r.candidate) === candidateKey(cardCandidate))?.votes[me.id]}
              vetoConfirm={!!vetoConfirm && candidateKey(vetoConfirm) === candidateKey(cardCandidate)}
              onCancelVeto={() => setVetoConfirm(null)}
              disabled={saving}
            />
            {canUndo && !reVote && lastVoted && (
              <div className="mt-1.5 text-center">
                <Button type="button" variant="ghost" size="xs" disabled={saving} onClick={() => setReVote(lastVoted)}>
                  Ångra senaste röst: {lastVoted.title}
                </Button>
              </div>
            )}
            {reVote && (
              <div className="mt-1.5 text-center text-xxs text-ink-3">
                Du lägger om rösten på {reVote.title}.{' '}
                <button type="button" className="underline" onClick={() => setReVote(null)}>Avbryt</button>
              </div>
            )}
          </>
        ) : (
          <FinalStep
            matches={matches}
            session={session}
            participants={participants}
            me={me}
            providers={effectiveProviders}
            swipes={swipes}
            canUndo={canUndo}
            onUndo={() => lastVoted && setReVote(lastVoted)}
          />
        )
      ) : null}
      {view === 'card' && filteredCandidates.length > 0 && vetoedByMe && !vetoStrip && (
        <div className="mt-1.5 text-center text-xxs text-ink-3">
          Ditt veto: {vetoedByMe.title}.{' '}
          <Button type="button" variant="ghost" size="xs" className="min-h-11" disabled={saving} onClick={() => onUndoVeto(vetoedByMe)}>
            Ångra veto
          </Button>
        </div>
      )}
      {view === 'table' && filteredCandidates.length > 0 && (
        <CandidateTable
          scored={scored}
          me={me}
          onVote={onVote}
          armedVetoKey={vetoConfirm ? candidateKey(vetoConfirm) : null}
          disabled={saving}
          onUndoVeto={onUndoVeto}
        />
      )}
    </>
  );
}

export function SwipeCard({
  cand, me, participants, onVote, progress, myVote, vetoConfirm, onCancelVeto, disabled,
}: {
  cand: SessionCandidate;
  me: SessionParticipant;
  participants: SessionParticipant[];
  onVote: (c: SessionCandidate, v: VoteKind) => void;
  progress: { done: number; total: number };
  myVote?: VoteKind;
  vetoConfirm: boolean;
  onCancelVeto: () => void;
  disabled: boolean;
}) {
  const poster = posterUrl(cand.posterPath, 'w342');
  return (
    <div className={cardClass('overflow-hidden')}>
      <div className="flex gap-3 p-3">
        {poster ? (
          <div className={`poster duo-${toneForId(cand.tmdbId)} w-[140px] h-[210px] shrink-0`}>
            <img src={poster} alt="" loading="eager" decoding="async" width={140} height={210} />
          </div>
        ) : (
          <div className="w-[140px] h-[210px] bg-rule-2 rounded-sm shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold leading-tight">{cand.title}</div>
          <div className="text-xxs text-ink-3 mt-0.5">
            {cand.year ?? '—'} · {cand.mediaType === 'movie' ? 'Film' : 'Serie'}
            {cand.voteAverage > 0 && <> · <span className="text-acc-deep">★ {formatDecimal(cand.voteAverage)}</span></>}
          </div>
          <TitleFacts cand={cand} participants={participants} />
          <p className="text-xs text-ink-2 mt-2 leading-relaxed line-clamp-6">
            {cand.overview || 'Ingen beskrivning på svenska.'}
          </p>
        </div>
      </div>
      <div className="px-3 py-1.5 border-t border-rule-2 text-xxs text-ink-3 flex items-center justify-between">
        <span>Svept: <b className="text-ink">{progress.done}</b> / {progress.total}</span>
        <span>Veto kvar: <b className={me.vetoRemaining > 0 ? 'text-ink' : 'text-ink-3'}>{me.vetoRemaining}</b></span>
      </div>
      {vetoConfirm ? (
        <VetoConfirmDialog onConfirm={() => onVote(cand, 'veto')} onCancel={onCancelVeto} disabled={disabled} />
      ) : (
        <div className="px-3 py-2 border-t border-rule-2 flex gap-2">
          <Button
            onClick={() => onVote(cand, 'no')}
            disabled={disabled}
            aria-pressed={myVote === 'no'}
            variant="ghost" size="sm" className="flex-1 flex items-center justify-center gap-1 min-h-11"
          >
            <X size={14} aria-hidden="true" /> Nej
          </Button>
          <Button
            onClick={() => onVote(cand, 'yes')}
            disabled={disabled}
            aria-pressed={myVote === 'yes'}
            variant="acc" size="sm" className="flex-1 flex items-center justify-center gap-1 min-h-11"
          >
            <Check size={14} aria-hidden="true" /> Ja
          </Button>
          {me.vetoRemaining > 0 && (
            <Button
              onClick={() => onVote(cand, 'veto')}
              disabled={disabled}
              aria-pressed={myVote === 'veto'}
              {...{ [VETO_TRIGGER_ATTR]: '' }}
              variant="danger-ghost" size="sm" className="justify-center min-h-11"
              title="Dödar denna titel definitivt"
            >
              <Ban size={14} aria-hidden="true" /> Veto
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function CandidateTable({
  scored, me, onVote, armedVetoKey, disabled, onUndoVeto,
}: {
  scored: ReturnType<typeof scoreCandidates>;
  me: SessionParticipant;
  onVote: (c: SessionCandidate, v: VoteKind) => void;
  armedVetoKey: string | null;
  disabled: boolean;
  onUndoVeto?: (c: SessionCandidate) => void;
}) {
  return (
    <div className={cardClass('overflow-x-auto')}>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className={thClass('text-left px-2')}>Titel</th>
            <th className={thClass('text-left px-2')}>År</th>
            <th className={thClass('text-left px-2')}>Typ</th>
            <th className={thClass('text-left px-2')}>★</th>
            <th className={thClass('text-left px-2')}>Gruppen</th>
            <th className={thClass('text-right px-2')}>Din röst</th>
          </tr>
        </thead>
        <tbody>
          {scored.map(r => {
            const myVote = r.votes[me.id];
            const summary = `${r.yesCount} ja · ${r.noCount} nej${r.vetoed ? ' · VETO' : ''}`;
            return (
              <tr key={candidateKey(r.candidate)} className={`border-b border-border-table last:border-b-0 ${r.vetoed ? 'opacity-40' : ''}`}>
                <td className="px-2 py-1 font-semibold truncate max-w-[260px]">{r.candidate.title}</td>
                <td className="px-2 py-1 text-ink-3">{r.candidate.year ?? '—'}</td>
                <td className="px-2 py-1 text-ink-3">{r.candidate.mediaType === 'movie' ? 'Film' : 'Serie'}</td>
                <td className="px-2 py-1 text-acc-deep">{r.candidate.voteAverage > 0 ? formatDecimal(r.candidate.voteAverage) : '—'}</td>
                <td className="px-2 py-1 text-ink-3 whitespace-nowrap">{summary}</td>
                <td className="px-2 py-1 text-right">
                  <div className="inline-flex gap-0.5">
                    <button
                      onClick={() => onVote(r.candidate, 'no')}
                      aria-pressed={myVote === 'no'}
                      disabled={disabled}
                      className={`px-1.5 py-1.5 min-h-11 rounded-sm border text-xxs cursor-pointer disabled:opacity-50 ${myVote === 'no' ? 'border-acc-deep bg-acc-deep/[0.1] text-acc-deep' : 'border-rule bg-surface text-ink-2'}`}
                    >
                      Nej
                    </button>
                    <button
                      onClick={() => onVote(r.candidate, 'yes')}
                      aria-pressed={myVote === 'yes'}
                      disabled={disabled}
                      className={`px-1.5 py-1.5 min-h-11 rounded-sm border text-xxs cursor-pointer disabled:opacity-50 ${myVote === 'yes' ? 'border-acc-deep bg-acc-deep text-on-acc' : 'border-rule bg-surface text-ink-2'}`}
                    >
                      Ja
                    </button>
                    {(me.vetoRemaining > 0 || myVote === 'veto') && (
                      <button
                        onClick={() => onVote(r.candidate, 'veto')}
                        aria-pressed={myVote === 'veto'}
                        disabled={disabled}
                        className={`px-1.5 py-1.5 min-h-11 rounded-sm border text-xxs cursor-pointer disabled:opacity-50 ${myVote === 'veto' ? 'border-danger bg-danger-soft text-danger-ink' : 'border-rule bg-surface text-ink-3'}`}
                      >
                        {armedVetoKey === candidateKey(r.candidate) ? 'Säker? Veto' : 'Veto'}
                      </button>
                    )}
                    {onUndoVeto && canUndoVetoOn(me, myVote) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => onUndoVeto(r.candidate)}
                        disabled={disabled}
                        aria-label={`Ångra veto på ${r.candidate.title}`}
                        className="min-h-11"
                      >
                        Ångra veto
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function providerNames(ids: number[]): string[] {
  return ids
    .map(id => SWEDISH_PROVIDERS.find(p => p.id === id)?.name)
    .filter((n): n is string => !!n);
}

function TitleFacts({ cand, participants }: { cand: SessionCandidate; participants: SessionParticipant[] }) {
  const genres = cand.genreIds.slice(0, 3).map(genreLabel);
  const where = providerNames(cand.providers.filter(id => participants.some(p => p.providers.includes(id))));
  const watchers = whoCanWatch(cand, participants);
  const everyone = watchers.length === participants.length;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {genres.length > 0 && <div className="text-xxs text-ink-3">{genres.join(' · ')}</div>}
      {where.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {where.map(n => <span key={n} className={tagClass('acc')}>{n}</span>)}
        </div>
      )}
      {where.length > 0 && !everyone && watchers.length > 0 && (
        <div className="text-xxs text-ink-3">Kan ses av: {watchers.join(', ')}</div>
      )}
    </div>
  );
}

// Värdens "Kör om": nya titlar i samma session. Rösterna på de gamla titlarna
// ligger kvar i swipes men räknas inte, eftersom matchningen bara tittar på
// sessionens nuvarande kandidater.
function RerunControl({
  session, me, providers, swipes,
}: {
  session: TogetherSession;
  me: SessionParticipant;
  providers: number[];
  swipes: SessionSwipe[];
}) {
  const { uid } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canRerun(session, uid)) return null;

  const rerun = async () => {
    const usedProviders = providers.length > 0 ? providers : me.providers;
    if (usedProviders.length === 0) {
      setError('Ingen streamingtjänst att söka på. Lägg till en tjänst i din profil.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fresh = await generateCandidates({
        config: session.config,
        providers: usedProviders,
        excludeTmdbIds: rerunExcludeIds(
          session.candidates,
          new Set(swipes.map(sw => mediaTypeDocId(sw.mediaType, sw.tmdbId))),
        ),
      });
      if (fresh.length === 0) {
        setError('Hittade inga nya titlar just nu. Era nuvarande ligger kvar.');
        return;
      }
      await setSessionCandidates(session.id, fresh);
      setConfirming(false);
    } catch (e) {
      console.error(e);
      setError('Det gick inte att köra om. Försök igen.');
    } finally {
      setSaving(false);
    }
  };

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>Kör om</Button>
    );
  }
  return (
    <div className="basis-full text-xxs text-ink-2" role="group" aria-label="Bekräfta omkörning">
      <div>Kör om med nya titlar? Era röster på de gamla titlarna ligger kvar men räknas inte.</div>
      <div className="mt-1 flex gap-2 flex-wrap">
        <Button type="button" variant="acc" size="xs" disabled={saving} onClick={rerun}>
          {saving ? 'Hämtar nya titlar…' : 'Ja, kör om'}
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={saving} onClick={() => { setConfirming(false); setError(null); }}>
          Avbryt
        </Button>
      </div>
      {error && <div role="alert" className="mt-1 text-danger-ink">{error}</div>}
    </div>
  );
}

function FinalStep({
  matches, session, participants, me, providers, swipes, canUndo, onUndo,
}: {
  matches: ReturnType<typeof pickMatches>;
  session: TogetherSession;
  participants: SessionParticipant[];
  me: SessionParticipant;
  providers: number[];
  swipes: SessionSwipe[];
  canUndo: boolean;
  onUndo: () => void;
}) {
  const [randomKey, setRandomKey] = useState<string | null>(null);
  if (matches.length === 0) {
    return (
      <div className={cardClass('px-3 py-4 text-center')}>
        <div className="text-sm font-semibold mb-1">Du har röstat på alla.</div>
        <div className="text-xxs text-ink-3">Än så länge finns ingen titel ni är överens om. Vänta på övriga, så sammanställs det automatiskt.</div>
        <div className="mt-2 flex justify-center"><RerunControl session={session} me={me} providers={providers} swipes={swipes} /></div>
      </div>
    );
  }
  const waiting = participants.length > 1 && matches.some(m => !m.allVoted);
  const chosen = matches.find(m => candidateKey(m.candidate) === randomKey) ?? matches[0];
  const isRandom = !!randomKey && candidateKey(chosen.candidate) === randomKey;
  const reserves = matches.filter(m => m !== chosen).slice(0, 2);
  const href = `/${chosen.candidate.mediaType === 'movie' ? 'movie' : 'tv'}/${chosen.candidate.tmdbId}/`;
  const names = (m: (typeof matches)[number]) =>
    providerNames(m.candidate.providers.filter(id => participants.some(p => p.providers.includes(id)))).join(', ');
  return (
    <div className={cardClass('overflow-hidden')}>
      <div className={eyebrowClass({ tone: 'acc', className: 'px-3 py-1.5 border-b border-acc-deep/30 bg-acc-deep/[0.06]' })}>
        {waiting ? 'Preliminärt val · väntar på fler röster' : isRandom ? 'Slumpat bland matcherna' : 'Ikväll ser ni'}
      </div>
      <div className="px-3 py-3 flex flex-col gap-1">
        <div className="text-lg font-bold leading-tight">{chosen.candidate.title}</div>
        <div className="text-xxs text-ink-3">
          {chosen.yesCount} av {participants.length} sa ja{names(chosen) && <> · {names(chosen)}</>}
        </div>
        <div className="mt-2 flex gap-2 flex-wrap">
          <Link href={href} className={buttonClass({ variant: 'acc', size: 'sm' })}>Öppna titeln</Link>
          {matches.length > 1 && (
            <Button
              type="button" variant="ghost" size="sm"
              onClick={() => setRandomKey(candidateKey(matches[Math.floor(Math.random() * matches.length)].candidate))}
            >
              Slumpa bland matcherna
            </Button>
          )}
          {canUndo && <Button type="button" variant="ghost" size="sm" onClick={onUndo}>Ångra senaste röst</Button>}
          <RerunControl session={session} me={me} providers={providers} swipes={swipes} />
        </div>
        {isRandom && <div className="text-xxs text-ink-3">Slumpen syns bara på din skärm. Säg till de andra.</div>}
      </div>
      {reserves.length > 0 && (
        <div className="border-t border-rule-2 px-3 py-2">
          <div className="text-xxs text-ink-3 mb-1">Reservplatser</div>
          {reserves.map(m => (
            <div key={candidateKey(m.candidate)} className="text-xs flex justify-between gap-2">
              <span className="font-semibold truncate">{m.candidate.title}</span>
              <span className="text-ink-3 shrink-0">{m.yesCount} ja</span>
            </div>
          ))}
        </div>
      )}
      {session.groupId && <div className="px-3 pb-2 text-xxs text-ink-3">Tryck &quot;Den här tar vi&quot; i matchlistan ovan för att spara valet i gruppens historik.</div>}
    </div>
  );
}

function MatchList({
  matches,
  session,
  participants,
}: {
  matches: ReturnType<typeof pickMatches>;
  session: TogetherSession;
  participants: SessionParticipant[];
}) {
  const { uid } = useAuth();
  const isGroupSession = !!session.groupId;
  // Nycklade på candidateKey, inte tmdbId: film 42 och serie 42 kan båda ligga
  // i matchlistan och delade annars spinner/"Vald"-tillstånd. (BIN-569)
  const [pickingKey, setPickingKey] = useState<string | null>(null);
  const [pickedKey, setPickedKey] = useState<string | null>(null);

  // Logga till gruppens sessionHistory så filmkvällen syns på grupp-sidan
  // som "Senaste filmkvällar". Bara meningsfullt för grupp-bundna sessioner.
  const recordPick = async (m: ReturnType<typeof pickMatches>[number]) => {
    if (!session.groupId || !uid) return;
    setPickingKey(candidateKey(m.candidate));
    try {
      const { recordGroupSessionPick } = await import('@/lib/firebase/groups');
      await recordGroupSessionPick({
        groupId: session.groupId,
        sessionId: session.id,
        pickedByUid: uid,
        pickedTmdbId: m.candidate.tmdbId,
        mediaType: m.candidate.mediaType,
        mediaTitle: m.candidate.title,
        posterPath: m.candidate.posterPath,
        participantUids: participants.map(p => p.uid).filter((u): u is string => !!u),
      });
      setPickedKey(candidateKey(m.candidate));
    } catch (err) {
      console.warn('[group-session-pick]', err);
    } finally {
      setPickingKey(null);
    }
  };

  return (
    <div className="bg-surface border border-acc-deep rounded-sm mb-2">
      <div className={eyebrowClass({ tone: 'acc', className: 'px-3 py-1.5 border-b border-acc-deep/30 bg-acc-deep/[0.06]' })}>
        Matcher ({matches.length})
      </div>
      <div className="divide-y divide-rule-2">
        {matches.map(m => {
          const href = `/${m.candidate.mediaType === 'movie' ? 'movie' : 'tv'}/${m.candidate.tmdbId}/`;
          const poster = posterUrl(m.candidate.posterPath, 'w92');
          const key = candidateKey(m.candidate);
          const isPicked = pickedKey === key;
          return (
            <div key={key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-2">
              <Link
                href={href}
                className="flex items-center gap-2 flex-1 min-w-0 no-underline text-ink"
              >
                {poster ? (
                  <div className={`poster duo-${toneForId(m.candidate.tmdbId)} w-[28px] h-[42px]`}>
                    <img src={poster} alt="" loading="lazy" decoding="async" width={28} height={42} />
                  </div>
                ) : (
                  <div className="w-[28px] h-[42px] bg-rule-2 rounded-sm" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{m.candidate.title}</div>
                  <div className="text-xxs text-ink-3">
                    {m.candidate.year ?? '—'} · {m.candidate.mediaType === 'movie' ? 'Film' : 'Serie'}
                    {m.candidate.voteAverage > 0 && <> · <span className="text-acc-deep">★ {formatDecimal(m.candidate.voteAverage)}</span></>}
                  </div>
                </div>
              </Link>
              <div className="text-xxs text-ink-3 text-right shrink-0">
                {m.yesCount} ja / {m.noCount} nej
                {!m.allVoted && (
                  <div className="text-acc-deep">
                    Preliminär · väntar på {m.missing.map(id => participants.find(p => p.id === id)?.displayName ?? 'någon').join(', ')}
                  </div>
                )}
              </div>
              {isGroupSession && (
                isPicked ? (
                  <span className="text-xxs text-acc-deep font-semibold inline-flex items-center gap-1"><Check size={11} /> Vald</span>
                ) : (
                  <Button
                    onClick={() => recordPick(m)}
                    disabled={pickingKey === key}
                    variant="acc" size="xs" className="disabled:opacity-50"
                    title="Logga till gruppens filmkvällshistorik"
                  >
                    {pickingKey === key ? 'Sparar…' : 'Den här tar vi'}
                  </Button>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

