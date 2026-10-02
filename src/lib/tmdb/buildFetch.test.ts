import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchForBuild,
  buildSignal,
  BUILD_FETCH_TIMEOUT_MS,
  REFRESH_AFTER_MS,
  buildFetchCount,
  __resetBuildFetchState,
  __setBuildFetchLogger,
  trackBuildCall,
  startBuildWatchdog,
  buildCallStats,
  ABANDONED_REPORT_LIMIT,
} from './buildFetch';
import { readBuildCacheEntry, writeBuildCache } from './buildCache';

vi.mock('./buildCache', () => ({
  readBuildCacheEntry: vi.fn(),
  writeBuildCache: vi.fn(),
}));

const NOW = 1_000_000_000;
const fresh = <T>(data: T) => ({ data, fetchedAt: NOW }); // age 0
const stale = <T>(data: T) => ({ data, fetchedAt: NOW - REFRESH_AFTER_MS - 1 }); // strax bortom tröskeln

describe('buildSignal', () => {
  it('returnerar en AbortSignal', () => {
    const sig = buildSignal();
    expect(sig).toBeInstanceOf(AbortSignal);
    expect(sig.aborted).toBe(false);
  });

  it('exponerar en rimlig timeout-konstant (<= 30s, < Next 60s-tak)', () => {
    expect(BUILD_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(BUILD_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe('fetchForBuild', () => {
  beforeEach(() => {
    vi.mocked(readBuildCacheEntry).mockReset();
    vi.mocked(writeBuildCache).mockReset();
    __resetBuildFetchState();
    delete process.env.TMDB_BUILD_REFRESH_BUDGET;
  });

  afterEach(() => {
    delete process.env.TMDB_BUILD_REFRESH_BUDGET;
  });

  it('färsk cache-post: returnerar cachad data utan fetch, write eller budget-kostnad', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(fresh({ name: 'cached' }));
    const fetcher = vi.fn(async () => ({ name: 'fresh' }));
    const result = await fetchForBuild('tv', fetcher, 1438, NOW);
    expect(result).toEqual({ name: 'cached' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(writeBuildCache).not.toHaveBeenCalled();
    expect(buildFetchCount()).toBe(0);
  });

  it('saknad post: anropar fetchern med signal, skriver resultatet, returnerar det', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(null);
    const fetcher = vi.fn<(id: number, opts?: { signal?: AbortSignal }) => Promise<{ name: string }>>(
      async () => ({ name: 'fresh' }),
    );
    const result = await fetchForBuild('tv', fetcher, 1438, NOW);
    expect(result).toEqual({ name: 'fresh' });
    const [id, opts] = fetcher.mock.calls[0];
    expect(id).toBe(1438);
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
    expect(writeBuildCache).toHaveBeenCalledWith('tv', 1438, { name: 'fresh' }, NOW);
    expect(buildFetchCount()).toBe(1);
  });

  it('stale post under budget: re-hämtar och returnerar färsk data', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(stale({ name: 'old' }));
    const fetcher = vi.fn(async () => ({ name: 'new' }));
    const result = await fetchForBuild('tv', fetcher, 1, NOW);
    expect(result).toEqual({ name: 'new' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(writeBuildCache).toHaveBeenCalledWith('tv', 1, { name: 'new' }, NOW);
    expect(buildFetchCount()).toBe(1); // stale-refresh räknas mot budgeten
  });

  it('stale post ÖVER budget: serverar stale utan att hämta', async () => {
    process.env.TMDB_BUILD_REFRESH_BUDGET = '1';
    vi.mocked(readBuildCacheEntry).mockReturnValue(stale({ name: 'old' }));
    const fetcher = vi.fn(async () => ({ name: 'new' }));
    // Första stale-hämtningen förbrukar budgeten (1).
    const first = await fetchForBuild('tv', fetcher, 1, NOW);
    expect(first).toEqual({ name: 'new' });
    expect(buildFetchCount()).toBe(1);
    fetcher.mockClear();
    // Budget förbrukad → nästa stale-post serveras utan fetch.
    const second = await fetchForBuild('tv', fetcher, 2, NOW);
    expect(second).toEqual({ name: 'old' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('saknad post ÖVER budget: kastar (skjuts upp till ett senare bygge)', async () => {
    process.env.TMDB_BUILD_REFRESH_BUDGET = '1';
    // Första anropet: saknad → hämtar (förbrukar budget 1).
    vi.mocked(readBuildCacheEntry).mockReturnValueOnce(null);
    const fetcher = vi.fn(async () => ({ name: 'new' }));
    await fetchForBuild('tv', fetcher, 1, NOW);
    expect(buildFetchCount()).toBe(1);
    // Andra anropet: saknad + över budget → kastar.
    vi.mocked(readBuildCacheEntry).mockReturnValueOnce(null);
    await expect(fetchForBuild('tv', fetcher, 2, NOW)).rejects.toThrow(/budget reached/);
  });

  it('hämtning misslyckas men stale finns: serverar stale (kastar inte)', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(stale({ name: 'old' }));
    const fetcher = vi.fn(async () => { throw new Error('aborted'); });
    const result = await fetchForBuild('tv', fetcher, 1, NOW);
    expect(result).toEqual({ name: 'old' });
    expect(writeBuildCache).not.toHaveBeenCalled();
  });

  it('hämtning misslyckas och posten saknas: propagerar felet, skriver inte', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(null);
    const fetcher = vi.fn(async () => { throw new Error('aborted'); });
    await expect(fetchForBuild('tv', fetcher, 1, NOW)).rejects.toThrow('aborted');
    expect(writeBuildCache).not.toHaveBeenCalled();
  });

  it('__resetBuildFetchState nollställer budget-räknaren', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(null);
    await fetchForBuild('tv', vi.fn(async () => ({})), 1, NOW);
    expect(buildFetchCount()).toBe(1);
    __resetBuildFetchState();
    expect(buildFetchCount()).toBe(0);
  });
});

// BIN-815: bygget hängde 4 av 6 körningar 2026-08-07 och sa aldrig vad det
// väntade på. Vakthunden finns för att göra nästa hängning läsbar.
describe('vakthund (BIN-815)', () => {
  let lines: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(readBuildCacheEntry).mockReset();
    vi.mocked(writeBuildCache).mockReset();
    __resetBuildFetchState();
    delete process.env.TMDB_BUILD_REFRESH_BUDGET;
    lines = [];
    __setBuildFetchLogger((m) => lines.push(m));
  });

  afterEach(() => {
    __resetBuildFetchState();
    vi.useRealTimers();
    delete process.env.TMDB_BUILD_REFRESH_BUDGET;
  });

  /** Startar en hämtning som aldrig löser sig — hängningen vi vill kunna se. */
  function startHangingFetch(kind: string, id: number): void {
    vi.mocked(readBuildCacheEntry).mockReturnValue(null);
    // .catch: over an exhausted budget fetchForBuild throws synchronously-ish,
    // and an unhandled rejection would be blamed on whichever test runs next.
    void fetchForBuild(kind, () => new Promise(() => {}), id, NOW).catch(() => {});
  }

  it('skriver en puls medan en hämtning är i flykt', async () => {
    startHangingFetch('tv', 1399);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lines.some((l) => /^\[build-fetch\] pid=\d+ inflight=1 /.test(l))).toBe(true);
  });

  // Den här raden är hela poängen: hänger bygget medan pulsen säger inflight=0
  // ligger felet inte i TMDB-lagret. Testet måste därför pinna att pulsen
  // UPPREPAS när allt är tyst — en vakthund som skriver en rad och sedan dör är
  // omöjlig att skilja från dagens tystnad, och det var precis vad den första
  // versionen tillät (granskning 2026-08-07).
  it('fortsätter skriva pulsen när ingenting är i flykt', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(null);
    await fetchForBuild('tv', vi.fn(async () => ({})), 1, NOW);
    lines.length = 0;
    await vi.advanceTimersByTimeAsync(30_000 * 3);
    const pulses = lines.filter((l) => l.startsWith('[build-fetch] pid='));
    expect(pulses).toHaveLength(3);
    for (const p of pulses) {
      expect(p).toContain('inflight=0');
      expect(p).toContain('fetched=1/');
    }
  });

  // En cache-träff gör noll nätverksanrop — och det är läget en kod-deploy körs
  // i, alltså läget alla fyra hängningarna 2026-08-07 inträffade i. Startade
  // pulsen först vid en cache-miss vore den tyst just då.
  it('startar pulsen även när allt serveras ur cachen', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(fresh({ name: 'cached' }));
    await fetchForBuild('tv', vi.fn(), 1, NOW);
    await vi.advanceTimersByTimeAsync(30_000);
    const pulse = lines.find((l) => l.startsWith('[build-fetch] pid='));
    expect(pulse).toBeDefined();
    expect(pulse).toContain('inflight=0');
    expect(pulse).toContain('fetched=0/');
  });

  it('namnger en hämtning som levt längre än sitt eget abort-tak', async () => {
    startHangingFetch('movie', 27205);
    await vi.advanceTimersByTimeAsync(BUILD_FETCH_TIMEOUT_MS + 10_000 + 30_000);
    // Åldern är halva informationen — utan den säger raden inte om hämtningen
    // precis passerat taket eller stått still i en timme. Två pulser räcker för
    // att pinna att den VÄXER, vilket en hårdkodad konstant inte klarar.
    const stuck = lines.filter((l) => l.includes('STUCK'));
    expect(stuck).toHaveLength(2);
    expect(stuck[0]).toMatch(/STUCK 30s\s+movie\/27205/);
    expect(stuck[1]).toMatch(/STUCK 60s\s+movie\/27205/);
  });

  it('namnger BARA den hämtning som passerat tröskeln, inte alla i flykt', async () => {
    // A startar vid t=0 och startar vakthunden. B startar vid t=20s. Första
    // pulsen faller vid t=30s: A är 30s gammal (>= 20s+10s → fast), B är 10s
    // (→ ännu inte). En mutant som tappar ålderskontrollen namnger båda.
    startHangingFetch('tv', 1);
    await vi.advanceTimersByTimeAsync(20_000);
    startHangingFetch('tv', 2);
    await vi.advanceTimersByTimeAsync(10_000);
    const stuck = lines.filter((l) => l.includes('STUCK'));
    expect(stuck).toHaveLength(1);
    expect(stuck[0]).toContain('tv/1');
  });

  it('timern är unref:ad — den får aldrig hålla processen vid liv', async () => {
    const unref = vi.fn();
    const spy = vi.spyOn(globalThis, 'setInterval').mockReturnValue({
      unref,
    } as unknown as ReturnType<typeof setInterval>);
    try {
      startHangingFetch('tv', 1);
      expect(spy).toHaveBeenCalledOnce();
      expect(unref).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });

  it('startar exakt en timer även över många hämtningar', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    try {
      startHangingFetch('tv', 1);
      startHangingFetch('tv', 2);
      startHangingFetch('movie', 3);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });

  // Vakthunden tystnar INTE längre när budgeten tar slut. Den regeln togs bort
  // efter granskningen 2026-08-07: budgeten är slut på svansen av ett
  // 25k-sidorsbygge, alltså precis där en hängning är billigast att missa, och
  // en tyst vakthund går inte att skilja från en som aldrig startade.
  it('fortsätter skriva även när budgeten är förbrukad', async () => {
    process.env.TMDB_BUILD_REFRESH_BUDGET = '1';
    vi.mocked(readBuildCacheEntry).mockReturnValue(null);
    await fetchForBuild('tv', vi.fn(async () => ({})), 1, NOW);
    lines.length = 0;
    await vi.advanceTimersByTimeAsync(30_000 * 3);
    expect(lines.filter((l) => l.startsWith('[build-fetch] pid='))).toHaveLength(3);
  });

  it('pulsen redovisar budgetläget och äldsta i flykt', async () => {
    process.env.TMDB_BUILD_REFRESH_BUDGET = '7';
    startHangingFetch('tv', 1);
    await vi.advanceTimersByTimeAsync(60_000);
    const pulse = lines.filter((l) => l.startsWith('[build-fetch] pid=')).pop();
    expect(pulse).toContain('fetched=1/7');
    expect(pulse).toContain('oldest=60s');
  });

  it('en hämtning som blir klar tas bort ur registret', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(null);
    await fetchForBuild('tv', vi.fn(async () => ({})), 1, NOW);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lines[0]).toContain('inflight=0');
  });

  it('en hämtning som kastar tas också bort ur registret', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(null);
    await expect(
      fetchForBuild('tv', vi.fn(async () => { throw new Error('aborted'); }), 1, NOW),
    ).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lines[0]).toContain('inflight=0');
  });

  it('trackBuildCall registrerar sitt anrop och namnger det när det fastnar', async () => {
    void trackBuildCall('params:popular-movies/p3', () => new Promise(() => {})).catch(() => {});
    await vi.advanceTimersByTimeAsync(60_000);
    const pulse = lines.find((l) => l.startsWith('[build-fetch] pid='));
    expect(pulse).toContain('inflight=1');
    const stuck = lines.find((l) => l.includes('STUCK'));
    expect(stuck).toContain('params:popular-movies/p3');
  });

  // "Rapportera de äldsta" är hela skälet till taket. Utan det här testet kan
  // sorteringen vändas och taket börjar dölja just det som stått still längst.
  it('rapporterar de ÄLDSTA fem, inte fem godtyckliga', async () => {
    // Etiketterna går BAKLÄNGES mot åldern (g är äldst, a yngst). En sortering
    // på fel nyckel — alfabetiskt i stället för på tid — ger då ett annat svar.
    // I produktionen heter posterna p1, p10, p100…, där alfabetisk ordning inte
    // har något med ålder att göra alls.
    for (const name of ['g', 'f', 'e', 'd', 'c', 'b', 'a']) {
      void trackBuildCall(`call-${name}`, () => new Promise(() => {})).catch(() => {});
      await vi.advanceTimersByTimeAsync(1_000);
    }
    // Vänta tills ALLA sju passerat tröskeln, annars mäter testet bara att den
    // äldsta hann först — vilket vore sant även med omvänd sortering.
    await vi.advanceTimersByTimeAsync(30_000);
    lines.length = 0;
    await vi.advanceTimersByTimeAsync(30_000);
    const named = lines.filter((l) => l.includes('STUCK')).map((l) => l.split('  ').pop());
    expect(named).toEqual(['call-g', 'call-f', 'call-e', 'call-d', 'call-c']);
    expect(lines.some((l) => /och 2 till$/.test(l))).toBe(true);
  });

  // Utan egen tröskel skriver ett FRISKT bygge STUCK varje puls för
  // person-pipelinen, och en rad som alltid syns slutar betyda något.
  it('en aggregat-post rapporteras inte som STUCK vid den vanliga tröskeln', async () => {
    void trackBuildCall('params:person-ids', () => new Promise(() => {}), {
      aggregate: true,
    }).catch(() => {});
    await vi.advanceTimersByTimeAsync(90_000);
    expect(lines.some((l) => l.includes('STUCK'))).toBe(false);
    // …men en riktig hängning syns fortfarande.
    await vi.advanceTimersByTimeAsync(180_000);
    expect(lines.some((l) => l.includes('STUCK') && l.includes('params:person-ids'))).toBe(true);
  });

  it('ett enskilt anrop rapporteras fortfarande vid den vanliga tröskeln', async () => {
    void trackBuildCall('params:popular-movies/p1', () => new Promise(() => {})).catch(() => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lines.some((l) => l.includes('STUCK'))).toBe(true);
  });

  // BIN-1420: körning 34104584836 hade `params:popular-movies/p281` STUCK i 9 217 s
  // trots sin 20 s-abort, och hela filmhärledningen väntade på den sidan tills
  // fastaket bröt den efter 150 min. Ett enskilt anrop som överlevt sin abort
  // överges nu, så resten av listan kan bli klar.
  it('ett enskilt anrop som aldrig avgörs överges efter tröskeln', async () => {
    let settled: string | null = null;
    trackBuildCall('params:popular-movies/p281', () => new Promise(() => {}))
      .then(() => { settled = 'resolved'; }, (e: Error) => { settled = e.message; });
    await vi.advanceTimersByTimeAsync(BUILD_FETCH_TIMEOUT_MS + 9_000);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toContain('params:popular-movies/p281');
    // Raden börjar med GitHubs varningsprefix, så den syns i körningens sammanfattning.
    expect(lines.some((l) => l.startsWith('::warning::') && l.includes('ABANDONED') && l.includes('params:popular-movies/p281'))).toBe(true);
  });

  // Vakthunden ska fortsätta säga att anropet lever. Att överge det är inte att det är borta.
  it('ett övergivet anrop står kvar som STUCK tills det självt avgörs', async () => {
    let finish: () => void = () => {};
    void trackBuildCall('params:top-movies/p9', () => new Promise<void>((r) => { finish = r; })).catch(() => {});
    // Pulsen vid 30 s skrivs före övergivandet, så den räknas inte: mät pulsen EFTER.
    await vi.advanceTimersByTimeAsync(30_000);
    lines.length = 0;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lines.some((l) => l.includes('STUCK 60s') && l.includes('params:top-movies/p9'))).toBe(true);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    lines.length = 0;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lines[0]).toContain('inflight=0');
  });

  // BIN-1423: om många anrop överges på en gång ska loggen inte få en rad per anrop.
  it('ABANDONED-raderna har ett tak och en rad som säger var resten finns', async () => {
    // The cap's size is pinned on its own; the fixture below is built from it.
    expect(ABANDONED_REPORT_LIMIT).toBe(10);
    const total = ABANDONED_REPORT_LIMIT + 5;
    for (let i = 0; i < total; i++) {
      void trackBuildCall(`params:popular-movies/p${i}`, () => new Promise(() => {}), { group: 'movie' }).catch(() => {});
    }
    await vi.advanceTimersByTimeAsync(31_000);
    expect(lines.filter((l) => l.includes('ABANDONED'))).toHaveLength(ABANDONED_REPORT_LIMIT);
    const rest = lines.filter((l) => l.includes('fler övergivna anrop skrivs inte ut'));
    expect(rest).toHaveLength(1);
    expect(rest[0]).toContain('se [selection]-raderna');
    // Every abandoned call is still counted, and every label kept, past the cap.
    const stats = buildCallStats('movie');
    expect(stats.abandoned).toBe(total);
    expect(stats.abandonedLabels).toHaveLength(total);
  });

  it('räknar startade och övergivna per typ, och aldrig ett aggregat', async () => {
    void trackBuildCall('params:popular-tv/p1', () => new Promise(() => {}), { group: 'tv' }).catch(() => {});
    await trackBuildCall('params:popular-tv/p2', async () => 1, { group: 'tv' });
    void trackBuildCall('params:person-ids', () => new Promise(() => {}), { aggregate: true, group: 'person' }).catch(() => {});
    await vi.advanceTimersByTimeAsync(31_000);
    expect(buildCallStats('tv')).toEqual({ started: 2, abandoned: 1, abandonedLabels: ['params:popular-tv/p1'] });
    expect(buildCallStats('person')).toEqual({ started: 0, abandoned: 0, abandonedLabels: [] });
    expect(buildCallStats('movie')).toEqual({ started: 0, abandoned: 0, abandonedLabels: [] });
  });

  it('ett anrop som kastar direkt lämnar inget kvar i registret', async () => {
    await expect(trackBuildCall('params:popular-tv/p3', () => { throw new Error('direkt'); })).rejects.toThrow('direkt');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lines[0]).toContain('inflight=0');
  });

  it('ett aggregat överges aldrig — det har sitt eget tak i withAggregateTimeout', async () => {
    let settled = false;
    trackBuildCall('params:person-ids', () => new Promise(() => {}), { aggregate: true })
      .then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(settled).toBe(false);
    expect(lines.some((l) => l.includes('ABANDONED'))).toBe(false);
  });

  it('ett anrop som blir klart före tröskeln påverkas inte av den', async () => {
    const p = trackBuildCall('params:popular-tv/p2', () => new Promise<number>((r) => setTimeout(() => r(42), 25_000)));
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(p).resolves.toBe(42);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lines.some((l) => l.includes('ABANDONED'))).toBe(false);
  });

  it('trackBuildCall avregistrerar både vid klart och vid fel', async () => {
    await trackBuildCall('a', async () => 1);
    await expect(trackBuildCall('b', async () => { throw new Error('nej'); })).rejects.toThrow('nej');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lines[0]).toContain('inflight=0');
  });

  it('trackBuildCall kostar ingen refresh-budget', async () => {
    await trackBuildCall('a', async () => 1);
    expect(buildFetchCount()).toBe(0);
  });

  it('trackBuildCall returnerar anropets värde orört', async () => {
    await expect(trackBuildCall('a', async () => ({ results: [{ id: 7 }] }))).resolves.toEqual({
      results: [{ id: 7 }],
    });
  });

  // En byggtidsfas kan hänga innan ett enda anrop hunnit registrera sig.
  it('startBuildWatchdog startar pulsen utan något anrop alls', async () => {
    startBuildWatchdog();
    await vi.advanceTimersByTimeAsync(30_000);
    const pulse = lines.find((l) => l.startsWith('[build-fetch] pid='));
    expect(pulse).toBeDefined();
    expect(pulse).toContain('inflight=0');
  });

  it('__resetBuildFetchState återställer loggaren till standard', async () => {
    __resetBuildFetchState();
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      startBuildWatchdog();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(err).toHaveBeenCalled();
      expect(String(err.mock.calls[0][0])).toContain('[build-fetch] pid=');
    } finally {
      err.mockRestore();
    }
  });
});
