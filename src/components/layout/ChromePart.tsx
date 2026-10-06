import { chromePart, type ChromeMode } from './chromeMode';

// Renders a piece of chrome meant for one audience (see chromeMode.ts).
export default function ChromePart({ mode, audience, children }: { mode: ChromeMode; audience: 'app' | 'guest'; children: React.ReactNode }) {
  const { show, className } = chromePart(mode, audience);
  if (!show) return null;
  return className ? <div className={className}>{children}</div> : <>{children}</>;
}
