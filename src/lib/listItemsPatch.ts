import type { UserListItem } from '@/types';

/**
 * Rena omskrivningar av en listas `items`, använda av listsidans optimistiska
 * cache-uppdatering OCH av dess återställning när skrivningen nekas.
 *
 * VARFÖR DE FINNS SOM EGNA FUNKTIONER. Återställningen får inte vara "lägg tillbaka
 * hela arrayen som den såg ut när jag började". Varken `handleAdd` eller `handleRemove`
 * inväntas av sin anropare, så två skrivningar kan ligga i luften samtidigt: läggs A
 * till och sedan B, och A:s skrivning nekas medan B:s går igenom, raderar en
 * ögonblicksbild från före båda bort B — en titel Firestore faktiskt har. Varje
 * återställning är därför den INVERSA operationen på det cache-värde som gäller när den
 * körs, inte en gammal kopia, så den kommuterar med en samtidig syskonskrivning.
 */

export function withItemAdded(items: UserListItem[], item: UserListItem): UserListItem[] {
  return [...items, item];
}

export function withItemRemoved(items: UserListItem[], tmdbId: number): UserListItem[] {
  return items.filter(i => i.tmdbId !== tmdbId);
}

/**
 * Inversen av en borttagning: sätt tillbaka titeln på sin ursprungliga plats.
 *
 * Idempotent med flit — en återställning som kommer efter att en omhämtning redan hunnit
 * lägga tillbaka raden får inte ge en dubblett. Indexet klämts mot den AKTUELLA längden,
 * eftersom en samtidig skrivning kan ha ändrat den sedan borttagningen.
 */
export function withItemReinserted(
  items: UserListItem[],
  item: UserListItem,
  index: number,
): UserListItem[] {
  if (items.some(i => i.tmdbId === item.tmdbId)) return items;
  const next = [...items];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}
