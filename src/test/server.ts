import { setupServer } from 'msw/node';
import { defaultHandlers } from './handlers';

// Delad MSW node-server för Vitest. Lifecycle (listen/resetHandlers/close)
// kopplas in i vitest.setup.ts så alla tester delar samma interception-lager.
export const server = setupServer(...defaultHandlers);
