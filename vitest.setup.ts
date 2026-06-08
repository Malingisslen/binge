// Vitest global setup — extends `expect` with jest-dom matchers so
// component tests can use toBeInTheDocument(), toHaveClass(), etc.
import '@testing-library/jest-dom/vitest';

// MSW node-server lifecycle — interceptar HTTP på fetch-nivå för alla tester.
// `onUnhandledRequest: 'warn'` så ej-stubbade endpoints syns men inte failar
// (t.ex. client.test.ts abort-fallet som bailar innan fetch någonsin sker).
import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './src/test/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
