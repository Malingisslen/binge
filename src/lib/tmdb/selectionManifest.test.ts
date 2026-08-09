import { describe, it, expect, afterEach } from 'vitest';
import {
  MANIFEST_VERSION,
  SELECTION_CEILING,
  SELECTION_ABSOLUTE_FLOOR,
  MANIFEST_HARD_TTL_MS,
  type SelectionManifest,
  type SelectionType,
  mergeManifest,
  resolvedIds,
  parseManifest,
  isManifestStale,
  floorFor,
  assertCoverageFloor,
} from './selectionManifest';
import { SEO_TITLE_TARGET_IDS, SEO_PERSON_TARGET_IDS } from './seoCoverage';

const T0 = Date.UTC(2026, 7, 1);
const DAY = 24 * 60 * 60 * 1000;

function manifest(
  type: SelectionType,
  entries: Array<[id: number, lastDerived: number]>,
  derivedAt = T0,
): SelectionManifest {
  return {
    version: MANIFEST_VERSION,
    type,
    derivedAt,
    ids: entries.map(([id, lastDerived]) => ({ id, lastDerived })),
  };
}

describe('mergeManifest — spärrhaken', () => {
  // KÄRNBETEENDET. Före BIN-823 försvann ett id ur urvalet så fort TMDB:s
  // populäritetslista slutade nämna det, och sidan började svara noindex. Det
  // här testet är hela skälet modulen finns.
  it('behåller ett id som försvunnit ur den färska härledningen', () => {
    const prev = manifest('movie', [[1, T0], [2, T0]]);
    const merged = mergeManifest(prev, 'movie', [1], T0 + DAY);

    expect(merged.ids.map(e => e.id)).toEqual([1, 2]);
  });

  it('bumpar lastDerived för id som fanns i båda, och lämnar de andra orörda', () => {
    const prev = manifest('movie', [[1, T0], [2, T0]]);
    const merged = mergeManifest(prev, 'movie', [1], T0 + DAY);

    expect(merged.ids.find(e => e.id === 1)?.lastDerived).toBe(T0 + DAY);
    // 2:s ålder är dess enda skydd mot att evakueras för tidigt — den får inte
    // följa med upp bara för att bygget kördes.
    expect(merged.ids.find(e => e.id === 2)?.lastDerived).toBe(T0);
  });

  it('behåller first-seen-positionen och appendar nya id i härledningsordning', () => {
    const prev = manifest('movie', [[10, T0], [20, T0]]);
    // Färsk härledning nämner dem i omvänd ordning och lägger till två nya.
    const merged = mergeManifest(prev, 'movie', [20, 10, 30, 40], T0 + DAY);

    expect(merged.ids.map(e => e.id)).toEqual([10, 20, 30, 40]);
  });

  it('utan tidigare manifest blir resultatet exakt den färska listan', () => {
    const merged = mergeManifest(null, 'tv', [5, 6, 7], T0);

    expect(merged.ids).toEqual([
      { id: 5, lastDerived: T0 },
      { id: 6, lastDerived: T0 },
      { id: 7, lastDerived: T0 },
    ]);
    expect(merged.derivedAt).toBe(T0);
    expect(merged.type).toBe('tv');
  });

  // En tom härledning betyder "hämtningen misslyckades", inte "urvalet är tomt".
  // Utan den här grenen hade ett TMDB-avbrott tömt manifestet och avindexerat
  // allt — samma skada som buggen, men på en snabbare väg.
  it('lämnar föregående manifest orört när härledningen gav noll id', () => {
    const prev = manifest('movie', [[1, T0], [2, T0]]);
    const merged = mergeManifest(prev, 'movie', [], T0 + DAY);

    expect(merged).toBe(prev);
    // derivedAt får INTE bumpas — annars ser ett bygge som aldrig hämtade
    // något ut som en färsk härledning för staleness-kontrollen.
    expect(merged.derivedAt).toBe(T0);
  });

  it('deduplicerar id som förekommer flera gånger i den färska listan', () => {
    const merged = mergeManifest(null, 'movie', [3, 3, 4, 3], T0);

    expect(merged.ids.map(e => e.id)).toEqual([3, 4]);
  });
});

