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
    ],
  },
  {
    rules: {
      // Next 16 aktiverade react-hooks-plugin-rules som är väldigt
      // strikta mot mönster vi använder intentionellt:
      //
      // set-state-in-effect: vår SSR-mount-guard
      //   `const [mounted, setM] = useState(false); useEffect(() => setM(true), [])`
      //   är standard-React för static export. Rule:n flaggar även useEffect
      //   som synkar data från sub-components (t.ex. pagination-listor).
      //
      // use-memo: vår `[showQueries.map(q => q.dataUpdatedAt).join(',')]`-
      //   dependency är ett känt work-around för att minska re-renders när
      //   en array av queries uppdateras individuellt. Vi har också eslint-
      //   disable-comments på raderna ifråga. Rule:n kräver "simple
      //   expressions" vilket är för strikt.
      //
      // Om vi vill flagga dessa en dag: aktivera dem i en dedikerad sprint
      // med en plan för att migrera mönstren. Inte nu, mitt i Next 16-
      // uppgraderingen.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/use-memo': 'off',
    },
  },
];
