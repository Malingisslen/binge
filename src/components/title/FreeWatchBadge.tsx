import { getProvider } from '@/lib/tmdb/providers';

// BIN-90 — "Gratis just nu". TMDB delar SE-providers i free (AVOD/public service,
// t.ex. SVT Play) och ads (gratis med reklam). Binge parsade dem redan men
// mergade in dem bland prenumerations-logorna utan att säga att det är gratis.
// Det här lyfter fram billigaste tittningen (0 kr) på titel-sidan.

type ProviderEntry = { provider_id: number; provider_name: string };

// Kanoniska, dedupade namn (så "X" och "X Amazon Channel" inte dubbleras).
function providerNames(list: ProviderEntry[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of list) {
    const name = getProvider(p.provider_id)?.name ?? p.provider_name;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out.join(', ');
}

export default function FreeWatchBadge({ free, ads }: { free: ProviderEntry[]; ads: ProviderEntry[] }) {
  if (free.length === 0 && ads.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px] mt-[8px]">
      {free.length > 0 && (
        <span className="inline-flex items-center gap-[6px]">
          <span className="text-[10px] uppercase font-bold tracking-[0.4px] rounded-sm border border-season-done text-season-done px-[6px] py-[1px]">
            Gratis
          </span>
          <span className="text-xs text-ink-2">{providerNames(free)}</span>
        </span>
      )}
      {ads.length > 0 && (
        <span className="inline-flex items-center gap-[6px]">
          <span className="text-[10px] uppercase font-bold tracking-[0.4px] rounded-sm border border-season-done text-season-done px-[6px] py-[1px]">
            Gratis med reklam
          </span>
          <span className="text-xs text-ink-2">{providerNames(ads)}</span>
        </span>
      )}
    </div>
  );
}
