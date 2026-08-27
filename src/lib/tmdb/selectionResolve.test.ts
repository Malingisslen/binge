import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MANIFEST_VERSION,
  MANIFEST_HARD_TTL_MS,
  type SelectionManifest,
  resolveSelection,
  readSelectionManifest,
  writeSelectionManifest,
} from './selectionManifest';
import { RESCUE_DERIVE_TIMEOUT_MS, REFRESH_DERIVE_TIMEOUT_MS } from './buildFetch';

/**
 * resolveSelection är hela vinsten i BIN-823: den avgör OM de ~8 200 dyra
 * listanropen ska köras. Blir regimbeslutet fel görs antingen anropen ändå
 * (ingen besparing, hängningsrisken kvar) eller aldrig (urvalet förstenas och
 * nya titlar får aldrig en sida). Ingen av dem syns i någon annan testfil.
 */

let dir: string;
let stderr: ReturnType<typeof vi.spyOn>;
const NOW = Date.UTC(2026, 7, 8);

function seedManifest(type: SelectionManifest['type'], ids: number[], derivedAt = NOW): void {
  writeSelectionManifest({
    version: MANIFEST_VERSION,
    type,
    derivedAt,
    ids: ids.map(id => ({ id, lastDerived: derivedAt })),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'selection-resolve-test-'));
  process.env.TMDB_CACHE_DIR = dir;
  delete process.env.TMDB_SELECTION_REFRESH;
  // Regim- och fastakstesterna handlar om VILKEN väg koden tar, inte om hur
  // stort urvalet blir, och kör därför med fixturer på en handfull id. Utan den
  // här flaggan fäller täckningsgolvet dem allihop — vilket är exakt vad golvet
  // ska göra mot ett riktigt bygge. Golv-testerna längst ned tar bort flaggan.
  process.env.SELECTION_ALLOW_THIN = '1';
  // De här testerna kör medvetet räddnings- och felvägar, som skriver
  // `::warning::`-rader. Deploy-workflowen kör `npm test`, så utan spy blir varje grön
  // körning taggad med sju falska GitHub Actions-annoteringar.
  stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  stderr.mockRestore();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TMDB_CACHE_DIR;
  delete process.env.TMDB_SELECTION_REFRESH;
  delete process.env.SELECTION_ALLOW_THIN;
  vi.useRealTimers();
});

