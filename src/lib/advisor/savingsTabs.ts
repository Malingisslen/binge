// ASCII ids so the hash survives copy/paste and chat apps that mangle å, ä, ö.
export const SAVINGS_TABS = [
  { id: 'tjanster', label: 'Tjänster' },
  { id: 'pausa', label: 'Pausa & rotera' },
  { id: 'paket', label: 'Paket' },
  { id: 'detaljer', label: 'Detaljer' },
] as const;

export type SavingsTabId = (typeof SAVINGS_TABS)[number]['id'];

export const DEFAULT_SAVINGS_TAB: SavingsTabId = 'tjanster';

/** An unknown or empty hash falls back to the first tab instead of showing no panel. */
export function tabFromHash(hash: string): SavingsTabId {
  const id = hash.replace(/^#/, '');
  return SAVINGS_TABS.find(t => t.id === id)?.id ?? DEFAULT_SAVINGS_TAB;
}
