'use client';

import AuthGuard from '@/components/AuthGuard';
import { PageHeader } from '@/components/layout/PageHeader';
import { FriendsFeed } from '@/components/social/FriendsFeed';

export default function FeedPage() {
  return (
    <AuthGuard>
      <PageHeader
        crumb="Vänner · Flöde"
        title="Flöde"
        standfirst="Senaste från dina vänner och dem du följer — recensioner, betyg och uppdateringar."
      />
      <div className="mt-7">
        <FriendsFeed />
      </div>
    </AuthGuard>
  );
}
