import { describe, it, expect } from 'vitest';
import { withItemAdded, withItemRemoved, withItemReinserted } from './listItemsPatch';
import type { UserListItem } from '@/types';

function item(tmdbId: number): UserListItem {
  return { tmdbId, mediaType: 'movie', title: `Titel ${tmdbId}`, posterPath: null, addedAt: new Date() };
}

describe('withItemAdded / withItemRemoved', () => {
  it('lägger till sist och rör inte originalet', () => {
    const before = [item(1)];
    expect(withItemAdded(before, item(2)).map(i => i.tmdbId)).toEqual([1, 2]);
    expect(before.map(i => i.tmdbId)).toEqual([1]);
  });

  it('tar bort bara den angivna titeln', () => {
    expect(withItemRemoved([item(1), item(2), item(3)], 2).map(i => i.tmdbId)).toEqual([1, 3]);
  });

  it('är en no-op när titeln inte finns', () => {
    expect(withItemRemoved([item(1)], 99).map(i => i.tmdbId)).toEqual([1]);
  });
});

describe('återställningen kommuterar med en samtidig syskonskrivning', () => {
  // Det blockerande fyndet i granskningen av BIN-1207:s klienthalva. Ingen av handlarna
  // inväntas av sin anropare, så det här förloppet är nåbart. Skulle återställningen
  // vara "lägg tillbaka ögonblicksbilden från före mitt eget tillägg" försvinner B —
  // en titel som faktiskt ligger i Firestore — utan felmeddelande.
  it('en nekad tillägg-återställning behåller en samtidig lyckad tillägg', () => {
    let cache: UserListItem[] = [];
    cache = withItemAdded(cache, item(1));          // A läggs till optimistiskt
    cache = withItemAdded(cache, item(2));          // B läggs till medan A är i luften
    cache = withItemRemoved(cache, 1);              // A nekas → inversen av A
    expect(cache.map(i => i.tmdbId)).toEqual([2]);  // B står kvar
  });

  it('en nekad borttagning-återställning behåller en samtidig lyckad tillägg', () => {
    const removed = item(1);
    let cache: UserListItem[] = [removed, item(2)];
    cache = withItemRemoved(cache, 1);                   // A tas bort optimistiskt
    cache = withItemAdded(cache, item(3));               // C läggs till medan A är i luften
    cache = withItemReinserted(cache, removed, 0);       // A nekas → inversen av A
    expect(cache.map(i => i.tmdbId)).toEqual([1, 2, 3]); // C står kvar, A är tillbaka först
  });
});

describe('withItemReinserted', () => {
  it('sätter tillbaka titeln på sin ursprungliga plats', () => {
    expect(withItemReinserted([item(1), item(3)], item(2), 1).map(i => i.tmdbId)).toEqual([1, 2, 3]);
  });

  it('ger ingen dubblett om raden redan kommit tillbaka', () => {
    const back = [item(1), item(2)];
    expect(withItemReinserted(back, item(2), 1).map(i => i.tmdbId)).toEqual([1, 2]);
  });

  it('klämmer ett index som ligger utanför den aktuella längden', () => {
    expect(withItemReinserted([item(1)], item(2), 99).map(i => i.tmdbId)).toEqual([1, 2]);
    expect(withItemReinserted([item(1)], item(2), -5).map(i => i.tmdbId)).toEqual([2, 1]);
  });
});
