import { buildPriceChangeFeed } from '@/lib/advisor/priceChangeNudges';

// Static export: rendered once at build into out/prisandringar.json. Läses av den
// schemalagda funktionen priceChangeNotify, som inte kan importera klientkatalogen
// och som inte deployas när prisagenten lägger till en rad (BIN-1444).
export const dynamic = 'force-static';

export function GET(): Response {
  return Response.json({ version: 1, rows: buildPriceChangeFeed() });
}
