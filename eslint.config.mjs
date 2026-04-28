import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

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
];
