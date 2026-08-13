import { describe, it, expect } from 'vitest';
import {
  ORPHAN_AUTH_MIN_AGE_MS,
  ORPHAN_AUTH_MAX_PER_RUN,
  ORPHAN_AUTH_MAX_FRACTION,
  ORPHAN_AUTH_MIN_CEILING,
  exceedsOrphanAuthCeiling,
  withinOrphanCeiling,
  isOrphanCandidate,
  isReapableOrphanAge,
  creationTimeToMillis,
  absentUidsFromLookup,
  orphanedReservations,
} from './orphans';

// BIN-816 (ADR 0019 c5b) + BIN-875 (ADR 0020) — the predicates that decide what
// the aborted-deletion sweeps destroy.
//
// Both sweeps delete something irreversible: a person's auth identity, and a
// global handle someone else can then claim. So what is pinned here is not the
// happy path but every way of answering "I could not check" — because the whole
// class of bug this repo keeps meeting is a zero that reads as healthy.

const NOW = 1_800_000_000_000;

describe('isReapableOrphanAge', () => {
  it('reapar ett konto som är äldre än fönstret', () => {
    expect(isReapableOrphanAge(NOW - ORPHAN_AUTH_MIN_AGE_MS - 1, NOW)).toBe(true);
  });

  it('lämnar ett konto som är precis på gränsen', () => {
    // Strikt större än, inte >=: gränsfallet ska falla åt det ofarliga hållet.
    expect(isReapableOrphanAge(NOW - ORPHAN_AUTH_MIN_AGE_MS, NOW)).toBe(false);
  });

  it('lämnar ett färskt konto — en registrering vars profil-write bara failade', () => {
    // Det verkliga skyddsfallet: createUserWithEmailAndPassword lyckas, profil-
    // writen tappar nätet. Kontot står utan users/{uid} i sekunder till minuter.
    expect(isReapableOrphanAge(NOW - 60_000, NOW)).toBe(false);
  });

  it('ett oläsbart creationTime reapar ALDRIG', () => {
    // NaN-fallet. En `>=`-jämförelse mot NaN är false ändå, men den negerade
    // formen i koden är vad som gör det avsiktligt i stället för tur — och det
    // här är den enda sopningen vars falska positiv raderar ett levande konto.
    expect(isReapableOrphanAge(null, NOW)).toBe(false);
    expect(isReapableOrphanAge(Number.NaN, NOW)).toBe(false);
  });

  it('fönstret ligger inom artikel 12(3):s månad, med marginal för en missad körning', () => {
    const ONE_MONTH = 30 * 24 * 60 * 60 * 1000;
    expect(ORPHAN_AUTH_MIN_AGE_MS).toBeLessThan(ONE_MONTH);
    // Och tillräckligt långt från noll för att en transient write-miss (sekunder)
    // aldrig ska kunna nå det.
    expect(ORPHAN_AUTH_MIN_AGE_MS).toBeGreaterThan(24 * 60 * 60 * 1000);
  });
});

describe('creationTimeToMillis', () => {
  it('parsar Admin-SDK:ns ISO-sträng', () => {
    expect(creationTimeToMillis('Wed, 01 Jan 2025 00:00:00 GMT')).toBe(Date.parse('Wed, 01 Jan 2025 00:00:00 GMT'));
  });

  it('ger null för allt som inte går att läsa', () => {
    expect(creationTimeToMillis(undefined)).toBeNull();
    expect(creationTimeToMillis('')).toBeNull();
    expect(creationTimeToMillis('inte ett datum')).toBeNull();
    expect(creationTimeToMillis(12345)).toBeNull();
  });
});

describe('absentUidsFromLookup', () => {
  it('läser FRÅNVARO ur notFound — aldrig ur att uid saknas i users', () => {
    expect(absentUidsFromLookup({
      users: [{ uid: 'live' }],
      notFound: [{ uid: 'gone' }],
    })).toEqual(['gone']);
  });

  it('ett AVSTÄNGT konto räknas INTE som frånvarande', () => {
    // Skillnaden mot revokedUidsFromLookup, och hela skälet till att den här
    // finns. Ett avstängt konto existerar och äger fortfarande sitt handtag —
    // att frigöra det vore att lämna en avstängd persons identitet till nästa
    // som vill ha den.
    expect(absentUidsFromLookup({
      users: [{ uid: 'suspended', disabled: true } as { uid: string }],
      notFound: [],
    })).toEqual([]);
  });

  it('hoppar över notFound-poster som inte är uid-uppslag', () => {
    // SDK:n typar notFound som en union över e-post/telefon/provider. Vi frågar
    // bara på uid, så allt annat är oväntat och gissas inte på.
    expect(absentUidsFromLookup({
      users: [],
      notFound: [{ email: 'a@b.c' }, { uid: '' }, { uid: 'gone' }],
    })).toEqual(['gone']);
  });

  it('ett tomt svar ger inga frånvarande — inte "alla saknas"', () => {
    expect(absentUidsFromLookup({ users: [], notFound: [] })).toEqual([]);
  });
});