describe('resolveSelection — regimen', () => {
  // DEN CENTRALA BESPARINGEN. Går den här sönder gör varje kod-deploy 8 200
  // TMDB-anrop igen, och BIN-815:s hängning är tillbaka.
  it('kör INTE härledningen på en kod-deploy med färskt manifest', async () => {
    seedManifest('movie', [1, 2, 3]);
    const derive = vi.fn(async () => [9]);

    const ids = await resolveSelection({
      type: 'movie',
      seedIds: [],
      fallbackIds: [],
      derive,
      now: NOW,
    });

    expect(derive).not.toHaveBeenCalled();
    expect(ids).toEqual([1, 2, 3]);
  });

  it('rör inte heller manifestet när det bara läses', async () => {
    seedManifest('movie', [1, 2, 3]);

    await resolveSelection({ type: 'movie', seedIds: [], fallbackIds: [], derive: async () => [9], now: NOW });

    expect(readSelectionManifest('movie')?.derivedAt).toBe(NOW);
    expect(readSelectionManifest('movie')?.ids.map(e => e.id)).toEqual([1, 2, 3]);
  });

  it('härleder och unionerar i veckobygget', async () => {
    seedManifest('movie', [1, 2], NOW - 1000);
    process.env.TMDB_SELECTION_REFRESH = '1';
    const derive = vi.fn(async () => [2, 3]);

    const ids = await resolveSelection({
      type: 'movie',
      seedIds: [],
      fallbackIds: [],
      derive,
      now: NOW,
    });

    expect(derive).toHaveBeenCalledTimes(1);
    // 1 saknas i den färska härledningen men behålls — spärrhaken.
    expect(ids).toEqual([1, 2, 3]);
    expect(readSelectionManifest('movie')?.ids.map(e => e.id)).toEqual([1, 2, 3]);
  });

  it('härleder när manifestet saknas helt', async () => {
    const derive = vi.fn(async () => [4, 5]);

    const ids = await resolveSelection({
      type: 'tv',
      seedIds: [],
      fallbackIds: [],
      derive,
      now: NOW,
    });

    expect(derive).toHaveBeenCalledTimes(1);
    expect(ids).toEqual([4, 5]);
    expect(existsSync(join(dir, 'selection-tv.json'))).toBe(true);
  });

  it('härleder när manifestet är korrupt', async () => {
    writeFileSync(join(dir, 'selection-tv.json'), '{ trasig');
    const derive = vi.fn(async () => [4]);

    await resolveSelection({ type: 'tv', seedIds: [], fallbackIds: [], derive, now: NOW });

    expect(derive).toHaveBeenCalledTimes(1);
  });

  // Ett manifest äldre än 30 dagar betyder att veckobygget varit trasigt i en
  // månad. Att fortsätta bygga på det i evighet vore att byta en tyst
  // avindexering mot en tyst förstening.
  it('härleder om på en kod-deploy när manifestet är för gammalt', async () => {
    seedManifest('movie', [1], NOW - MANIFEST_HARD_TTL_MS - 1);
    const derive = vi.fn(async () => [1, 2]);

    await resolveSelection({ type: 'movie', seedIds: [], fallbackIds: [], derive, now: NOW });

    expect(derive).toHaveBeenCalledTimes(1);
  });

  it('varnar synligt i byggloggen när det gamla manifestet räddas', async () => {
    seedManifest('movie', [1], NOW - MANIFEST_HARD_TTL_MS - 1);

    await resolveSelection({
      type: 'movie',
      seedIds: [],
      fallbackIds: [],
      derive: async () => [1, 2],
      now: NOW,
    });

    const written = stderr.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(written).toContain('::warning::');
    expect(written).toContain('äldre än 30 dagar');
  });
});

