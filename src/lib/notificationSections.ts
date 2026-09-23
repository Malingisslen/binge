/**
 * BIN-1265: the bell's inbox, split under two headings.
 *
 * `system` cards — a report's outcome, a group's new owner, admin notices — used to
 * sit under "Streamingnyheter", which they are not. Malin's decision 2026-09-23:
 * they get their own heading, "Från Binge", and it comes first. Only the ten
 * newest cards are shown, counted before the split, as before. An empty section is
 * left out.
 */
export interface NotificationSection<T> {
  heading: string;
  items: T[];
}

export function notificationSections<T extends { kind?: string }>(
  notifications: readonly T[],
  limit = 10,
): NotificationSection<T>[] {
  const shown = notifications.slice(0, limit);
  const sections: NotificationSection<T>[] = [
    { heading: 'Från Binge', items: shown.filter((n) => n.kind === 'system') },
    { heading: 'Streamingnyheter', items: shown.filter((n) => n.kind !== 'system') },
  ];
  return sections.filter((s) => s.items.length > 0);
}
