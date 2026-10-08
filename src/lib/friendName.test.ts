import { describe, it, expect } from 'vitest';
import { shownFriendName, shownSenderName } from './friendName';

describe('shownFriendName', () => {
  it('visar visningsnamnet när det finns', () => {
    expect(shownFriendName('Jonatan', 'jonatan')).toBe('Jonatan');
  });

  it('visar användarnamnet när visningsnamnet saknas', () => {
    expect(shownFriendName(null, 'jonatan')).toBe('jonatan');
    expect(shownFriendName('', 'jonatan')).toBe('jonatan');
  });

  it('räknar ett namn av bara blanksteg som saknat', () => {
    expect(shownFriendName('   ', 'jonatan')).toBe('jonatan');
  });

  it('tar bort blanksteg runt ett riktigt namn', () => {
    expect(shownFriendName('  Jonatan ', null)).toBe('Jonatan');
  });

  it('faller tillbaka på Användare när båda saknas', () => {
    expect(shownFriendName(null, null)).toBe('Användare');
    expect(shownFriendName('', '')).toBe('Användare');
    expect(shownFriendName(undefined, undefined)).toBe('Användare');
  });
});

describe('shownSenderName', () => {
  it('visar namnet från avsändarens profil', () => {
    expect(shownSenderName({ displayName: 'Sara', username: 'sara' }, 'Gammalt namn')).toBe('Sara');
  });

  it('visar användarnamnet när profilens namn är tomt eller bara blanksteg', () => {
    expect(shownSenderName({ displayName: '  ', username: 'sara' }, 'Någon')).toBe('sara');
    expect(shownSenderName({ displayName: null, username: 'sara' }, 'Någon')).toBe('sara');
  });

  it('faller tillbaka på det sparade namnet när profilen saknas eller är tom', () => {
    expect(shownSenderName(null, 'Någon')).toBe('Någon');
    expect(shownSenderName({ displayName: '', username: null }, 'Sara')).toBe('Sara');
  });
});