describe('resolveSelection — fastaket', () => {
  // BIN-815 igen: per-anrops-aborten räckte inte, `params:person-ids` satt i
  // 2 672 sekunder. Utan fasnivå-tak vore räddningsvägen samma hängning.
  it('ger upp härledningen efter räddningstaket och behåller befintligt urval', async () => {
    vi.useFakeTimers();
    seedManifest('person', [1, 2, 3, 4, 5], NOW - MANIFEST_HARD_TTL_MS - 1);
    const derive = vi.fn(() => new Promise<number[]>(() => {})); // återvänder aldrig

    const promise = resolveSelection({
      type: 'person',
      seedIds: [],
      fallbackIds: [],
      derive,
      now: NOW,
    });
    await vi.advanceTimersByTimeAsync(RESCUE_DERIVE_TIMEOUT_MS + 1);

    // Golvet: 5 kvar av 5 tidigare ⇒ passerar. Bygget fortsätter på det gamla
    // urvalet i stället för att hänga till byggstegets tidsgräns.
    await expect(promise).resolves.toEqual([1, 2, 3, 4, 5]);

    // Och taket måste SÄGA att det slog till. Utan den här raden var
    // timeout-varningen bara negativt pinnad (kast-testet påstår att den INTE
    // syns där), så hela varningsblocket gick att radera med sviten grön — och
    // ett tyst uppgivet bygge är exakt vad BIN-815 handlade om.
    const written = stderr.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(written).toContain('::warning::');
    expect(written).toContain('nådde sitt tak');
  });

  it('använder det LÅNGA taket i veckobygget — annars fälls den körning som är hela poängen', async () => {
    vi.useFakeTimers();
    seedManifest('movie', [1], NOW - 1000);
    process.env.TMDB_SELECTION_REFRESH = '1';
    let resolveDerive: (ids: number[]) => void = () => {};
    const derive = vi.fn(() => new Promise<number[]>(res => { resolveDerive = res; }));

    const promise = resolveSelection({
      type: 'movie',
      seedIds: [],
      fallbackIds: [],
      derive,
      now: NOW,
    });

    // Långt förbi räddningstaket, långt före refreshtaket: får inte ge upp.
    await vi.advanceTimersByTimeAsync(RESCUE_DERIVE_TIMEOUT_MS * 2);
    resolveDerive([1, 7]);

    await expect(promise).resolves.toEqual([1, 7]);
    expect(REFRESH_DERIVE_TIMEOUT_MS).toBeGreaterThan(RESCUE_DERIVE_TIMEOUT_MS);
  });

  // deploy.yml:s `timeout-minutes` på byggsteget är en ternär: `schedule/full_refresh ? 175 : 45`. Båda
  // grenarna är egna gränser, så båda taken behöver sin egen pinne. Testat
  // 2026-08-08: 150 → 200 min överlevde 374/374, alltså helt opinnat — och det
  // gäller just veckobygget, den körning hela regimen finns för.
  it('refreshtaket ryms inom veckobyggets 175-minutersgräns i deploy.yml', () => {
    expect(REFRESH_DERIVE_TIMEOUT_MS).toBeLessThan(175 * 60_000);
  });

  // Räddningstaket är bara en räddning om det hinner LÖPA UT. deploy.yml ger
  // kod-deployer `timeout-minutes: 45` på byggsteget; ett räddningstak över det
  // gör att GitHub dödar jobbet först, och den mjuka reträtten (bygg vidare på
  // det gamla urvalet) blir i stället ett rött bygge utan förklaring. Testat
  // 2026-08-08: 15 → 60 min överlevde 289/289, alltså helt opinnat.
  it('räddningstaket lämnar tid att bygga färdigt inom byggstegets 45 minuter', () => {
    // Pinna MARGINALEN, inte bara olikheten. Ett `< 45 min` är sant även vid
    // 44 min, och då återstår en minut för att rendrera ~33 000 sidor — alltså
    // exakt det GitHub-dödade jobb taket finns för att undvika. Testgranskningen
    // 2026-08-08 visade att 44 min överlevde 50/50 grönt med den gamla formen.
    //
    // 25 minuter är ett ANTAGANDE om rendreringen på en varm cache (kod-deployens
    // normalfall), inte en mätning. Faller det, mät och byt talet här — men låt
    // det aldrig bli en ren olikhet igen.
    const RENDER_BUDGET_MS = 25 * 60_000;
    expect(45 * 60_000 - RESCUE_DERIVE_TIMEOUT_MS).toBeGreaterThanOrEqual(RENDER_BUDGET_MS);
  });

  // HELA skyddet vilar på den här egenskapen: SELECTION_ALLOW_THIN stänger av
  // BÅDE täckningsgolvet och sitemapens kast, så den workflow som faktiskt
  // publicerar binge.nu får aldrig sätta den. Fram till nu stod det påståendet
  // i flera prosatexter och kontrollerades
  // ingenstans. Läser filen i stället för att lita på att någon läst den.
  it('deploy.yml sätter ALDRIG SELECTION_ALLOW_THIN', () => {
    const deployYml = readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');

    expect(deployYml).not.toContain('SELECTION_ALLOW_THIN');
    // Kontrollen är bara värd något om filen verkligen lästes.
    expect(deployYml).toContain('TMDB_SELECTION_REFRESH');
    // Och de två marginaltesterna ovan har 45 och 175 hårdkodade. Sänks
    // `timeout-minutes` i deploy.yml blir de tyst inaktuella — de skulle pinna
    // en marginal mot ett tak som inte längre gäller. Filen är redan läst här,
    // så det kostar en rad att koppla ihop dem.
    expect(deployYml).toContain('&& 175 || 45');
  });
});