describe('orphanedReservations', () => {
  const RES = [
    { name: 'alice', uid: 'a' },
    { name: 'bob', uid: 'b' },
    { name: 'cleo', uid: 'c' },
  ];

  it('frigör bara när BÅDA kontrollerna säger frånvarande', () => {
    const out = orphanedReservations(RES, new Set(['a', 'b']), new Set(['a', 'c']));
    expect(out.map(r => r.name)).toEqual(['alice']);
  });

  it('en reservation vars konto lever men vars profil är borta lämnas kvar', () => {
    // Det halvraderade läget. Användarens EGET omförsök är det som ska frigöra
    // handtaget så länge kontot finns; först när auth-sopningen tagit kontot
    // tar den här över — i SAMMA körning, eftersom index.ts kör auth-sopningen
    // först just av det skälet.
    expect(orphanedReservations(RES, new Set(['b']), new Set())).toEqual([]);
  });

  it('en reservation vars konto är borta men vars profil finns lämnas kvar', () => {
    // Ska inte kunna hända, men om det gör det är det inte ett föräldralöst
    // handtag — det är något annat som är fel, och att radera vore att gissa.
    expect(orphanedReservations(RES, new Set(), new Set(['c']))).toEqual([]);
  });

  it('tomma mängder frigör ingenting — "kunde inte kolla" är inte "borta"', () => {
    // Golvet mot den här kodbasens återkommande bugg: en misslyckad batch bidrar
    // med noll uid:n, och noll måste betyda "radera ingenting" hela vägen ned.
    expect(orphanedReservations(RES, new Set(), new Set())).toEqual([]);
  });
});


describe('exceedsOrphanAuthCeiling', () => {
  // Taket svarar på en annan fråga än resten av filen: inte "tänk om en kontroll
  // failade" utan "tänk om en kontroll lyckades och hade fel". Då håller varje
  // fail-safe-resonemang hela vägen ned och sopningen raderar varje konto äldre
  // än en vecka, en gång, oåterkalleligt. Det som prövas här är gränserna, inte
  // konstanternas storlek — ett `>` som blir `>=` ska falla på ett test.
  const BIG = 10_000;

  it('släpper igenom precis på det absoluta taket', () => {
    expect(exceedsOrphanAuthCeiling(ORPHAN_AUTH_MAX_PER_RUN, BIG)).toBe(false);
  });

  it('stoppar precis över det absoluta taket', () => {
    expect(exceedsOrphanAuthCeiling(ORPHAN_AUTH_MAX_PER_RUN + 1, BIG)).toBe(true);
  });

  it('stoppar på ANDELEN när underlaget är stort nog att andelen betyder något', () => {
    // Med hela användarbasen under 50 kan det absoluta taket aldrig lösa ut, och
    // en trasig fråga skulle radera alla. 30 av 100 är över en fjärdedel.
    expect(exceedsOrphanAuthCeiling(30, 100)).toBe(true);
    expect(exceedsOrphanAuthCeiling(20, 100)).toBe(false);
  });

  it('LÅSER SIG INTE på ett litet underlag — en enda föräldralös får städas', () => {
    // Utan golvet spärrade en bar andel EN föräldralös vid tre konton
    // (1 > 0,75), och eftersom kandidatmängden är monoton och nämnaren bara
    // växer med nya registreringar var den spärren permanent. Två avbrutna
    // raderingar i ett sexkontosprojekt kilade fast sopningen för gott —
    // exakt det utfall den finns för att förhindra (säkerhetsgranskningen).
    expect(exceedsOrphanAuthCeiling(1, 3)).toBe(false);
    expect(exceedsOrphanAuthCeiling(2, 6)).toBe(false);
    expect(exceedsOrphanAuthCeiling(ORPHAN_AUTH_MIN_CEILING, 3)).toBe(false);
  });

  it('men golvet är ett golv, inte ett fribrev', () => {
    // Över golvet på ett litet underlag är det fortfarande en trasig fråga.
    expect(exceedsOrphanAuthCeiling(ORPHAN_AUTH_MIN_CEILING + 1, 6)).toBe(true);
    // Bokstavliga tal på båda sidor, oberoende av konstanten: utan det här
    // kunde golvet höjas till 29 utan att något test föll, och en körning där
    // ALLA 20 kontrollerade konton läses som föräldralösa hade gått igenom —
    // precis det "kontrollen lyckades och hade fel" som konstanten finns för
    // (testgranskningen 2026-08-13). Inte `toBe(5)`, som straffar all justering.
    expect(exceedsOrphanAuthCeiling(8, 8)).toBe(true);
  });

  it('en skanning som inte tittade på något löser INTE ut andelsgränsen', () => {
    // "0 av 0" är ingen nämnare. Att stoppa där vore en annan bugg i den här
    // buggens kläder — och sopningen har ändå ingenting att radera.
    //
    // Ärlighet om vad testet väger: sedan golvet kom är `checkedAccounts <= 0`
    // överflödigt (0 > max(5, −0,25) är falskt ändå), så att ta bort raden
    // lämnar sviten grön. Den står kvar som avsikt, och det här testet som
    // dokumentation av den — inte som ett skydd (testgranskningen 2026-08-13).
    expect(exceedsOrphanAuthCeiling(0, 0)).toBe(false);
    expect(exceedsOrphanAuthCeiling(0, -1)).toBe(false);
  });

  it('konstanterna ligger i rimliga intervall', () => {
    expect(ORPHAN_AUTH_MAX_PER_RUN).toBeGreaterThan(10);
    expect(ORPHAN_AUTH_MAX_PER_RUN).toBeLessThan(1000);
    expect(ORPHAN_AUTH_MAX_FRACTION).toBeGreaterThan(0);
    expect(ORPHAN_AUTH_MAX_FRACTION).toBeLessThan(1);
    expect(ORPHAN_AUTH_MIN_CEILING).toBeGreaterThan(0);
    expect(ORPHAN_AUTH_MIN_CEILING).toBeLessThan(ORPHAN_AUTH_MAX_PER_RUN);
  });
});


