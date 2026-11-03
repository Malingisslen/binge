import { describe, it, expect } from 'vitest';
import {
  OPEN_RAW_STATUSES, sharingUidsOf, householdUids, resolveSeating, rosterOf, normalizeStatus, isPrivateItem, toWatchItem, buildHouseholdView, displayLabel, parseSeated, parseProviders, type WatchItem,
} from './logic';

const doc = (o: Record<string, unknown>) => ({ tmdbId: 1, mediaType: 'movie', title: 'T', status: 'vill_se', ...o });
const item = (tmdbId: number, o: Partial<WatchItem> = {}): WatchItem => ({
  tmdbId, mediaType: 'movie', title: `T${tmdbId}`, posterPath: null, status: 'vill_se', season: null, episode: null, ...o,
});

describe('isPrivateItem (okänt betyder dolt)', () => {
  it('effectiveVisibility private döljs, även om isPublic säger true', () => {
    expect(isPrivateItem({ effectiveVisibility: 'private', isPublic: true })).toBe(true);
  });
  it('bara public delas; friends döljs eftersom en hushållsmedlem inte är vän', () => {
    expect(isPrivateItem({ effectiveVisibility: 'public' })).toBe(false);
    expect(isPrivateItem({ effectiveVisibility: 'friends' })).toBe(true);
  });
  it('äldre dokument styrs av isPublic', () => {
    expect(isPrivateItem({ isPublic: true })).toBe(false);
    expect(isPrivateItem({ isPublic: false })).toBe(true);
  });
  it('ett effectiveVisibility som är null eller fel typ döljer titeln, även om isPublic är true', () => {
    expect(isPrivateItem({ effectiveVisibility: null, isPublic: true })).toBe(true);
    expect(isPrivateItem({ effectiveVisibility: 1, isPublic: true })).toBe(true);
  });
  it('saknas båda döljs titeln', () => {
    expect(isPrivateItem({})).toBe(true);
  });
  it('ett okänt värde döljs', () => {
    expect(isPrivateItem({ effectiveVisibility: 'allihop' })).toBe(true);
  });
});

describe('normalizeStatus (samma tabell som TV-appen och webben)', () => {
  it('äldre värden normaliseras', () => {
    expect(normalizeStatus('want_to_watch', true, false)).toBe('vill_se');
    expect(normalizeStatus('want_to_watch', false, false)).toBe('mina');
    expect(normalizeStatus('watching', true, false)).toBe('sedd');
    expect(normalizeStatus('följer', false, false)).toBe('mina');
  });
  it('en avbruten-flagga vinner över varje status', () => {
    expect(normalizeStatus('mina', false, true)).toBe('avbruten');
    expect(normalizeStatus('vill_se', true, true)).toBe('avbruten');
  });
});

describe('toWatchItem', () => {
  it('en avbruten serie räknas inte som vill se eller följer', () => {
    const r = toWatchItem(doc({ effectiveVisibility: 'public', mediaType: 'tv', status: 'mina', dropped: true }));
    expect(r?.status).toBe('avbruten');
  });
  it('ett äldre statusvärde blir samma status som i Ikväll', () => {
    expect(toWatchItem(doc({ effectiveVisibility: 'public', status: 'want_to_watch' }))?.status).toBe('vill_se');
  });
  it('släpper aldrig igenom en privat titel', () => {
    expect(toWatchItem(doc({ effectiveVisibility: 'private' }))).toBeNull();
  });
  it('tar bara med fälten TV:n visar, aldrig anteckningar eller betyg', () => {
    const r = toWatchItem(doc({ effectiveVisibility: 'public', notes: 'hemligt', rating: 9, posterPath: '/a.jpg' }));
    expect(r).toEqual({ tmdbId: 1, mediaType: 'movie', title: 'T', posterPath: '/a.jpg', status: 'vill_se', season: null, episode: null });
  });
  it('avvisar en affischsökväg som inte är en TMDB-sökväg', () => {
    expect(toWatchItem(doc({ effectiveVisibility: 'public', posterPath: 'https://evil.example/x' }))?.posterPath).toBeNull();
  });
});