describe('resolveSelection — de tre grenar rond 2 införde', () => {
  // Utan `tooThin` i mustDerive kunde EN misslyckad kall härledning skriva ett
  // tunt manifest, och varje efterföljande kod-deploy hade sett det som
  // "färskt", hoppat över härledningen och dött på golvet — rött i upp till 30
  // dagar tills staleness-taket löste ut.
  it('härleder om när det befintliga manifestet redan ligger under golvet', async () => {
    delete process.env.SELECTION_ALLOW_THIN;
    // Bygge 1: kall cache, härledningen ger nästan inget ⇒ golvet fäller, men
    // det tunna manifestet har redan skrivits.
    await expect(
      resolveSelection({ type: 'movie', seedIds: [], fallbackIds: [], derive: async () => [1, 2], now: NOW }),
    ).rejects.toThrow();
    expect(readSelectionManifest('movie')?.ids).toHaveLength(2);

    // Bygge 2: kod-deploy, ingen refresh-flagga. Manifestet ÄR färskt — utan
    // tooThin hade `derive` inte körts och bygget dött på golvet igen.
    const derive = vi.fn(async () => Array.from({ length: 6_000 }, (_, i) => i + 1));
    const ids = await resolveSelection({
      type: 'movie', seedIds: [], fallbackIds: [], derive, now: NOW + 1000,
    });

    expect(derive).toHaveBeenCalledTimes(1);
    expect(ids).toHaveLength(6_000);
  });

  // En härledning som KASTAR måste behandlas som en som tar för lång tid.
  // Läts felet passera vidare fångades det av routens fallback-catch → tio
  // id:n → grönt bygge → deploy. Golvet nåddes aldrig.
  it('behandlar en kastande härledning som ett tak-utfall, inte som ett fel att kasta vidare', async () => {
    seedManifest('movie', [1, 2, 3], NOW - MANIFEST_HARD_TTL_MS - 1);
    const derive = vi.fn(async () => { throw new Error('boom'); });

    const ids = await resolveSelection({
      type: 'movie', seedIds: [], fallbackIds: [], derive, now: NOW,
    });

    expect(derive).toHaveBeenCalledTimes(1);
    expect(ids).toEqual([1, 2, 3]); // befintligt urval behållet
  });

  it('skriver en synlig varning när härledningen kastar', async () => {
    // FÄRSKT manifest + refresh-flaggan, inte ett för gammalt manifest: den
    // vägen skriver sin EGEN ::warning::-rad först, och eftersom testet läser
    // alla stderr-anrop ihop blev `toContain('::warning::')` uppfyllt av
    // grannen. Testgranskningen 2026-08-08 visade att prefixet gick att stryka
    // ur den här grenen med 18/18 grönt. Nu är grannen borta.
    seedManifest('movie', [1, 2, 3], NOW);
    process.env.TMDB_SELECTION_REFRESH = '1';

    await resolveSelection({
      type: 'movie', seedIds: [], fallbackIds: [],
      derive: async () => { throw new Error('boom'); }, now: NOW,
    });

    // Samma spy som beforeEach installerade — en andra spy ovanpå den gör
    // mockRestore() tvetydig.
    const written = stderr.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(written).toContain('::warning::');
    expect(written).toContain('kastade');
    // Ett kast är inte en timeout. Skrivs båda raderna pekas nästa
    // hängningsutredning mot ett tak som aldrig löpte ut.
    expect(written).not.toContain('nådde sitt tak');
  });

  // previousCount räknas SEED-INKLUDERAT, och det avgör om `tooThin` fyrar.
  //
  // Den föregående versionen av det här testet påstod sig pinna samma sak via
  // 80 %-regeln men var icke-diskriminerande (testgranskningen 2026-08-08:
  // `previous.ids.length` i stället för `resolvedIds(...).length` överlevde
  // 26/26). Skälet: absolutgolvet dominerar alltid `max()`, och 80 %-termen kan
  // dessutom aldrig fyra härifrån — spärrhaken garanterar att urvalet inte
  // krymper. `tooThin` är den enda levande konsumenten av talet, så den ska
  // testas direkt, precis vid gränsen.
  it('räknar fröna i previousCount — 1 950 + 100 frön är INTE ett tunt manifest', async () => {
    delete process.env.SELECTION_ALLOW_THIN;
    const seeds = Array.from({ length: 100 }, (_, i) => 900_000 + i);
    // Färskt manifest, ingen refresh-flagga ⇒ det ENDA som kan tvinga fram en
    // härledning är tooThin. 1 950 + 100 = 2 050 ≥ absolutgolvet 2 000.
    seedManifest('movie', Array.from({ length: 1_950 }, (_, i) => i + 1), NOW);
    const derive = vi.fn(async () => [1, 2]);

    await resolveSelection({ type: 'movie', seedIds: seeds, fallbackIds: [], derive, now: NOW });

    // Räknades fröna inte med vore föregående urval 1 950 < 2 000, manifestet
    // skulle bedömas tunt och varje kod-deploy betala en räddningshärledning.
    expect(derive).not.toHaveBeenCalled();
  });
});

