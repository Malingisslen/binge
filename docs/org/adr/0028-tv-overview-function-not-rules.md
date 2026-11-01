# 0028. TV:n får färdiga rader från en funktion, inte öppnade regler

- **Date:** 2026-11-01
- **Status:** Escalated-to-human, answered by Malin
- **Trigger:** BIN-1470, Google TV-appen visar Ikväll med tjänster, Tillsammans som live-tavla och hushållet
- **Stakeholders (panel):** #4 Säkerhet, #6 Dataskydd, #27 Databas, #13 Data/Integrationer, #21 Dokumentation, #25 Release. Alla: proceed-with-conditions.

## Context
TV:n är en egen inloggning (`tv_<enhet>`) som reglerna nekar som standard. Ikväll, Tillsammans och hushållet behöver ägarens tjänster, ägarens pågående session och medlemmarnas listor.

## Conflict
Dataskydd (#6) och Säkerhet (#4): att gå med i ett hushåll är inte ett giltigt samtycke till att visa titlar och framsteg på en delad skärm, medlemmarna ska välja in sig. Malins regel från 2026-10-31 (ADR 0027): att gå med är samtycket, bara Privat döljs.

## Decision
1. Funktionen `tvOverview` ger TV:n färdiga rader. Inga regler öppnas för TV:n. Skälet är att en regel gäller varje väg och är svår att ta tillbaka, medan funktionen kan visa exakt det som ska visas och kan stängas av.
2. Hushållsvyn följer Malins regel (2026-11-01, "gå med räcker"), men ligger bakom `appConfig/tvHousehold` (`enabled: true`) och är avstängd tills Juridik (#5) har godkänt och samtyckestexten är ändrad och publicerad.
3. Bara titlar markerade publika delas med hushållet; `friends` delas inte eftersom reglerna släpper in vänner och en hushållsmedlem inte är vän.

## Consequences
- Funktionen är en väg till ägarens data utanför `isTvOf`: den upprepar `isTvOf`:s villkor i koden och kräver en daterad efterföljarpost i `.claude/accepted-deviations.md` som Malin beslutar.
- Nytt index på `sessions` (`hostUid`, `createdAt`). En sessionsfråga som kastar medan indexet byggs ger bara ingen Tillsammans-flik.
- Soffvalet (vem som sitter) sparas aldrig; servern jämför ett kvitto (`roster`) och nollställer vid ändrat hushåll.

## Decided by
Human owner (Malin)
