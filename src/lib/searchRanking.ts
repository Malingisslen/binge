// The dropdown shows only eight of TMDB's twenty first-page hits, in TMDB's order.
// For a short, unfinished word ("dun") TMDB often leads with obscure titles that
// merely contain the word and have no poster, pushing the title the person is
// typing towards (Dune) out of the eight. Re-ranking the page we already have
// costs no extra request: titles whose name starts with the typed text first,
// then titles with a poster, and TMDB's order within each group.

interface RankableTitle {
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path?: string | null;
}

function startsWithQuery(item: RankableTitle, q: string): boolean {
  return [item.title, item.name, item.original_title, item.original_name]
    .some(n => typeof n === 'string' && n.toLocaleLowerCase('sv').startsWith(q));
}

export function rankSearchResults<T extends RankableTitle>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLocaleLowerCase('sv');
  const score = (item: T) => (q && startsWithQuery(item, q) ? 0 : 2) + (item.poster_path ? 0 : 1);
  return items
    .map((item, index) => ({ item, index, s: score(item) }))
    .sort((a, b) => a.s - b.s || a.index - b.index)
    .map(x => x.item);
}
