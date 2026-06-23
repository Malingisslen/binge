// BIN-172 — Swedish municipalities (kommuner), the home-library picker source.
//
// Authoritative SCB list of all 290 municipalities (kommunkod + name), stable since
// the 1974 reform. Source: SCB / Wikipedia "List of municipalities of Sweden".
// This is the option set for the user's `hemkommun` (home-library) setting — which
// library a user's card belongs to drives the "Gratis via biblioteket" layer.
//
// Pure data + lookup helpers. No fetch, no Firebase — testable in isolation, and
// (like genreLabels / providers) it's a slow-moving static catalog, safe to bundle.

export interface Municipality {
  /** 4-digit SCB kommunkod (string to preserve leading zeros). */
  code: string;
  /** Swedish municipality name (no trailing "kommun"). */
  name: string;
}

/** All 290 Swedish municipalities, SCB code → name. */
export const MUNICIPALITIES: readonly Municipality[] = [
  { code: '1440', name: 'Ale' }, { code: '1489', name: 'Alingsås' }, { code: '0764', name: 'Alvesta' },
  { code: '0604', name: 'Aneby' }, { code: '1984', name: 'Arboga' }, { code: '2506', name: 'Arjeplog' },
  { code: '2505', name: 'Arvidsjaur' }, { code: '1784', name: 'Arvika' }, { code: '1882', name: 'Askersund' },
  { code: '2084', name: 'Avesta' }, { code: '1460', name: 'Bengtsfors' }, { code: '2326', name: 'Berg' },
  { code: '2403', name: 'Bjurholm' }, { code: '1260', name: 'Bjuv' }, { code: '2582', name: 'Boden' },
  { code: '1443', name: 'Bollebygd' }, { code: '2183', name: 'Bollnäs' }, { code: '0885', name: 'Borgholm' },
  { code: '2081', name: 'Borlänge' }, { code: '1490', name: 'Borås' }, { code: '0127', name: 'Botkyrka' },
  { code: '0560', name: 'Boxholm' }, { code: '1272', name: 'Bromölla' }, { code: '2305', name: 'Bräcke' },
  { code: '1231', name: 'Burlöv' }, { code: '1278', name: 'Båstad' }, { code: '1438', name: 'Dals-Ed' },
  { code: '0162', name: 'Danderyd' }, { code: '1862', name: 'Degerfors' }, { code: '2425', name: 'Dorotea' },
  { code: '1730', name: 'Eda' }, { code: '0125', name: 'Ekerö' }, { code: '0686', name: 'Eksjö' },
  { code: '0862', name: 'Emmaboda' }, { code: '0381', name: 'Enköping' }, { code: '0484', name: 'Eskilstuna' },
  { code: '1285', name: 'Eslöv' }, { code: '1445', name: 'Essunga' }, { code: '1982', name: 'Fagersta' },
  { code: '1382', name: 'Falkenberg' }, { code: '1499', name: 'Falköping' }, { code: '2080', name: 'Falun' },
  { code: '1782', name: 'Filipstad' }, { code: '0562', name: 'Finspång' }, { code: '0482', name: 'Flen' },
  { code: '1763', name: 'Forshaga' }, { code: '1439', name: 'Färgelanda' }, { code: '2026', name: 'Gagnef' },
  { code: '0662', name: 'Gislaved' }, { code: '0461', name: 'Gnesta' }, { code: '0617', name: 'Gnosjö' },
  { code: '0980', name: 'Gotland' }, { code: '1764', name: 'Grums' }, { code: '1444', name: 'Grästorp' },
  { code: '1447', name: 'Gullspång' }, { code: '2523', name: 'Gällivare' }, { code: '2180', name: 'Gävle' },
  { code: '1480', name: 'Göteborg' }, { code: '1471', name: 'Götene' }, { code: '0643', name: 'Habo' },
  { code: '1783', name: 'Hagfors' }, { code: '1861', name: 'Hallsberg' }, { code: '1961', name: 'Hallstahammar' },
  { code: '1380', name: 'Halmstad' }, { code: '1761', name: 'Hammarö' }, { code: '0136', name: 'Haninge' },
  { code: '2583', name: 'Haparanda' }, { code: '0331', name: 'Heby' }, { code: '2083', name: 'Hedemora' },
  { code: '1283', name: 'Helsingborg' }, { code: '1466', name: 'Herrljunga' }, { code: '1497', name: 'Hjo' },
  { code: '2104', name: 'Hofors' }, { code: '0126', name: 'Huddinge' }, { code: '2184', name: 'Hudiksvall' },
  { code: '0860', name: 'Hultsfred' }, { code: '1315', name: 'Hylte' }, { code: '0305', name: 'Håbo' },
  { code: '1863', name: 'Hällefors' }, { code: '2361', name: 'Härjedalen' }, { code: '2280', name: 'Härnösand' },
  { code: '1401', name: 'Härryda' }, { code: '1293', name: 'Hässleholm' }, { code: '1284', name: 'Höganäs' },
  { code: '0821', name: 'Högsby' }, { code: '1266', name: 'Hörby' }, { code: '1267', name: 'Höör' },
  { code: '2510', name: 'Jokkmokk' }, { code: '0123', name: 'Järfälla' }, { code: '0680', name: 'Jönköping' },
  { code: '2514', name: 'Kalix' }, { code: '0880', name: 'Kalmar' }, { code: '1446', name: 'Karlsborg' },
  { code: '1082', name: 'Karlshamn' }, { code: '1883', name: 'Karlskoga' }, { code: '1080', name: 'Karlskrona' },
  { code: '1780', name: 'Karlstad' }, { code: '0483', name: 'Katrineholm' }, { code: '1715', name: 'Kil' },
  { code: '0513', name: 'Kinda' }, { code: '2584', name: 'Kiruna' }, { code: '1276', name: 'Klippan' },
  { code: '0330', name: 'Knivsta' }, { code: '2282', name: 'Kramfors' }, { code: '1290', name: 'Kristianstad' },
  { code: '1781', name: 'Kristinehamn' }, { code: '2309', name: 'Krokom' }, { code: '1881', name: 'Kumla' },
  { code: '1384', name: 'Kungsbacka' }, { code: '1960', name: 'Kungsör' }, { code: '1482', name: 'Kungälv' },
  { code: '1261', name: 'Kävlinge' }, { code: '1983', name: 'Köping' }, { code: '1381', name: 'Laholm' },
  { code: '1282', name: 'Landskrona' }, { code: '1860', name: 'Laxå' }, { code: '1814', name: 'Lekeberg' },
  { code: '2029', name: 'Leksand' }, { code: '1441', name: 'Lerum' }, { code: '0761', name: 'Lessebo' },
  { code: '0186', name: 'Lidingö' }, { code: '1494', name: 'Lidköping' }, { code: '1462', name: 'Lilla Edet' },
  { code: '1885', name: 'Lindesberg' }, { code: '0580', name: 'Linköping' }, { code: '0781', name: 'Ljungby' },
  { code: '2161', name: 'Ljusdal' }, { code: '1864', name: 'Ljusnarsberg' }, { code: '1262', name: 'Lomma' },
  { code: '2085', name: 'Ludvika' }, { code: '2580', name: 'Luleå' }, { code: '1281', name: 'Lund' },
  { code: '2481', name: 'Lycksele' }, { code: '1484', name: 'Lysekil' }, { code: '1280', name: 'Malmö' },
  { code: '2023', name: 'Malung-Sälen' }, { code: '2418', name: 'Malå' }, { code: '1493', name: 'Mariestad' },
  { code: '1463', name: 'Mark' }, { code: '0767', name: 'Markaryd' }, { code: '1461', name: 'Mellerud' },
  { code: '0586', name: 'Mjölby' }, { code: '2062', name: 'Mora' }, { code: '0583', name: 'Motala' },
  { code: '0642', name: 'Mullsjö' }, { code: '1430', name: 'Munkedal' }, { code: '1762', name: 'Munkfors' },
  { code: '1481', name: 'Mölndal' }, { code: '0861', name: 'Mönsterås' }, { code: '0840', name: 'Mörbylånga' },
  { code: '0182', name: 'Nacka' }, { code: '1884', name: 'Nora' }, { code: '1962', name: 'Norberg' },
  { code: '2132', name: 'Nordanstig' }, { code: '2401', name: 'Nordmaling' }, { code: '0581', name: 'Norrköping' },
  { code: '0188', name: 'Norrtälje' }, { code: '2417', name: 'Norsjö' }, { code: '0881', name: 'Nybro' },
  { code: '0140', name: 'Nykvarn' }, { code: '0480', name: 'Nyköping' }, { code: '0192', name: 'Nynäshamn' },
  { code: '0682', name: 'Nässjö' }, { code: '2101', name: 'Ockelbo' }, { code: '1060', name: 'Olofström' },
  { code: '2034', name: 'Orsa' }, { code: '1421', name: 'Orust' }, { code: '1273', name: 'Osby' },
  { code: '0882', name: 'Oskarshamn' }, { code: '2121', name: 'Ovanåker' }, { code: '0481', name: 'Oxelösund' },
  { code: '2521', name: 'Pajala' }, { code: '1402', name: 'Partille' }, { code: '1275', name: 'Perstorp' },
  { code: '2581', name: 'Piteå' }, { code: '2303', name: 'Ragunda' }, { code: '2409', name: 'Robertsfors' },
  { code: '1081', name: 'Ronneby' }, { code: '2031', name: 'Rättvik' }, { code: '1981', name: 'Sala' },
  { code: '0128', name: 'Salem' }, { code: '2181', name: 'Sandviken' }, { code: '0191', name: 'Sigtuna' },
  { code: '1291', name: 'Simrishamn' }, { code: '1265', name: 'Sjöbo' }, { code: '1495', name: 'Skara' },
  { code: '2482', name: 'Skellefteå' }, { code: '1904', name: 'Skinnskatteberg' }, { code: '1264', name: 'Skurup' },
  { code: '1496', name: 'Skövde' }, { code: '2061', name: 'Smedjebacken' }, { code: '2283', name: 'Sollefteå' },
  { code: '0163', name: 'Sollentuna' }, { code: '0184', name: 'Solna' }, { code: '2422', name: 'Sorsele' },
  { code: '1427', name: 'Sotenäs' }, { code: '1230', name: 'Staffanstorp' }, { code: '1415', name: 'Stenungsund' },
  { code: '0180', name: 'Stockholm' }, { code: '1760', name: 'Storfors' }, { code: '2421', name: 'Storuman' },
  { code: '0486', name: 'Strängnäs' }, { code: '1486', name: 'Strömstad' }, { code: '2313', name: 'Strömsund' },
  { code: '0183', name: 'Sundbyberg' }, { code: '2281', name: 'Sundsvall' }, { code: '1766', name: 'Sunne' },
  { code: '1907', name: 'Surahammar' }, { code: '1214', name: 'Svalöv' }, { code: '1263', name: 'Svedala' },
  { code: '1465', name: 'Svenljunga' }, { code: '1785', name: 'Säffle' }, { code: '2082', name: 'Säter' },
  { code: '0684', name: 'Sävsjö' }, { code: '2182', name: 'Söderhamn' }, { code: '0582', name: 'Söderköping' },
  { code: '0181', name: 'Södertälje' }, { code: '1083', name: 'Sölvesborg' }, { code: '1435', name: 'Tanum' },
  { code: '1472', name: 'Tibro' }, { code: '1498', name: 'Tidaholm' }, { code: '0360', name: 'Tierp' },
  { code: '2262', name: 'Timrå' }, { code: '0763', name: 'Tingsryd' }, { code: '1419', name: 'Tjörn' },
  { code: '1270', name: 'Tomelilla' }, { code: '1737', name: 'Torsby' }, { code: '0834', name: 'Torsås' },
  { code: '1452', name: 'Tranemo' }, { code: '0687', name: 'Tranås' }, { code: '1287', name: 'Trelleborg' },
  { code: '1488', name: 'Trollhättan' }, { code: '0488', name: 'Trosa' }, { code: '0138', name: 'Tyresö' },
  { code: '0160', name: 'Täby' }, { code: '1473', name: 'Töreboda' }, { code: '1485', name: 'Uddevalla' },
  { code: '1491', name: 'Ulricehamn' }, { code: '2480', name: 'Umeå' }, { code: '0114', name: 'Upplands Väsby' },
  { code: '0139', name: 'Upplands-Bro' }, { code: '0380', name: 'Uppsala' }, { code: '0760', name: 'Uppvidinge' },
  { code: '0584', name: 'Vadstena' }, { code: '0665', name: 'Vaggeryd' }, { code: '0563', name: 'Valdemarsvik' },
  { code: '0115', name: 'Vallentuna' }, { code: '2021', name: 'Vansbro' }, { code: '1470', name: 'Vara' },
  { code: '1383', name: 'Varberg' }, { code: '0187', name: 'Vaxholm' }, { code: '1233', name: 'Vellinge' },
  { code: '0685', name: 'Vetlanda' }, { code: '2462', name: 'Vilhelmina' }, { code: '0884', name: 'Vimmerby' },
  { code: '2404', name: 'Vindeln' }, { code: '0428', name: 'Vingåker' }, { code: '1442', name: 'Vårgårda' },
  { code: '1487', name: 'Vänersborg' }, { code: '2460', name: 'Vännäs' }, { code: '0120', name: 'Värmdö' },
  { code: '0683', name: 'Värnamo' }, { code: '0883', name: 'Västervik' }, { code: '1980', name: 'Västerås' },
  { code: '0780', name: 'Växjö' }, { code: '0512', name: 'Ydre' }, { code: '1286', name: 'Ystad' },
  { code: '1492', name: 'Åmål' }, { code: '2260', name: 'Ånge' }, { code: '2321', name: 'Åre' },
  { code: '1765', name: 'Årjäng' }, { code: '2463', name: 'Åsele' }, { code: '1277', name: 'Åstorp' },
  { code: '0561', name: 'Åtvidaberg' }, { code: '0765', name: 'Älmhult' }, { code: '2039', name: 'Älvdalen' },
  { code: '0319', name: 'Älvkarleby' }, { code: '2560', name: 'Älvsbyn' }, { code: '1292', name: 'Ängelholm' },
  { code: '1407', name: 'Öckerö' }, { code: '0509', name: 'Ödeshög' }, { code: '1880', name: 'Örebro' },
  { code: '1257', name: 'Örkelljunga' }, { code: '2284', name: 'Örnsköldsvik' }, { code: '2380', name: 'Östersund' },
  { code: '0117', name: 'Österåker' }, { code: '0382', name: 'Östhammar' }, { code: '1256', name: 'Östra Göinge' },
  { code: '2513', name: 'Överkalix' }, { code: '2518', name: 'Övertorneå' },
];

/** Municipality names, sorted by the Swedish alphabet (å/ä/ö last). For pickers. */
export const MUNICIPALITY_NAMES: readonly string[] = MUNICIPALITIES
  .map((m) => m.name)
  .sort((a, b) => a.localeCompare(b, 'sv'));

const BY_NAME = new Map(MUNICIPALITIES.map((m) => [m.name.toLocaleLowerCase('sv'), m]));

/** Look up a municipality by exact (case-insensitive) name. null if unknown. */
export function findMunicipality(name: string | null | undefined): Municipality | null {
  if (!name) return null;
  return BY_NAME.get(name.trim().toLocaleLowerCase('sv')) ?? null;
}

/** True if the given string is a recognised Swedish municipality name. */
export function isValidMunicipality(name: string | null | undefined): boolean {
  return findMunicipality(name) !== null;
}