describe('buildHouseholdView', () => {
  it('ni båda vill se visar bara det alla i soffan vill se', () => {
    const lists = new Map([[0, [item(1), item(2)]], [1, [item(2), item(3)]]]);
    const v = buildHouseholdView([0, 1], lists);
    expect(v.shared.map((t) => t.tmdbId)).toEqual([2]);
  });
  it('bara en vill se visas med två i soffan, var och en för sig', () => {
    const lists = new Map([[0, [item(1)]], [1, [item(3)]]]);
    const v = buildHouseholdView([0, 1], lists);
    expect(v.onlyOne.map((o) => [o.member, o.titles.map((t) => t.tmdbId)])).toEqual([[0, [1]], [1, [3]]]);
  });
  it('med fyra i soffan visas bara det alla vill se', () => {
    const lists = new Map([0, 1, 2, 3].map((m) => [m, [item(9), item(10 + m)]] as [number, WatchItem[]]));
    const v = buildHouseholdView([0, 1, 2, 3], lists);
    expect(v.onlyOne).toEqual([]);
    expect(v.shared.map((t) => t.tmdbId)).toEqual([9]);
  });
  it('bara en vill se visas med tre i soffan', () => {
    const lists = new Map([[0, [item(1), item(9)]], [1, [item(3), item(9)]], [2, [item(9)]]]);
    const v = buildHouseholdView([0, 1, 2], lists);
    expect(v.onlyOne.find((o) => o.member === 0)?.titles.map((t) => t.tmdbId)).toEqual([1]);
    expect(v.shared.map((t) => t.tmdbId)).toEqual([9]);
  });
  it('en ensam i soffan ger ingen delad lista', () => {
    expect(buildHouseholdView([0], new Map([[0, [item(1)]]])).shared).toEqual([]);
  });
  it('ikapp kräver att minst två följer serien', () => {
    const s = (id: number, season: number, episode: number) => item(id, { mediaType: 'tv', status: 'mina', season, episode });
    const lists = new Map([[0, [s(5, 2, 5), s(6, 1, 1)]], [1, [s(5, 2, 3)]]]);
    const v = buildHouseholdView([0, 1], lists);
    expect(v.ikapp).toHaveLength(1);
    expect(v.ikapp[0].progress).toEqual([{ member: 0, season: 2, episode: 5 }, { member: 1, season: 2, episode: 3 }]);
  });
  it('en medlem som inte sitter i soffan bidrar aldrig', () => {
    const lists = new Map([[0, [item(1)]], [1, [item(1)]], [2, [item(1)]]]);
    expect(JSON.stringify(buildHouseholdView([0, 1], lists))).not.toContain('"member":2');
  });
});

describe('indata', () => {
  it('displayLabel tar förnamn och klampar', () => {
    expect(displayLabel('  malin gisslén ')).toEqual({ name: 'malin', initial: 'M' });
    expect(displayLabel('x'.repeat(100)).name).toHaveLength(24);
    expect(displayLabel(42)).toEqual({ name: '', initial: '?' });
  });
  it('parseSeated släpper bara små heltal utan dubbletter', () => {
    expect(parseSeated([1, 1, 0, 99, -1, 'a', 2.5])).toEqual([0, 1]);
    expect(parseSeated([5, 6])).toEqual([5]);
    expect(parseSeated('x')).toEqual([]);
  });
  it('parseProviders släpper bara positiva heltal', () => {
    expect(parseProviders([8, -1, 'a', 337])).toEqual([8, 337]);
  });
});

