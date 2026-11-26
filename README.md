# Praha 8 v přehledech

Veřejná data MČ Praha 8 přehledně na jednom místě. Projekt zpřístupňuje usnesení, hlasování, rozpočet, organizace, Registr smluv a další veřejné informace s dohledatelným zdrojem.

## Produkční základ 3.0.0

Web je statická aplikace. Výsledné JSON soubory v `data/` představují poslední funkční stav webu a budou verzované v GitHubu. Zdrojová pracovní data a závislosti (`node_modules`, velké dumpy, ZIPy apod.) do repozitáře nepatří.

### Lokální spuštění

```bash
npm install
python3 -m http.server 8000
```

Potom otevřete `http://localhost:8000`.

## Aktualizace dat

### Denní profil

```bash
npm run sync:daily
```

Produkční denní workflow aktualizuje inkrementálně usnesení, hlasování, informace podle zákona č. 106/1999 Sb., úřední desku, novinky a Registr smluv. Při neúspěšném běhu se poslední uložená data nepřepisují. Výpadek Registru smluv může být označen jako částečná aktualizace.

### Týdenní profil

```bash
npm run sync:weekly
```

Aktualizuje zastupitelstvo/orgány Prahy 8, funkce HMP, Parlament ČR, organizace a firmy Prahy 8 a firmy HMP.

### Ruční zdroje

Volby:

```bash
npm run sync:elections
```

Rozpočet se mění ručně po schválení nového ročníku. Kontrola aktuálního lokálního datasetu:

```bash
npm run sync:budget
```

Sčítání 2021 je statický dataset a automaticky se neobnovuje.

## Bezpečnost aktualizací

Produkční automatizace bude publikovat pouze úspěšně vytvořená data. Selhání jednoho zdroje nesmí smazat ani nahradit poslední funkční dataset prázdným souborem.

## Plán nasazení

1. Produkční základ 3.0.0
2. Inkrementální Registr smluv a Usnesení
3. GitHub Actions: denní / týdenní / ruční
4. Kontrolní kompletní datový základ
5. Cloudflare Pages
6. Vlastní doména

Projekt ve svém volném čase vytvořil Martin Štěrba v roce 2026.

## Inkrementální usnesení

Příkaz `npm run sync:resolutions:new` kontroluje pouze nejnovější rok Rady a Zastupitelstva, zachovává historická data a přidává jen dosud neznámá ID usnesení. Při chybě se existující `data/usneseni.json` nepřepisuje. Tento režim je součástí `npm run sync:daily`.

## Inkrementální Registr smluv (v3.0.2)

Registr smluv se v produkci nebude každý den načítat od roku 2016. Jednorázový produkční bootstrap vytvoří kompletní historický dataset. Poté se používá malý oficiální `index.xml` a kontrolní hash každého měsíčního dumpu.

```bash
npm run sync:contracts:plan      # pouze ukáže, které měsíce by se kontrolovaly
npm run sync:contracts:init      # jednou po kompletním bootstrapu uloží výchozí stav hashů
npm run sync:contracts:new       # běžná inkrementální aktualizace
npm run sync:contracts:bootstrap # jednorázový kompletní základ + inicializace stavu
```

Důvod pro kontrolu hashů: Registr smluv může zpětně změnit i starší měsíční dump (například při znepřístupnění smlouvy). Denní sync proto nestahuje celou historii, ale umí poznat, zda se změnil i některý starší měsíc.

## Ranní plánování a bezpečnost (2026-11-26)

GitHub Actions zůstává záložním plánovačem: denně v 06:17 a v pondělí v 06:37, časové pásmo Europe/Prague. Plánované spuštění na GitHubu může být opožděné.

V repozitáři je připravený **samostatný Cloudflare Worker** (skript `scripts/external-scheduler.mjs`, konfigurace `wrangler.scheduler.toml`). Jeho cílem je požádat GitHub o spuštění denní synchronizace od 06:00 a týdenní od pondělních 06:30 českého času. Kontroluje poslední běhy, nevyvolává další běh, pokud už běží nebo dnes uspěl, a omezuje počet pokusů. Neposkytuje veřejný HTTP endpoint. Toto je připravená konfigurace, nikoli potvrzení nasazení Workeru.

### Aktivace externího plánovače

1. V GitHubu vytvořit fine-grained personal access token pouze pro repozitář `martinsterba/praha8-v-prehledech` s oprávněním Actions: Read and write (metadata jsou automaticky jen pro čtení). Nastavit omezenou platnost a evidovat její konec.
2. V Cloudflare Workers vytvořit oddělený Worker podle `wrangler.scheduler.toml`; vložit token výhradně jako zašifrovaný Worker Secret `GITHUB_DISPATCH_TOKEN`. Token nikdy nevkládat do zdrojového kódu, chatu ani veřejného repozitáře.
3. Ověřit první skutečný ranní dispatch a úspěšnou synchronizaci. Až poté rozhodnout o vypnutí nebo podmíněném záložním běhu původního GitHub cronu. Při souběhu jsou workflow serializována stejnou concurrency skupinou; bez této další úpravy se může spustit i druhá kontrola.

### Průběžná bezpečnost

Workflow `security-check.yml` kontroluje syntaxi JS/Pythonu, platnost všech JSON, npm audit, chování plánovače a hlavní stránky v prohlížeči nad lokální kopií produkčních dat. Běží bez oprávnění zapisovat do repozitáře; neúspěšný test se nemá vydávat za úspěch. Závislosti instalujeme z lockfile bez instalačních skriptů, používané CI akce jsou připnuté na konkrétní commit. Cloudflare Pages má soubor `_headers` s bezpečnostními hlavičkami a CSP. Dostupnost těchto hlaviček na živém webu je potřeba ověřit po nasazení.
