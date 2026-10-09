'use client';

import { useEffect, useState } from 'react';
import { takeLoginBounce } from '@/lib/loginBounce';

// Rendered from the login layout so the page itself stays untouched. Server HTML
// and the first client render are both empty; the line appears after mount, so
// there is no hydration mismatch.
export default function LoginBounceNotice() {
  const [bounced, setBounced] = useState(false);
  useEffect(() => {
    // Only ever sets true: the consumed marker makes a StrictMode re-run read false.
    if (takeLoginBounce()) setBounced(true);
  }, []);
  if (!bounced) return null;
  return (
    <p role="status" className="text-sm text-ink-2 text-center mt-4 mb-0">
      Logga in för att fortsätta.
    </p>
  );
}
