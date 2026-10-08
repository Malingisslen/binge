import { describe, it, expect } from 'vitest';
import { shownFriendName } from './friendName';

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