describe('mergeManifest — evakuering vid taket', () => {
  const ceiling = SELECTION_CEILING.person;

  it('evakuerar äldst lastDerived först', () => {
    // Fyll till taket med gamla poster, lägg sedan till en ny.
    const old = Array.from({ length: ceiling }, (_, i): [number, number] => [i + 1, T0 + i]);
    const prev = manifest('person', old);

    const merged = mergeManifest(prev, 'person', [999_999], T0 + DAY);

    expect(merged.ids).toHaveLength(ceiling);
    // Id 1 hade lägst lastDerived → först ut. Nykomlingen fick plats.
    expect(merged.ids.some(e => e.id === 1)).toBe(false);
    expect(merged.ids.some(e => e.id === 999_999)).toBe(true);
  });

  // RIKTNINGEN ÄR HELA SPÄRRHAKEN, och det här testet pinnade den åt fel håll
  // fram till integrationsgranskningen 2026-08-08. En full refresh bumpar alla
  // närvarande id:n till samma tidpunkt, så "lika ålder" är normalfallet — inte
  // ett udda undantag där vilken deterministisk regel som helst duger.
  it('evakuerar den SENAST tillkomna vid lika ålder, aldrig den sittande', () => {
    const sitting = Array.from({ length: ceiling }, (_, i) => i + 1);
    const prev = manifest('person', sitting.map((id): [number, number] => [id, T0]));
    // Härledningen ser BÅDE de sittande och en nykomling ⇒ alla får samma
    // lastDerived. Det är så en refresh ser ut, och därför är oavgjort regel.
    const merged = mergeManifest(prev, 'person', [...sitting, 999_999], T0 + DAY);

    expect(merged.ids).toHaveLength(ceiling);
    // Nykomlingen får inte tränga ut en sittande sida som Google redan hittat.
    expect(merged.ids.some(e => e.id === 999_999)).toBe(false);
    expect(merged.ids.some(e => e.id === 1)).toBe(true);
  });

  // Motsatsen, som måste fortsätta gälla: ett id som slutat dyka upp i
  // härledningen åldras och ska till slut lämna plats åt ett aktuellt.
  it('låter ett åldrat id lämna plats åt ett färskt när taket tvingar', () => {
    const aged = Array.from({ length: ceiling }, (_, i): [number, number] => [i + 1, T0]);
    const prev = manifest('person', aged);

    const merged = mergeManifest(prev, 'person', [999_999], T0 + DAY);

    expect(merged.ids).toHaveLength(ceiling);
    expect(merged.ids.some(e => e.id === 999_999)).toBe(true);
  });

  // Granskarens replay, som exakt regressionstest: tak 1 000, härledning som
  // alltid ger fler än taket, två veckors refresh. Med den gamla sorteringen
  // överlevde 0 av 1 000 — 100 % personutbyte varje vecka, alltså precis den
  // rotation BIN-823 finns för att stoppa, fast persisterad och tyst.
  it('behåller hela urvalet över två refresher när härledningen överstiger taket', () => {
    const fresh = Array.from({ length: ceiling * 3 }, (_, i) => i + 1);

    const week1 = mergeManifest(null, 'person', fresh, T0);
    const week2 = mergeManifest(week1, 'person', fresh, T0 + DAY);

    const survivors = week1.ids.filter(e => week2.ids.some(k => k.id === e.id));
    expect(survivors).toHaveLength(ceiling);
    // …och vecka 1 ska ha behållit toppen av härledningen, inte svansen.
    expect(week1.ids[0].id).toBe(1);
    expect(week1.ids[ceiling - 1].id).toBe(ceiling);
  });

  // Tredje klausulen i merge-kontraktet. Tidigare version av testet skickade en
  // TOM härledning, vilket tar early-return:en och aldrig ens nådde
  // evakueringsgrenen — ordningen var alltså opinnad medan testet hette som om
  // den var pinnad. Nu tvingas evakuering fram på riktigt.
  it('emitterar överlevarna i first-seen-ordning, inte i evakueringsordning', () => {
    // Fyll till taket i en ordning där ålder och position går isär.
    const prev = manifest(
      'person',
      Array.from({ length: ceiling }, (_, i): [number, number] => [
        i + 1,
        // Första posten är YNGST, resten åldras nedåt: evakueringssorteringen
        // ger alltså en helt annan ordning än first-seen.
        i === 0 ? T0 + 10_000 : T0 + (ceiling - i),
      ]),
    );

    const merged = mergeManifest(prev, 'person', [999_999], T0 + DAY);

    expect(merged.ids).toHaveLength(ceiling);
    // Utdata ska vara stigande id (= first-seen-ordning), med exakt ett hål där
    // den äldsta evakuerades — inte sorterad på ålder.
    const ids = merged.ids.map(e => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids[0]).toBe(1); // yngst men först insatt: behåller sin plats först
  });

  it('rör inte listan så länge den ryms under taket', () => {
    const prev = manifest('movie', [[1, T0], [2, T0]]);
    const merged = mergeManifest(prev, 'movie', [3], T0 + DAY);

    expect(merged.ids).toHaveLength(3);
  });
});

