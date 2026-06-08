// Vitest global setup — extends `expect` with jest-dom matchers so
// component tests can use toBeInTheDocument(), toHaveClass(), etc.
import '@testing-library/jest-dom/vitest';

// MSW node-server lifecycle — interceptar HTTP på fetch-nivå för alla tester.
// `onUnhandledRequest: 'error'` så ett oavsiktligt riktigt nätverksanrop failar
// högljutt istället för att tyst slinka igenom (MSW:s rekommenderade default).
// Abort-fallet i client.test.ts bailar innan fetch någonsin sker, så det når
// aldrig MSW och triggar därför inte denna. Tester som behöver en ny endpoint
// lägger till en handler i src/test/handlers.ts eller via server.use().
import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './src/test/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
