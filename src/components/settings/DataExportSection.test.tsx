// src/components/settings/DataExportSection.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { DataExportSection } from './DataExportSection';
import type { BingeExport, SkippedGroup } from '@/lib/firebase/dataExport';

// BIN-1380 (Malin 2026-10-01, after the attended panel): an incomplete export is told in
// a line under the button that stays until the next export, never in a toast that is
// gone before it can be read. A complete export keeps the unchanged toast. The strings
// are pinned whole: the notice makes a claim about a data-subject request.

const toast = vi.hoisted(() => ({ show: vi.fn() }));
const exportMock = vi.hoisted(() => ({
  buildUserExport: vi.fn<(uid: string) => Promise<BingeExport>>(),
  downloadExport: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'u1' }) }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }));
vi.mock('@/lib/firebase/dataExport', () => exportMock);

const TAIL = 'Försök exportera igen om en stund. Fungerar det inte nästa gång heller? Skriv till hej@binge.nu.';

function exportWith(skippedGroups: SkippedGroup[]): BingeExport {
  return { skippedGroups } as unknown as BingeExport;
}

function skipped(groupId: string, groupName: string | null): SkippedGroup {
  return { groupId, groupName, missing: ['groupMemberRows'] };
}

async function clickExport() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Ladda ner mina data' }));
  });
}

async function noticeFor(groups: SkippedGroup[]): Promise<string | null> {
  exportMock.buildUserExport.mockResolvedValueOnce(exportWith(groups));
  render(<DataExportSection />);
  await clickExport();
  return screen.queryByRole('status')?.textContent ?? null;
}

describe('DataExportSection — the confirmation after an export (BIN-1380)', () => {
  beforeEach(() => {
    toast.show.mockReset();
    exportMock.buildUserExport.mockReset();
    exportMock.downloadExport.mockReset();
  });

  it('a complete export keeps the unchanged toast and shows no notice', async () => {
    expect(await noticeFor([])).toBeNull();
    expect(exportMock.downloadExport).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith('Dataexport nedladdad.');
  });

  it('an incomplete export still downloads, and names the group in a lasting line instead of a toast', async () => {
    expect(await noticeFor([skipped('g1', 'Filmklubben')])).toBe(
      `Dataexport nedladdad, men den är inte komplett. Uppgifterna från Filmklubben gick inte att läsa. ${TAIL}`);
    expect(exportMock.downloadExport).toHaveBeenCalledTimes(1);
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('the notice is still there after a toast would have gone', async () => {
    vi.useFakeTimers();
    try {
      exportMock.buildUserExport.mockResolvedValueOnce(exportWith([skipped('g1', 'Filmklubben')]));
      render(<DataExportSection />);
      await clickExport();
      await act(async () => { vi.advanceTimersByTime(60_000); });
      expect(screen.getByRole('status').textContent).toContain('Filmklubben');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the notice goes away when the next export starts', async () => {
    exportMock.buildUserExport.mockResolvedValueOnce(exportWith([skipped('g1', 'Filmklubben')]));
    render(<DataExportSection />);
    await clickExport();
    expect(screen.getByRole('status')).toBeTruthy();

    // Held open, so "cleared when the export finished" cannot pass for "cleared on click".
    let finish!: (data: BingeExport) => void;
    exportMock.buildUserExport.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await clickExport();
    expect(screen.queryByRole('status')).toBeNull();

    await act(async () => { finish(exportWith([])); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a failed next export does not leave the earlier notice standing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exportMock.buildUserExport.mockResolvedValueOnce(exportWith([skipped('g1', 'Filmklubben')]));
    render(<DataExportSection />);
    await clickExport();
    expect(screen.getByRole('status')).toBeTruthy();

    exportMock.buildUserExport.mockRejectedValueOnce(new Error('boom'));
    await clickExport();
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith('Kunde inte skapa exporten. Försök igen.'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('two groups are joined with "och"', async () => {
    expect(await noticeFor([skipped('a', 'Filmklubben'), skipped('b', 'Familjen')])).toBe(
      `Dataexport nedladdad, men den är inte komplett. Uppgifterna från Filmklubben och Familjen gick inte att läsa. ${TAIL}`);
  });

  it('three groups are joined with a comma and "och"', async () => {
    expect(await noticeFor([skipped('a', 'Filmklubben'), skipped('b', 'Familjen'), skipped('c', 'Jobbet')])).toBe(
      `Dataexport nedladdad, men den är inte komplett. Uppgifterna från Filmklubben, Familjen och Jobbet gick inte att läsa. ${TAIL}`);
  });

  it('four groups show three names and "och 1 till"', async () => {
    expect(await noticeFor([
      skipped('a', 'Filmklubben'), skipped('b', 'Familjen'), skipped('c', 'Jobbet'), skipped('d', 'Grannarna'),
    ])).toBe(
      `Dataexport nedladdad, men den är inte komplett. Uppgifterna från Filmklubben, Familjen, Jobbet och 1 till gick inte att läsa. ${TAIL}`);
  });

  it('more than three groups show three names and how many more', async () => {
    expect(await noticeFor([
      skipped('a', 'Filmklubben'), skipped('b', 'Familjen'), skipped('c', 'Jobbet'),
      skipped('d', 'Grannarna'), skipped('e', 'Kusinerna'),
    ])).toBe(
      `Dataexport nedladdad, men den är inte komplett. Uppgifterna från Filmklubben, Familjen, Jobbet och 2 till gick inte att läsa. ${TAIL}`);
  });

  it('a group with no name, or only blanks, is called "en grupp utan namn"', async () => {
    expect(await noticeFor([skipped('a', null), skipped('b', '   ')])).toBe(
      `Dataexport nedladdad, men den är inte komplett. Uppgifterna från en grupp utan namn och en grupp utan namn gick inte att läsa. ${TAIL}`);
  });

  it('a group that failed in more than one field is named once', async () => {
    expect(await noticeFor([
      { groupId: 'a', groupName: 'Filmklubben', missing: ['householdContributions'] },
      { groupId: 'a', groupName: 'Filmklubben', missing: ['groupTitleRatings'] },
    ])).toBe(
      `Dataexport nedladdad, men den är inte komplett. Uppgifterna från Filmklubben gick inte att läsa. ${TAIL}`);
  });

  it('a failed export keeps its unchanged error toast and shows no notice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exportMock.buildUserExport.mockRejectedValueOnce(new Error('boom'));
    render(<DataExportSection />);
    await clickExport();
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith('Kunde inte skapa exporten. Försök igen.'));
    expect(screen.queryByRole('status')).toBeNull();
    expect(exportMock.downloadExport).not.toHaveBeenCalled();
  });
});
