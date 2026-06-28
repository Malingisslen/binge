// Versioned legal-acceptance constants — the single source of truth shared by the
// sign-up UI (src/app/login/page.tsx) and the profile-creation paths
// (src/contexts/AuthContext.tsx). Keeping them here stops the version drifting
// between the email/password and Google-SSO flows.

// Bump when the Terms of Service or Privacy Policy change materially (e.g. to
// '2026-07-01'). The user's recorded `termsVersion` lets us prompt for
// re-acceptance when this changes.
export const CURRENT_TERMS_VERSION = '2026-06-04';

// Minimum age to create a Binge account (the lawful-basis floor we assert at
// sign-up on both auth paths). (BIN-348)
export const MIN_AGE = 13;