describe('isOrphanCandidate', () => {
  const OLD = { metadata: { creationTime: new Date(NOW - ORPHAN_AUTH_MIN_AGE_MS - 1).toUTCString() } };

  it('nominerar ett gammalt, aktivt konto', () => {
    expect(isOrphanCandidate(OLD, NOW)).toBe(true);
  });

  it('hoppar över ett AVSTÄNGT konto hur gammalt det än är', () => {
    // Symmetrin med absentUidsFromLookup. Den dagen ett modereringsflöde också
    // tar bort profil-dokumentet hade en ovaktad sopning hävt avstängningen och
    // frigjort e-postadressen en vecka senare.
    expect(isOrphanCandidate({ ...OLD, disabled: true }, NOW)).toBe(false);
  });

  it('hoppar över ett färskt konto', () => {
    expect(isOrphanCandidate({ metadata: { creationTime: new Date(NOW - 60_000).toUTCString() } }, NOW)).toBe(false);
  });

  it('hoppar över ett konto utan läsbar skapandetid', () => {
    expect(isOrphanCandidate({}, NOW)).toBe(false);
    expect(isOrphanCandidate({ metadata: { creationTime: 'inte ett datum' } }, NOW)).toBe(false);
  });
});


describe('withinOrphanCeiling', () => {
  // Vad produktionen faktiskt anropar. Beslutet fanns redan under harnesset;
  // KOPPLINGEN gjorde det inte — att ta bort endera `if`-satsen i index.ts
  // lämnade sviten grön genom tre granskningsrundor.
  it('släpper igenom hela mängden när den ryms', () => {
    expect(withinOrphanCeiling(['a', 'b'], 100)).toEqual({ allowed: ['a', 'b'], refused: false });
  });

  it('lämnar en TOM mängd när taket överskrids — inte den beskurna', () => {
    // Beskärning vore värre än vägran: en halv körning ser ut som en lyckad.
    expect(withinOrphanCeiling(['a', 'b', 'c', 'd', 'e', 'f'], 6))
      .toEqual({ allowed: [], refused: true });
  });

  it('kopierar mängden i stället för att lämna vidare anroparens array', () => {
    const input = ['a'];
    const { allowed } = withinOrphanCeiling(input, 100);
    allowed.push('b');
    expect(input).toEqual(['a']);
  });
});
