import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { GroupMembersPanel } from './GroupMembersPanel';
import type { GroupMember } from '@/types';

// BIN-1162 / #18 Community Manager, blockerande villkor 2026-09-12.
//
// Varför filen finns: villkoret Malin valde är en RENDERING, och en rendering utan
// test går att radera med hela sviten grön. Före BIN-1162 var namnkopian på
// medlemsraden fryst vid inträdet; live-propagering gör ett namnbyte till något som
// syns i medlemslistan direkt, och medlemslistan ska skilja medlemmarna åt.
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    <a href={href}>{children}</a>,
}));
vi.mock('@/lib/firebase/groups', () => ({
  inviteMemberByUid: vi.fn(async () => {}),
  removeMemberAsOwner: vi.fn(async () => {}),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
// Formen är React Querys, inte en egen — komponenten destrukturerar
// `{ data: results, isLoading }`. Ett mockat `{ results, loading }` hade varit tyst
// fel tills första testet sätter `isOwner`, eftersom sökrutan inte renderas förrän då.
vi.mock('@/hooks/useUserSearch', () => ({ useUserSearch: () => ({ data: [], isLoading: false }) }));

function member(over: Partial<GroupMember> & { uid: string }): GroupMember {
  return {
    displayName: 'Anna',
    username: null,
    photoURL: null,
    providers: [],
    joinedAt: null,
    ...over,
  } as GroupMember;
}

function renderPanel(members: GroupMember[]) {
  cleanup();
  return render(
    <GroupMembersPanel
      groupId="g1"
      groupName="Filmklubben"
      members={members}
      ownerUid="owner"
      myUid="owner"
      isOwner={false}
    />,
  );
}

describe('GroupMembersPanel — användarnamnet skiljer två likadana namn åt (BIN-1162)', () => {
  it('visar användarnamnet som TEXT, inte bara som länkmål', () => {
    renderPanel([member({ uid: 'a', displayName: 'Anna', username: 'anna' })]);

    // Texten, inte href:en. Före den här ändringen bar medlemsRADEN användarnamnet
    // enbart som `/user/<username>`, vilket inte syns för någon som läser listan.
    // (Komponentens inbjudningslista visade det redan som text — det är en annan yta.)
    expect(screen.getByText('@anna', { exact: false })).toBeTruthy();
  });

  it('två medlemmar med SAMMA visningsnamn renderar olika rader', () => {
    renderPanel([
      member({ uid: 'a', displayName: 'Anna', username: 'anna' }),
      member({ uid: 'b', displayName: 'Anna', username: 'anna_k' }),
    ]);

    // Det är hela poängen med villkoret: identiska visningsnamn får inte ge
    // identiska rader.
    expect(screen.getByText('@anna ·', { exact: false })).toBeTruthy();
    expect(screen.getByText('@anna_k ·', { exact: false })).toBeTruthy();
  });

  it('en medlem utan användarnamn får ingen tom @-rad', () => {
    const { container } = renderPanel([member({ uid: 'a', displayName: 'Anna', username: null })]);

    // Resten som villkoret INTE stänger, och som kommentaren i komponenten skriver
    // ut: två medlemmar utan användarnamn kan fortfarande se likadana ut. Det som
    // testas här är bara att frånvaron renderas rent, inte som "@ ·".
    expect(container.textContent).not.toContain('@');
    expect(screen.getByText('Anna')).toBeTruthy();
  });
});

// BIN-1302: bekräftelsen "Ta bort" måste nå `removeMemberAsOwner` med rätt grupp och
// uid — det är den som också ber servern radera medlemmens spår (BIN-1296).
describe('GroupMembersPanel — ägaren tar bort en medlem (BIN-1302)', () => {
  it('bekräftelsen anropar removeMemberAsOwner med gruppen och medlemmens uid', async () => {
    const { removeMemberAsOwner } = await import('@/lib/firebase/groups');
    cleanup();
    render(
      <GroupMembersPanel
        groupId="g1"
        groupName="Filmklubben"
        members={[member({ uid: 'owner', displayName: 'Malin' }), member({ uid: 'jonas', displayName: 'Jonas' })]}
        ownerUid="owner"
        myUid="owner"
        isOwner
      />,
    );

    fireEvent.click(screen.getByTitle('Ta bort'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ta bort' }));

    expect(removeMemberAsOwner).toHaveBeenCalledWith('g1', 'jonas');
  });
});
