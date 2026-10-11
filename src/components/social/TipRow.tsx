'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTipActions } from '@/hooks/useTips';
import { useSenderProfile } from '@/hooks/useSenderProfile';
import { shownFriendName } from '@/lib/friendName';
import { titleHref, type Tip } from '@/lib/tips';
import { Button } from '@/components/ui/Button';

// The sender's name comes from their public card at render time; the tip itself stores
// only their uid. There is no add button here: a tip carries no poster or year, so a title
// added from the row would land in the library without them. The title page adds it whole.
export function TipRow({ tip }: { tip: Tip }) {
  const { dismissTip } = useTipActions();
  const { data: sender } = useSenderProfile(tip.fromUid);
  const [failed, setFailed] = useState(false);
  const name = shownFriendName(sender?.displayName, sender?.username);
  const profileLink = sender?.username ? `/user/${sender.username}/` : null;
  return (
    <li className="py-2 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-xs">
          {profileLink ? (
            <Link href={profileLink} className="font-semibold text-ink no-underline hover:text-acc-deep">{name}</Link>
          ) : (
            <span className="font-semibold text-ink">{name}</span>
          )}
          <span className="text-ink-3"> tipsar om </span>
          <Link href={titleHref(tip.mediaType, tip.tmdbId)} className="font-semibold text-ink no-underline hover:text-acc-deep">
            {tip.title}
          </Link>
        </div>
        {tip.note && <div className="text-xxs text-ink-2 mt-px break-words">{tip.note}</div>}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className="flex items-center gap-1">
          <Button
            onClick={async () => {
              setFailed(false);
              try { await dismissTip(tip.id); } catch { setFailed(true); }
            }}
            variant="ghost" size="xs"
          >
            Ta bort
          </Button>
        </div>
        {failed && <span role="alert" className="text-xs text-danger-ink">Gick inte att ta bort</span>}
      </div>
    </li>
  );
}
