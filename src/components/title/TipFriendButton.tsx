'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { Send, Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useFriends } from '@/hooks/useFriends';
import { useBlockedUsers } from '@/hooks/useBlockedUsers';
import { useTipActions } from '@/hooks/useTips';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useToast } from '@/contexts/ToastContext';
import { captureError } from '@/lib/sentry';
import { TIP_NOTE_MAX } from '@/lib/tips';
import type { MediaType } from '@/types';
import { Button } from '@/components/ui/Button';
import { cardClass } from '@/components/ui/Card';
import { fieldClass } from '@/components/ui/Field';

interface Props {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
}

export default function TipFriendButton({ tmdbId, mediaType, title }: Props) {
  const { uid } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const closeAndRefocus = useCallback(() => { setOpen(false); triggerRef.current?.focus(); }, []);
  useClickOutside(ref, close);
  useEscapeKey(open, closeAndRefocus);

  if (!uid) return null;

  return (
    <div className="relative inline-block" ref={ref}>
      <Button
        ref={triggerRef}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        variant="ghost" size="sm" className="flex items-center gap-1"
      >
        <Send size={12} />
        Tipsa en vän
      </Button>
      {/* The friend list is read only once the picker opens, so a title page view
          costs no friend or profile-card reads. */}
      {open && <TipPicker myUid={uid} tmdbId={tmdbId} mediaType={mediaType} title={title} onSent={close} />}
    </div>
  );
}

function TipPicker({ myUid, tmdbId, mediaType, title, onSent }: Props & { myUid: string; onSent: () => void }) {
  const { data: allFriends = [], isLoading } = useFriends();
  const { isBlocked } = useBlockedUsers();
  const { sendTip } = useTipActions();
  const { show: toast } = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  // The rules refuse a tip to a friend who has turned tips off, and the sender cannot
  // read that setting, so the refusal is what tells them and has to be shown.
  const [failed, setFailed] = useState(false);

  const friends = allFriends.filter(f => f.uid !== myUid && !isBlocked(f.uid));

  async function submit() {
    if (!selected || sending) return;
    setSending(true);
    setFailed(false);
    try {
      await sendTip(selected, { mediaType, tmdbId, title }, note);
      const name = friends.find(f => f.uid === selected)?.displayName ?? 'din vän';
      toast(`Tipset är skickat till ${name}`);
      onSent();
    } catch (err) {
      captureError(err, { scope: 'friends', kind: 'tip-send' });
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Tipsa en vän"
      className={cardClass('absolute left-0 top-full mt-1 w-[240px] z-50 p-2 flex flex-col gap-2')}
    >
      {isLoading && <div className="px-2 py-1.5 text-xs text-ink-3">Hämtar vänner…</div>}
      {!isLoading && friends.length === 0 && (
        <div className="px-2 py-1.5 text-xs text-ink-3">
          Du har inga vänner att tipsa än. Hitta dem under <Link href="/my/friends/">Vänner</Link>.
        </div>
      )}
      {friends.length > 0 && (
        <>
          <ul className="max-h-[180px] overflow-y-auto" aria-label="Välj vän">
            {friends.map(f => {
              const isSel = selected === f.uid;
              return (
                <li key={f.uid}>
                  <button
                    type="button"
                    aria-pressed={isSel}
                    onClick={() => { setSelected(isSel ? null : f.uid); setFailed(false); }}
                    className="w-full text-left px-2 py-1.5 text-xs border-none bg-transparent font-[inherit] cursor-pointer hover:bg-bg-2 flex items-center gap-2"
                  >
                    <span className={`w-[14px] inline-flex items-center justify-center ${isSel ? 'text-acc-deep' : 'text-ink-3'}`}>
                      {isSel ? <Check size={11} /> : null}
                    </span>
                    <span className="truncate text-ink">{f.displayName}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <label className="text-xxs text-ink-3 flex flex-col gap-1">
            Hälsning (valfri)
            <textarea
              value={note}
              maxLength={TIP_NOTE_MAX}
              rows={2}
              onChange={e => setNote(e.target.value)}
              className={fieldClass({ size: 'sm', className: 'w-full resize-none' })}
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xxs text-ink-3">{note.length}/{TIP_NOTE_MAX}</span>
            <Button type="button" variant="acc" size="xs" disabled={!selected || sending} onClick={() => { void submit(); }}>
              {sending ? 'Skickar…' : 'Skicka tips'}
            </Button>
          </div>
          {failed && (
            <span role="alert" className="text-xs text-danger-ink">
              Tipset gick inte att skicka. Din vän kanske har stängt av tips.
            </span>
          )}
        </>
      )}
    </div>
  );
}
