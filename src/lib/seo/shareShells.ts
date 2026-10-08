/**
 * Delade länkar till sociala sidor (Tillsammans, grupper, profiler, listor) har ingen
 * egen förrenderad HTML — Firebase skriver om dem till ett skal, och länkförhandsvisare
 * kör inte JavaScript. Därför får varje sådan URL-prefix ett eget skal med egen titel,
 * beskrivning och bild, så att en länk i WhatsApp eller iMessage säger vad den är.
 *
 * `firebase.json` måste skriva om `/<prefix>/**` till `/<prefix>/_/index.html` före
 * `**`-regeln, och bilden måste ligga i `public/og/`; shareShells.test.ts kontrollerar
 * båda mot listan nedan. Skalen förblir noindex, som catch-all-skalet.
 */

export interface ShareShell {
  /** Första URL-segmentet, t.ex. `tillsammans`. */
  prefix: string;
  title: string;
  description: string;
  /** Sökväg under `public/`, 1200×630 PNG. */
  image: string;
  imageAlt: string;
}

export const SHARE_SHELLS: readonly ShareShell[] = [
  {
    prefix: 'tillsammans',
    title: 'Välj vad ni ska se — Binge',
    description: 'Du är inbjuden att välja tillsammans. Svep ja eller nej på förslagen. Inget konto behövs.',
    image: '/og/tillsammans.png',
    imageAlt: 'Binge.nu — välj vad ni ska se',
  },
  {
    prefix: 'grupper',
    title: 'Inbjudan till en grupp — Binge',
    description: 'Gå med i gruppen och se vad ni kan streama tillsammans.',
    image: '/og/grupper.png',
    imageAlt: 'Binge.nu — du är inbjuden till en grupp',
  },
  {
    prefix: 'list',
    title: 'En lista på Binge',
    description: 'Film och serier, och var de går att streama i Sverige.',
    image: '/og/lista.png',
    imageAlt: 'Binge.nu — en lista',
  },
  {
    prefix: 'user',
    title: 'En profil på Binge',
    description: 'Vad som tittas på, vill ses och har betygsatts på Binge.',
    image: '/og/profil.png',
    imageAlt: 'Binge.nu — en profil',
  },
];

export function shareShellFor(firstSegment: string | undefined): ShareShell | undefined {
  return SHARE_SHELLS.find((s) => s.prefix === firstSegment);
}
