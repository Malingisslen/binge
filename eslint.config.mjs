import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import noBareStreamingOffersId from './eslint-rules/no-bare-streaming-offers-id.mjs';

export default [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      '.next/**',
      'out/**',
      'node_modules/**',
      'emulator-data/**',
      'mockups/**',
      // Cloud Functions har sitt eget tsconfig + CommonJS-output. Root-lint
      // ska inte tracka compileratet eller dess deps.
      'functions/lib/**',
      'functions/node_modules/**',
      // `.gitignore` already excludes `scripts/recaps/*` — per-show scratch the recap
      // pipeline writes locally and never commits. Linting it made `npm run lint`
      // disagree with CI: on a machine that has run /recap the local run reported
      // errors in files the repo does not contain, while ci.yml, deploy.yml and
      // preview.yml lint a fresh checkout. A lint that is red
      // only on the author's machine is worse than no lint: it trains you to ignore
      // the output. Ignored HERE rather than deleted, because the scratch is the
      // pipeline's own working set, not stale output.
      'scripts/recaps/**',
    ],
  },
  {
    rules: {
      // Off: flaggar vår SSR-mount-guard (`useEffect(() => setMounted(true), [])`)
      // som är standard-React för static export.
      'react-hooks/set-state-in-effect': 'off',
      // Off: flaggar vår `[arr.map().join(',')]`-dep-workaround i
      // useSubscriptionAdvisor + useRevivalNudges. "Simple expressions"-
      // kravet är för strikt för vårt usecase.
      'react-hooks/use-memo': 'off',
    },
  },
  {
    // BIN-931 — the structural guard against BIN-523 coming back. Rule rationale + the
    // shapes the regexes could not see: the rule file's header.
    plugins: { binge: { rules: { 'no-bare-streaming-offers-id': noBareStreamingOffersId } } },
    rules: { 'binge/no-bare-streaming-offers-id': 'error' },
  },
];
