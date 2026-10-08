// Some TMDB titles carry punctuation in the title itself (a leading quote mark, an
// ellipsis), and a plain compare puts every one of them before "A". The alphabetical
// position is taken from the first letter or digit instead.
function sortKey(title: string): string {
  return title.replace(/^[^\p{L}\p{N}]+/u, '') || title;
}

export function compareTitles(a: string, b: string): number {
  return sortKey(a).localeCompare(sortKey(b), 'sv') || a.localeCompare(b, 'sv');
}
