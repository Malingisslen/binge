'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Users, Share2, ChevronLeft, Check, X, Ban, LayoutGrid, Table2, Copy, Radio } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSession, getStoredParticipantId, storeParticipantId } from '@/hooks/useSession';
import { joinSession, recordSwipe } from '@/lib/firebase/sessions';
import { posterUrl } from '@/lib/tmdb/client';
import { SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';
import { scoreCandidates, pickMatches, nextCandidate, participantSwipeProgress } from '@/lib/together/matching';
import { useSessionTasteVectors } from '@/hooks/useSessionTasteVectors';
import { computeSessionProviders } from '@/lib/together/candidates';
import { toneForId } from '@/lib/duotone';
import type { SessionCandidate, SessionParticipant, TogetherSession, VoteKind } from '@/types';

export default function TillsammansSessionPageClient({ id }: { id: string }) {
  const { session, participants, swipes, loading, notFound, expired } = useSession(id);
  const { uid, user } = useAuth();

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
    return <div className="text-sm text-ink-3 py-4">Laddar session…</div>;
  }

  if (notFound || !session) {
    return (
      <>
        <header>
          <div className="crumb">Tillsammans · session hittades inte</div>
          <h1 className="page-h1">Den här länken funkar inte.</h1>
          <p className="stand">Sessionen kan ha gått ut eller vara felstavad. Tillsammans-sessioner lever i 7 dagar.</p>
          <div className="actions">
            <Link href="/tillsammans/ny" className="btn">Skapa en ny session</Link>
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
            <Link href="/tillsammans/ny" className="btn">Skapa en ny session</Link>
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
      const pid = existingUid ?? randomId();
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
    <div className="max-w-[560px]">
      <div className="flex items-center gap-2 mb-3">
        <Users size={18} className="text-accent" />
        <h1 className="text-[18px] font-bold">Gå med i sessionen</h1>
      </div>
      <p className="text-xs text-text-muted mb-4 leading-relaxed">
        Någon har bjudit in dig att välja film tillsammans. Skriv ditt namn och kryssa för vilka streamingtjänster du har — bara titlar ni delar visas.
      </p>

      <form onSubmit={submit} className="bg-surface border border-border-main rounded-sm">
        <div className="px-3 py-[10px] border-b border-border-light">
          <label className="block text-xs text-text-muted mb-1">Ditt namn</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="T.ex. Erik"
            className="w-full max-w-[260px] px-2 py-1 text-base border border-border-main rounded-sm bg-white"
          />
        </div>
        <div className="px-3 py-[10px]">
          <div className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold mb-[6px]">Dina streamingtjänster</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-[3px]">
            {flatrate.map(p => {
              const selected = providers.includes(p.id);
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-[6px] px-2 py-[3px] border rounded-sm cursor-pointer text-xs ${
                    selected ? 'border-accent bg-accent/[0.08]' : 'border-border-main bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleProvider(p.id)}
                    className="accent-accent w-[12px] h-[12px]"
                  />
                  <span className="w-[6px] h-[6px] rounded-full" style={{ background: p.color }} />
                  {p.name}
                </label>
              );
            })}
          </div>
        </div>
        {error && (
          <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border-t border-red-200">{error}</div>
        )}
        <div className="px-3 py-2 border-t border-border-light">
          <button
            type="submit"
            disabled={submitting}
            className="px-3 py-[5px] bg-accent text-white border-none rounded-sm text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {submitting ? 'Går med…' : 'Gå med'}
          </button>
        </div>
      </form>
    </div>
  );
}

function SessionMain({
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
  const [vetoConfirm, setVetoConfirm] = useState<SessionCandidate | null>(null);
  const [now, setNow] = useState(() => Date.now());

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
    if (!effectiveProviders.length && session.config.providerMode === 'intersect') {
      // Om intersect är tom (någon saknar gemensam tjänst) — visa inga resultat
      return [];
    }
    // Filtrera ut titlar så länge kandidaten har minst en provider som finns i setet
    // (kandidater har inte alltid providers-datan, så acceptera de som saknar info)
    return session.candidates.filter(c =>
      c.providers.length === 0 || c.providers.some(p => effectiveProviders.includes(p))
    );
  }, [session.candidates, effectiveProviders, session.config.providerMode]);

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

  const next = useMemo(
    () => nextCandidate({ candidates: filteredCandidates, swipes, participantId: me.id }),
    [filteredCandidates, swipes, me.id],
  );

  const progress = useMemo(
    () => participantSwipeProgress(swipes, filteredCandidates, me.id),
    [swipes, filteredCandidates, me.id],
  );

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/tillsammans/${sessionId}/` : '';

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {/* ignore */}
  };

  const onVote = async (cand: SessionCandidate, vote: VoteKind) => {
    if (vote === 'veto' && me.vetoRemaining <= 0) return;
    if (vote === 'veto' && !vetoConfirm) {
      setVetoConfirm(cand);
      return;
    }
    setVetoConfirm(null);
    try {
      await recordSwipe({ sessionId, tmdbId: cand.tmdbId, participantId: me.id, vote });
    } catch (e) {
      console.error(e);
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
          <Link href="/tillsammans/ny" className="btn btn-ghost btn-sm">
            <ChevronLeft size={12} /> Ny session
          </Link>
          {isFullyLive && (
            <span className="chip acc">
              <span className="live-dot" aria-hidden="true" /> alla aktiva nu
            </span>
          )}
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)',
            letterSpacing: 0.12, textTransform: 'uppercase',
            marginLeft: 'auto',
          }}>
            veto kvar: {me.vetoRemaining}
          </span>
        </div>
      </header>

      <div className="bg-surface border border-border-main rounded-sm mb-[8px]">
        <div className="flex items-center gap-2 px-3 py-[6px] border-b border-border-light text-xs">
          <Share2 size={12} className="text-text-muted" />
          <code className="text-xxs flex-1 truncate text-text-secondary">{shareUrl || 'Hämtar länk…'}</code>
          <button
            type="button"
            onClick={copyShare}
            className="px-2 py-[2px] border border-border-main rounded-sm text-xxs bg-white cursor-pointer flex items-center gap-1"
          >
            <Copy size={10} />
            {shareCopied ? 'Kopierad!' : 'Kopiera'}
          </button>
        </div>
        <div className="px-3 py-[6px] flex items-center gap-2 flex-wrap text-xs">
          <span className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold">Deltagare:</span>
          {participants.map(p => {
            const prog = participantSwipeProgress(swipes, filteredCandidates, p.id);
            const isMe = p.id === me.id;
            const isLive = liveParticipants.some(lp => lp.id === p.id);
            return (
              <span
                key={p.id}
                className={`inline-flex items-center gap-[4px] px-[6px] py-[1px] border rounded-sm text-xxs ${
                  isMe ? 'border-accent text-accent font-semibold' : 'border-border-main text-text-secondary'
                }`}
                title={`${prog.done}/${prog.total} svepningar${isLive ? ' · aktiv nu' : ''}`}
              >
                {isLive && <span className="w-[5px] h-[5px] rounded-full bg-season-done" />}
                {p.displayName}{p.isHost ? ' ★' : ''} <span className="text-text-muted">({prog.done}/{prog.total})</span>
              </span>
            );
          })}
        </div>
        <div className="px-3 py-[5px] border-t border-border-light flex items-center justify-between text-xxs text-text-muted">
          <span>
            Läge: {session.config.providerMode === 'intersect' ? 'Alla har' : 'Någon har'} ·
            {' '}{session.config.mediaType === 'movie' ? 'Filmer' : session.config.mediaType === 'tv' ? 'Serier' : 'Blandat'}
            {' · '}Gemensamma tjänster: {effectiveProviders.length}
          </span>
          <div className="flex gap-[2px]">
            <button
              onClick={() => setView('card')}
              className={`px-2 py-[2px] rounded-sm border text-xxs flex items-center gap-1 ${view === 'card' ? 'bg-accent/[0.1] border-accent text-accent' : 'bg-white border-border-main text-text-secondary'}`}
            >
              <LayoutGrid size={10} /> Kort
            </button>
            <button
              onClick={() => setView('table')}
              className={`px-2 py-[2px] rounded-sm border text-xxs flex items-center gap-1 ${view === 'table' ? 'bg-accent/[0.1] border-accent text-accent' : 'bg-white border-border-main text-text-secondary'}`}
            >
              <Table2 size={10} /> Tabell
            </button>
          </div>
        </div>
      </div>

      {matches.length > 0 && (
        <MatchList matches={matches} session={session} participants={participants} />
      )}

      {filteredCandidates.length === 0 ? (
        <div className="bg-surface border border-border-main rounded-sm px-3 py-4 text-xs text-text-muted">
          Inga titlar matchar era gemensamma tjänster just nu.
          {session.config.providerMode === 'intersect' && effectiveProviders.length === 0 && (
            <div className="mt-2">Prova att byta till &quot;Någon har&quot;-läge i en ny session.</div>
          )}
        </div>
      ) : view === 'card' ? (
        next ? (
          <SwipeCard
            cand={next}
            me={me}
            onVote={onVote}
            progress={progress}
            vetoConfirm={vetoConfirm?.tmdbId === next.tmdbId}
            onCancelVeto={() => setVetoConfirm(null)}
          />
        ) : (
          <div className="bg-surface border border-border-main rounded-sm px-3 py-4 text-center">
            <div className="text-sm font-semibold mb-1">Du har röstat på alla.</div>
            <div className="text-xxs text-text-muted">Vänta på övriga så sammanställs matcherna automatiskt.</div>
          </div>
        )
      ) : (
        <CandidateTable
          scored={scored}
          me={me}
          onVote={onVote}
        />
      )}
    </>
  );
}

function SwipeCard({
  cand, me, onVote, progress, vetoConfirm, onCancelVeto,
}: {
  cand: SessionCandidate;
  me: SessionParticipant;
  onVote: (c: SessionCandidate, v: VoteKind) => void;
  progress: { done: number; total: number };
  vetoConfirm: boolean;
  onCancelVeto: () => void;
}) {
  const poster = posterUrl(cand.posterPath, 'w342');
  return (
    <div className="bg-surface border border-border-main rounded-sm overflow-hidden">
      <div className="flex gap-3 p-3">
        {poster ? (
          <div className={`poster duo-${toneForId(cand.tmdbId)} w-[140px] h-[210px] shrink-0`}>
            <img src={poster} alt="" loading="eager" decoding="async" width={140} height={210} />
          </div>
        ) : (
          <div className="w-[140px] h-[210px] bg-border-light rounded-sm shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-bold leading-tight">{cand.title}</div>
          <div className="text-xxs text-text-muted mt-[2px]">
            {cand.year ?? '—'} · {cand.mediaType === 'movie' ? 'Film' : 'Serie'}
            {cand.voteAverage > 0 && <> · <span className="text-accent">★ {cand.voteAverage.toFixed(1)}</span></>}
          </div>
          <p className="text-xs text-text-secondary mt-2 leading-relaxed line-clamp-6">
            {cand.overview || 'Ingen beskrivning på svenska.'}
          </p>
        </div>
      </div>
      <div className="px-3 py-[6px] border-t border-border-light text-xxs text-text-muted flex items-center justify-between">
        <span>Svept: <b className="text-text-primary">{progress.done}</b> / {progress.total}</span>
        <span>Veto kvar: <b className={me.vetoRemaining > 0 ? 'text-text-primary' : 'text-text-muted'}>{me.vetoRemaining}</b></span>
      </div>
      {vetoConfirm ? (
        <div className="px-3 py-3 border-t border-red-200 bg-red-50 text-xs">
          <div className="font-semibold text-red-800 mb-1">Lägg ett veto?</div>
          <div className="text-text-secondary mb-2">Veto dödar den här titeln definitivt. Du kan använda det bara en gång per session.</div>
          <div className="flex gap-2">
            <button
              onClick={() => onVote(cand, 'veto')}
              className="px-3 py-1 bg-red-600 text-white rounded-sm text-xs font-semibold cursor-pointer"
            >
              Ja, veto
            </button>
            <button
              onClick={onCancelVeto}
              className="px-3 py-1 border border-border-main bg-white rounded-sm text-xs cursor-pointer"
            >
              Avbryt
            </button>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 border-t border-border-light flex gap-2">
          <button
            onClick={() => onVote(cand, 'no')}
            className="flex-1 px-3 py-2 border border-border-main bg-white rounded-sm text-xs font-semibold cursor-pointer flex items-center justify-center gap-1"
          >
            <X size={14} /> Nej
          </button>
          <button
            onClick={() => onVote(cand, 'yes')}
            className="flex-1 px-3 py-2 bg-accent text-white rounded-sm text-xs font-semibold cursor-pointer flex items-center justify-center gap-1"
          >
            <Check size={14} /> Ja
          </button>
          {me.vetoRemaining > 0 && (
            <button
              onClick={() => onVote(cand, 'veto')}
              className="px-3 py-2 border border-red-300 bg-white text-red-700 rounded-sm text-xs font-semibold cursor-pointer flex items-center justify-center gap-1"
              title="Dödar denna titel definitivt"
            >
              <Ban size={14} /> Veto
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CandidateTable({
  scored, me, onVote,
}: {
  scored: ReturnType<typeof scoreCandidates>;
  me: SessionParticipant;
  onVote: (c: SessionCandidate, v: VoteKind) => void;
}) {
  return (
    <div className="bg-surface border border-border-main rounded-sm overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-xxs uppercase tracking-[0.5px] text-text-muted border-b border-border-light">
            <th className="text-left px-2 py-[5px] font-semibold">Titel</th>
            <th className="text-left px-2 py-[5px] font-semibold">År</th>
            <th className="text-left px-2 py-[5px] font-semibold">Typ</th>
            <th className="text-left px-2 py-[5px] font-semibold">★</th>
            <th className="text-left px-2 py-[5px] font-semibold">Gruppen</th>
            <th className="text-right px-2 py-[5px] font-semibold">Din röst</th>
          </tr>
        </thead>
        <tbody>
          {scored.map(r => {
            const myVote = r.votes[me.id];
            const summary = `${r.yesCount} ja · ${r.noCount} nej${r.vetoed ? ' · VETO' : ''}`;
            return (
              <tr key={r.candidate.tmdbId} className={`border-b border-border-table last:border-b-0 ${r.vetoed ? 'opacity-40' : ''}`}>
                <td className="px-2 py-[4px] font-semibold truncate max-w-[260px]">{r.candidate.title}</td>
                <td className="px-2 py-[4px] text-text-muted">{r.candidate.year ?? '—'}</td>
                <td className="px-2 py-[4px] text-text-muted">{r.candidate.mediaType === 'movie' ? 'Film' : 'Serie'}</td>
                <td className="px-2 py-[4px] text-accent">{r.candidate.voteAverage > 0 ? r.candidate.voteAverage.toFixed(1) : '—'}</td>
                <td className="px-2 py-[4px] text-text-muted whitespace-nowrap">{summary}</td>
                <td className="px-2 py-[4px] text-right">
                  <div className="inline-flex gap-[2px]">
                    <button
                      onClick={() => onVote(r.candidate, 'no')}
                      className={`px-[6px] py-[1px] rounded-sm border text-xxs cursor-pointer ${myVote === 'no' ? 'border-accent bg-accent/[0.1] text-accent' : 'border-border-main bg-white text-text-secondary'}`}
                    >
                      Nej
                    </button>
                    <button
                      onClick={() => onVote(r.candidate, 'yes')}
                      className={`px-[6px] py-[1px] rounded-sm border text-xxs cursor-pointer ${myVote === 'yes' ? 'border-accent bg-accent text-white' : 'border-border-main bg-white text-text-secondary'}`}
                    >
                      Ja
                    </button>
                    {(me.vetoRemaining > 0 || myVote === 'veto') && (
                      <button
                        onClick={() => onVote(r.candidate, 'veto')}
                        className={`px-[6px] py-[1px] rounded-sm border text-xxs cursor-pointer ${myVote === 'veto' ? 'border-red-500 bg-red-100 text-red-700' : 'border-border-main bg-white text-text-muted'}`}
                      >
                        Veto
                      </button>
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

function MatchList({
  matches,
  session,
  participants,
}: {
  matches: ReturnType<typeof pickMatches>;
  session: TogetherSession;
  participants: SessionParticipant[];
}) {
  const isGroupSession = !!session.groupId;
  const [picking, setPicking] = useState<number | null>(null);
  const [pickedTmdbId, setPickedTmdbId] = useState<number | null>(null);

  // Logga till gruppens sessionHistory så filmkvällen syns på grupp-sidan
  // som "Senaste filmkvällar". Bara meningsfullt för grupp-bundna sessioner.
  const recordPick = async (m: ReturnType<typeof pickMatches>[number]) => {
    if (!session.groupId) return;
    setPicking(m.candidate.tmdbId);
    try {
      const { recordGroupSessionPick } = await import('@/lib/firebase/groups');
      await recordGroupSessionPick({
        groupId: session.groupId,
        sessionId: session.id,
        pickedTmdbId: m.candidate.tmdbId,
        mediaType: m.candidate.mediaType,
        mediaTitle: m.candidate.title,
        posterPath: m.candidate.posterPath,
        participantUids: participants.map(p => p.uid).filter((u): u is string => !!u),
      });
      setPickedTmdbId(m.candidate.tmdbId);
    } catch (err) {
      console.warn('[group-session-pick]', err);
    } finally {
      setPicking(null);
    }
  };

  return (
    <div className="bg-surface border border-accent rounded-sm mb-[8px]">
      <div className="px-3 py-[5px] border-b border-accent/30 bg-accent/[0.06] text-xxs uppercase tracking-[0.5px] text-accent font-semibold">
        Matcher ({matches.length})
      </div>
      <div className="divide-y divide-border-light">
        {matches.map(m => {
          const href = `/${m.candidate.mediaType === 'movie' ? 'movie' : 'tv'}/${m.candidate.tmdbId}/`;
          const poster = posterUrl(m.candidate.posterPath, 'w92');
          const isPicked = pickedTmdbId === m.candidate.tmdbId;
          return (
            <div key={m.candidate.tmdbId} className="flex items-center gap-2 px-3 py-[5px] hover:bg-surface-hover">
              <Link
                href={href}
                className="flex items-center gap-2 flex-1 min-w-0 no-underline text-text-primary"
              >
                {poster ? (
                  <div className={`poster duo-${toneForId(m.candidate.tmdbId)} w-[28px] h-[42px]`}>
                    <img src={poster} alt="" loading="lazy" decoding="async" width={28} height={42} />
                  </div>
                ) : (
                  <div className="w-[28px] h-[42px] bg-border-light rounded-sm" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{m.candidate.title}</div>
                  <div className="text-xxs text-text-muted">
                    {m.candidate.year ?? '—'} · {m.candidate.mediaType === 'movie' ? 'Film' : 'Serie'}
                    {m.candidate.voteAverage > 0 && <> · <span className="text-accent">★ {m.candidate.voteAverage.toFixed(1)}</span></>}
                  </div>
                </div>
              </Link>
              <div className="text-xxs text-text-muted text-right shrink-0">
                {m.yesCount} ja / {m.noCount} nej
                {!m.allVoted && <div className="text-accent">{m.missing.length} kvar</div>}
              </div>
              {isGroupSession && (
                isPicked ? (
                  <span className="text-xxs text-accent font-semibold inline-flex items-center gap-1"><Check size={11} /> Vald</span>
                ) : (
                  <button
                    onClick={() => recordPick(m)}
                    disabled={picking === m.candidate.tmdbId}
                    className="px-2 py-[2px] text-xxs border border-accent bg-accent text-white rounded-sm cursor-pointer font-[inherit] disabled:opacity-50"
                    title="Logga till gruppens filmkvällshistorik"
                  >
                    {picking === m.candidate.tmdbId ? 'Sparar…' : 'Den här tar vi'}
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}
