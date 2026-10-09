import type { Metadata } from 'next';
import LoginBounceNotice from '@/components/auth/LoginBounceNotice';

export const metadata: Metadata = {
  title: 'Logga in',
  description: 'Logga in på Binge.nu för att hålla koll på vad du tittar på och se var titlarna finns att streama.',
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LoginBounceNotice />
      {children}
    </>
  );
}