describe('vill se avgörs som i Ikväll', () => {
  const m = (id: number, o: Partial<WatchItem>) => item(id, o);
  it('sedd film, avbruten film och påbörjad serie räknas inte; film vill_se och ej påbörjad serie räknas', () => {
    const mine: WatchItem[] = [
      m(1, { status: 'sedd' }),
      m(2, { status: 'avbruten' }),
      m(3, { mediaType: 'tv', status: 'mina', season: 2, episode: 1 }),
      m(4, { mediaType: 'tv', status: 'mina' }),
      m(5, { status: 'vill_se' }),
      m(6, { mediaType: 'tv', status: 'avbruten' }),
    ];
    const lists = new Map([[0, mine], [1, mine]]);
    const v = buildHouseholdView([0, 1], lists);
    expect(v.shared.map((t) => t.tmdbId).sort()).toEqual([4, 5]);
    expect(v.onlyOne.flatMap((o) => o.titles)).toEqual([]);
  });
  it('en avbruten serie med påbörjade avsnitt ger ingen ikapp-rad', () => {
    const dropped = item(7, { mediaType: 'tv', status: 'avbruten', season: 1, episode: 3 });
    const v = buildHouseholdView([0, 1], new Map([[0, [dropped]], [1, [dropped]]]));
    expect(v.ikapp).toEqual([]);
  });
  it('en ensam i soffan ger varken delad lista eller enskilda listor', () => {
    const v = buildHouseholdView([0], new Map([[0, [item(1)]]]));
    expect(v.shared).toEqual([]);
    expect(v.onlyOne).toEqual([]);
  });
});

describe('sharingUidsOf', () => {
  it('bara medlemmar med en egen hushållsrad delar', () => {
    expect([...sharingUidsOf([{ id: 'a', exists: true }, { id: 'b', exists: false }])]).toEqual(['a']);
  });
});

describe('householdUids', () => {
  it('ägaren först, bara medlemmar som själva delar, utan dubbletter av ägaren', () => {
    expect(householdUids('o', ['a', 'o', 'b', 'c'], new Set(['a', 'c', 'o']))).toEqual(['o', 'a', 'c']);
  });
  it('en delare som inte längre är med i gruppen räknas inte', () => {
    expect(householdUids('o', ['o', 'a'], new Set(['a', 'gammal']))).toEqual(['o', 'a']);
  });
  it('taket är sex', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(householdUids('o', many, new Set(many))).toEqual(['o', 'a', 'b', 'c', 'd', 'e']);
  });
});

describe('resolveSeating', () => {
  const roster = rosterOf(['o', 'a']);
  it('samma kvitto ger de önskade platserna', () => {
    expect(resolveSeating(roster, roster, [0, 1], 2)).toEqual({ seated: [0, 1], seatingReset: false });
  });
  it('ett annat kvitto nollställer till bara ägaren och säger det', () => {
    expect(resolveSeating('annat', roster, [0, 1], 2)).toEqual({ seated: [0], seatingReset: true });
  });
  it('inget kvitto nollställer aldrig', () => {
    expect(resolveSeating(null, roster, [0, 1], 2)).toEqual({ seated: [0, 1], seatingReset: false });
  });
  it('platser utanför listan tas bort', () => {
    expect(resolveSeating(null, roster, [0, 1, 2, 4], 2).seated).toEqual([0, 1]);
  });
  it('kvittot ändras när någon byts ut', () => {
    expect(rosterOf(['o', 'a'])).not.toBe(rosterOf(['o', 'b']));
  });
});

describe('OPEN_RAW_STATUSES håller jämna steg med normalizeStatus', () => {
  // Äldre serier lagrade som sedd/watched blir mina i normaliseringen, men hämtas medvetet inte:
  // att ta med dem drar in varje sedd film under taket per medlem och tränger undan det som önskas.
  const KEPT_OUT = ['sedd', 'watched'];

  it('varje råvärde som kan bli vill se eller följer hämtas, utom de två medvetet bortvalda', () => {
    const raws = ['vill_se', 'mina', 'följer', 'want_to_watch', 'watching', 'sedd', 'watched', 'avbruten', 'dropped'];
    for (const raw of raws) {
      const open = normalizeStatus(raw, true, false) === 'vill_se' || normalizeStatus(raw, false, false) === 'mina';
      if (open && !KEPT_OUT.includes(raw)) expect(OPEN_RAW_STATUSES).toContain(raw);
    }
  });
  it('de två bortvalda hämtas inte', () => {
    for (const raw of KEPT_OUT) expect(OPEN_RAW_STATUSES).not.toContain(raw);
  });
  it('frågan hämtar inget som aldrig kan bli vill se eller följer', () => {
    for (const raw of OPEN_RAW_STATUSES) {
      expect(normalizeStatus(raw, true, false) === 'vill_se' || normalizeStatus(raw, false, false) === 'mina').toBe(true);
    }
  });
});
