'use client';

import AuthGuard from '@/components/AuthGuard';
import FriendsPageClient from '@/components/pages/FriendsPageClient';

export default function FriendsPage() {
  return <AuthGuard><FriendsPageClient /></AuthGuard>;
}