describe('resolvedIds — frön kan aldrig evakueras', () => {
  it('lägger frö-id efter manifestets, utan dubbletter', () => {
    const m = manifest('movie', [[1, T0], [2, T0]]);

    expect(resolvedIds(m, [2, 3])).toEqual([1, 2, 3]);
  });

  // Frönas hela uppgift: de 117 sidor Google har i sitt index ska byggas även
  // om actions/cache evakuerats och manifestet är borta.
  it('ger frö-id:na även utan manifest', () => {
    expect(resolvedIds(null, [7, 8])).toEqual([7, 8]);
  });

  it('ger tom lista när varken manifest eller frön finns', () => {
    expect(resolvedIds(null, [])).toEqual([]);
  });
});

describe('parseManifest', () => {
  it('läser ett giltigt manifest', () => {
    const raw = JSON.stringify(manifest('movie', [[1, T0]]));

    expect(parseManifest(raw, 'movie')?.ids).toEqual([{ id: 1, lastDerived: T0 }]);
  });

  it('ger null för korrupt JSON', () => {
    expect(parseManifest('{ inte json', 'movie')).toBeNull();
  });

  it('ger null vid versionsmismatch', () => {
    const raw = JSON.stringify({ ...manifest('movie', [[1, T0]]), version: MANIFEST_VERSION + 1 });

    expect(parseManifest(raw, 'movie')).toBeNull();
  });

  // Skyddar mot att en felläst fil tyst byter ut en hel mediatyps urval.
  it('ger null när filens typ inte är den förväntade', () => {
    const raw = JSON.stringify(manifest('tv', [[1, T0]]));

    expect(parseManifest(raw, 'movie')).toBeNull();
  });

  it('ger null när en post saknar giltiga fält', () => {
    const raw = JSON.stringify({
      version: MANIFEST_VERSION,
      type: 'movie',
      derivedAt: T0,
      ids: [{ id: 'abc', lastDerived: T0 }],
    });

    expect(parseManifest(raw, 'movie')).toBeNull();
  });
});

describe('isManifestStale', () => {
  it('är färskt precis på gränsen', () => {
    const m = manifest('movie', [], T0);

    expect(isManifestStale(m, T0 + MANIFEST_HARD_TTL_MS)).toBe(false);
  });

  it('är inaktuellt en millisekund senare', () => {
    const m = manifest('movie', [], T0);

    expect(isManifestStale(m, T0 + MANIFEST_HARD_TTL_MS + 1)).toBe(true);
  });
});

describe('säkerhetsnätens relation till taken', () => {
  // ADR 0018 och seoCoverage-kommentaren säger båda att en sänkning av det här
  // talet till taknivån "besegrar spärrhaken tyst" — id:n som roterat ut ur
  // TMDB:s listor skulle då kapas bort INNAN mergen och aldrig kunna behållas.
  // Pinna relationen, inte siffran: taket får höjas utan att testet ändras.
  it('titel-säkerhetsnätet ligger klart över taket, aldrig på det', () => {
    expect(SEO_TITLE_TARGET_IDS).toBeGreaterThanOrEqual(2 * SELECTION_CEILING.movie);
    expect(SEO_TITLE_TARGET_IDS).toBeGreaterThanOrEqual(2 * SELECTION_CEILING.tv);
  });

  // Personsidan är medvetet ANNORLUNDA: talet är inget säkerhetsnät utan
  // spärrhakens andningsutrymme. STRIKT under taket — se beteendetestet nedan
  // för varför likhet gör hela mekaniken till en nolloperation.
  it('person-härledningen lämnar luft under taket', () => {
    expect(SEO_PERSON_TARGET_IDS).toBeLessThan(SELECTION_CEILING.person);
  });

  // INVARIANTEN, prövad som beteende i stället för som olikhet mellan två tal.
  //
  // Den här sanningen kostade två felaktiga rundor: integrationsgranskningen
  // 2026-08-08 föreslog att HÖJA härledningen över taket för att ge personerna
  // en spärrhake. Det gör raden `härledning > tak` nedan: id 1 ramlar ur ändå.
  // Det enda som skyddar en sida är att taket har plats kvar när mergen är klar.
  // Nycklarna är ASCII med flit: vitests `$prop`-substitution matchar bara \w,
  // så `$härledning` renderas som "undefinedärledning" och alla tre raderna får
  // identiska namn. Ett rött fall som inte kan namnge sig självt — eller
  // isoleras med `-t` — besegrar hela poängen med att kontrastera tre storlekar.
  it.each([
    { derivering: SEO_PERSON_TARGET_IDS, overlever: true },  // shippat läge
    { derivering: SELECTION_CEILING.person, overlever: false }, // lika ⇒ ingen spärrhake
    { derivering: 3 * SELECTION_CEILING.person, overlever: false }, // djupare hjälper inte
  ])('härledning $derivering mot person-taket → ur-roterat id kvar: $overlever',
    ({ derivering, overlever }) => {
      const vecka1 = Array.from({ length: derivering }, (_, i) => i + 1);
      const m1 = mergeManifest(null, 'person', vecka1, T0);
      // Vecka 2: id 1 ramlar ur TMDB:s lista, en nykomling tar dess plats.
      const vecka2 = [...vecka1.filter(id => id !== 1), 999_999];
      const m2 = mergeManifest(m1, 'person', vecka2, T0 + DAY);

      expect(m2.ids.some(e => e.id === 1)).toBe(overlever);
    });
});