describe('resolveSelection — golvet och fröna', () => {
  // Golvet är hela poängen med det här blocket — kör utan undantagsflaggan.
  beforeEach(() => {
    delete process.env.SELECTION_ALLOW_THIN;
  });

  // Den tysta katastrofen planen finns för att stänga: härledningen ger nästan
  // inget, bygget blir GRÖNT och firebase deploy ersätter ~31 000 sidor med en
  // handfull. Golvet gör det till ett rött bygge i stället.
  it('kastar när manifestet saknas OCH härledningen ger nästan inget', async () => {
    // Den verkliga katastrofvägen: actions/cache evakuerad + TMDB nere. Utan
    // golvet blir bygget grönt och firebase deploy ersätter ~31 000 sidor med
    // frö + fallback. Spärrhaken kan inte rädda det — det finns inget att
    // ratcheta mot.
    await expect(
      resolveSelection({
        type: 'movie',
        seedIds: [1, 2, 3],
        fallbackIds: [603],
        derive: async () => [],
        now: NOW,
      }),
    ).rejects.toThrow(/\[selection\] movie/);
  });

  it('släpper igenom en frisk härledning på kallt manifest', async () => {
    const fresh = Array.from({ length: 11_000 }, (_, i) => i + 1);

    await expect(
      resolveSelection({
        type: 'movie',
        seedIds: [],
        fallbackIds: [],
        derive: async () => fresh,
        now: NOW,
      }),
    ).resolves.toHaveLength(11_000);
  });

  it('unionerar in fröna även när manifestet saknas', async () => {
    // Handlar om unionen, inte om storleken — därav undantagsflaggan.
    process.env.SELECTION_ALLOW_THIN = '1';

    const ids = await resolveSelection({
      type: 'person',
      seedIds: [42, 43],
      fallbackIds: [],
      derive: async () => [7],
      now: NOW,
    });

    expect(ids).toEqual([7, 42, 43]);
  });

  // Nyckellöst bygge: dummynyckel ⇒ varje hämtning failar ⇒ härledningen ger
  // noll. Next kräver ändå ≥1 param, så fallbacken måste finnas — och den
  // körningen måste ha sagt att den vet om att urvalet blir tunt.
  it('faller tillbaka på fallback-id när ingenting kunde härledas och tunt är tillåtet', async () => {
    process.env.SELECTION_ALLOW_THIN = '1';

    const ids = await resolveSelection({
      type: 'movie',
      seedIds: [],
      fallbackIds: [603, 604],
      derive: async () => [],
      now: NOW,
    });

    expect(ids).toEqual([603, 604]);
  });
});
