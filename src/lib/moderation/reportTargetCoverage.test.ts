// src/lib/moderation/reportTargetCoverage.test.ts
//
// BIN-1211. Servern tog emot fyra sorters anmälan medan appen kunde skapa två av dem, och
// ingenting sa till. En måltyp utan ingång ser färdig ut från admin-hållet, vilket är
// värre än att den saknas.
//
// Vad testet binder: varje värde i serverns `REPORT_TARGET_TYPES` har ANTINGEN ett
// monteringsställe i appen som skickar just den måltypen, ELLER en daterad post som säger
// att ytan medvetet saknas. En ny måltyp på serversidan fäller alltså bygget tills någon
// svarat på frågan.
//
// Källorna läses som text med flit. Att importera unionen från `src/lib/firebase/reports.ts`
// hade prövat en HANDSKRIVEN kopia av serverns lista mot sig själv; det är serverns lista
// som avgör vad som kan skapas.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.cwd();
const SERVER_LOGIC = 'functions/src/submitReport/logic.ts';
const DEVIATIONS = '.claude/rules/accepted-deviations.md';

/** Måltyper som medvetet saknar yta. Varje post pekar på sitt daterade beslut. */
const DEFERRED: Record<string, string> = {
  // Malins beslut 2026-09-17: profilen först, listor väntar. Se posten `## BIN-1211` i
  // accepted-deviations.md — den är PARKERAD, inte avgjord emot.
  list: 'BIN-1211',
};

function serverTargetTypes(): string[] {
  const src = readFileSync(join(REPO, SERVER_LOGIC), 'utf8');
  const m = /REPORT_TARGET_TYPES\s*=\s*\[([^\]]*)\]/.exec(src);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

/** Varje `targetType="..."`-literal som skickas till en komponent någonstans under src/. */
function mountedTargetTypes(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
        const src = readFileSync(full, 'utf8');
        for (const m of src.matchAll(/targetType=(?:"([^"]+)"|\{'([^']+)'\})/g)) {
          found.push(m[1] ?? m[2]);
        }
      }
    }
  };
  walk(join(REPO, 'src'));
  return [...new Set(found)];
}

describe('anmälningskedjans måltyper har antingen en yta eller ett beslut (BIN-1211)', () => {
  const types = serverTargetTypes();
  const mounted = mountedTargetTypes();

  // Golv FÖRE varje jämförelse. En regex som slutat matcha ger tomma mängder, och då blir
  // varje påstående nedan sant utan att något prövats — samma tysta spärrhake som en
  // tömd parameterlista.
  it('golv: båda uppsättningarna gick att härleda ur källan', () => {
    expect(types.length).toBeGreaterThanOrEqual(4);
    expect(mounted.length).toBeGreaterThanOrEqual(2);
  });

  it('varje måltyp servern tar emot har en yta eller står som medvetet parkerad', () => {
    const unanswered = types.filter(t => !mounted.includes(t) && !(t in DEFERRED));
    expect(unanswered).toEqual([]);
  });

  it('varje parkerad måltyp pekar på en post som finns i avvikelseloggen', () => {
    const doc = readFileSync(join(REPO, DEVIATIONS), 'utf8');
    for (const [type, ticket] of Object.entries(DEFERRED)) {
      expect(types, `${type} står som parkerad men servern tar inte emot den`).toContain(type);
      expect(doc).toContain(`## ${ticket}:`);
    }
  });

  it('en parkerad måltyp som fått en yta står inte kvar som parkerad', () => {
    const stale = Object.keys(DEFERRED).filter(t => mounted.includes(t));
    expect(stale).toEqual([]);
  });
});