describe('täckningsgolvet', () => {
  afterEach(() => {
    delete process.env.SELECTION_ALLOW_THIN;
  });

  // DEN FARLIGA VÄGEN, och skälet golvet skrevs om. Ett golv som bara jämför mot
  // föregående manifest kan per konstruktion aldrig fyra: spärrhaken behåller
  // allt, så urvalet krymper aldrig. Katastrofen är den motsatta — manifestet
  // borta (evakuerad actions/cache) OCH härledningen misslyckad, alltså inget
  // att jämföra mot och ~150 frö/fallback-id kvar. Det MÅSTE fälla bygget.
  it('fäller ett tunt urval även när det inte finns något tidigare att jämföra mot', () => {
    expect(floorFor('movie', 0)).toBe(SELECTION_ABSOLUTE_FLOOR.movie);
    expect(() => assertCoverageFloor('movie', 150, 0)).toThrow(/\[selection\] movie/);
  });

  it('släpper igenom en frisk härledning på ett kallt manifest', () => {
    expect(() => assertCoverageFloor('movie', 11_000, 0)).not.toThrow();
  });

  // Komplementet: skulle mergen någon gång få en väg att krympa (sänkt tak,
  // migrering) ska ett stort tapp fällas även om det landar över absolutgolvet.
  it('kräver dessutom 80 % av föregående urval när det är högre', () => {
    expect(floorFor('movie', 10_000)).toBe(8_000);
    expect(() => assertCoverageFloor('movie', 7_999, 10_000)).toThrow(/golvet är 8000/);
    expect(() => assertCoverageFloor('movie', 8_000, 10_000)).not.toThrow();
  });

  it('använder absolutgolvet när 80 % vore lägre', () => {
    // 80 % av 1 000 = 800 < absolutgolvet 2 000 för film.
    expect(floorFor('movie', 1_000)).toBe(SELECTION_ABSOLUTE_FLOOR.movie);
    expect(() => assertCoverageFloor('movie', 1_999, 1_000)).toThrow();
    expect(() => assertCoverageFloor('movie', 2_000, 1_000)).not.toThrow();
  });

  // Mätt 2026-08-08: ett strypt lokalt bygge gav 4 375 film-id mot produktionens
  // ~9 850. Golvet får inte fälla en halverad men fungerande härledning — bara
  // ren fallback (~150 sidor).
  it('släpper igenom en kraftigt strypt men verklig härledning', () => {
    expect(() => assertCoverageFloor('movie', 4_375, 0)).not.toThrow();
  });

  it('fäller ren fallback', () => {
    expect(() => assertCoverageFloor('movie', 150, 0)).toThrow();
  });

  // CI bygger med ci-dummy som TMDB-nyckel: varje hämtning failar och urvalet
  // BLIR tunt, med flit. Den körningen måste säga det uttryckligen.
  it('stängs av helt av SELECTION_ALLOW_THIN', () => {
    process.env.SELECTION_ALLOW_THIN = '1';

    expect(floorFor('movie', 10_000)).toBe(0);
    expect(() => assertCoverageFloor('movie', 10, 10_000)).not.toThrow();
  });

  it('namnger typ, utfall, golv och utvägen — bygget ska gå att förstå ur loggen', () => {
    expect(() => assertCoverageFloor('person', 5, 1_000)).toThrow(/person: urvalet gav 5 id:n/);
    expect(() => assertCoverageFloor('person', 5, 1_000)).toThrow(/golvet är 800/);
    expect(() => assertCoverageFloor('person', 5, 1_000)).toThrow(/BIN-823/);
    expect(() => assertCoverageFloor('person', 5, 1_000)).toThrow(/SELECTION_ALLOW_THIN/);
  });
});
