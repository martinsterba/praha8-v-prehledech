import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'data', 'forensics-2016-07');
const URL = 'https://data.smlouvy.gov.cz/dump_2016_07.xml';
const TARGET_ICO = '00063797';
const TARGET_DS = 'g5ybpd2';
const UA = 'Mozilla/5.0 Praha8Prehledy/2.5.6 QA-forensic';

const unesc = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();

const tag = (xml, name) => {
  const m = String(xml || '').match(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`, 'i'));
  return m ? unesc(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
};
const blocks = (xml, name) => [...String(xml || '').matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`, 'gi'))].map(m => m[1]);

async function fetchText(url, timeout = 240000) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/xml,text/xml,*/*' }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return await r.text();
}

function localName(raw) {
  return raw.replace(/^.*:/, '');
}

// Lehký tokenový průchod XML. Nepokouší se XML měnit; pouze sleduje zásobník tagů
// a zapisuje cesty k textovým hodnotám. Je záměrně nezávislý na našem parseru smluv.
function leafPaths(xml) {
  const tokenRe = /<[^>]+>|[^<]+/g;
  const stack = [];
  const out = [];
  let m;
  while ((m = tokenRe.exec(xml))) {
    const tok = m[0];
    if (tok.startsWith('<?') || tok.startsWith('<!')) continue;
    if (tok.startsWith('</')) {
      if (stack.length) stack.pop();
      continue;
    }
    if (tok.startsWith('<')) {
      if (/^<\s*[^/!][^>]*\/\s*>$/.test(tok)) continue;
      const nm = tok.match(/^<\s*([^\s>/]+)/)?.[1];
      if (nm) stack.push(localName(nm));
      continue;
    }
    const text = unesc(tok).replace(/\s+/g, ' ').trim();
    if (text) out.push({ path: stack.join('/'), value: text });
  }
  return out;
}

function findEnclosingBlocks(xml, tagName, needle) {
  const re = new RegExp(`<(?:(?:[\\w.-]+):)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${tagName}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) {
    if (m[0].includes(needle)) out.push(m[0]);
  }
  return out;
}

console.log('Forenzní QA nejstaršího XML Registru smluv — v2.5.6');
console.log('────────────────────────────────────────────────────────');
console.log(`Cíl: zjistit skutečnou strukturu záznamu 2016-07 pro MČ Praha 8 (IČO ${TARGET_ICO} / DS ${TARGET_DS}).`);
console.log('Stahuje se POUZE dump 2016-07 (~12 MB). Full-history se NESPOUŠTÍ.');
console.log('Tento skript nic nemění v produkčním datasetu.\n');

const xml = await fetchText(URL);
console.log(`Staženo ${(Buffer.byteLength(xml) / 1024 / 1024).toFixed(1)} MB · ${URL}`);

const recordRe = /<(?:(?:[\w.-]+):)?zaznam\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?zaznam>/gi;
const hits = [];
let m, total = 0;
while ((m = recordRe.exec(xml))) {
  total++;
  const body = m[1];
  if (body.includes(TARGET_ICO) || body.toLowerCase().includes(TARGET_DS)) {
    hits.push({ index: total, xml: m[0] });
  }
}

console.log(`XML záznamů celkem: ${total.toLocaleString('cs-CZ')}`);
console.log(`Záznamů obsahujících IČO/DS Prahy 8: ${hits.length}`);
if (!hits.length) throw new Error('V dumpu nebyl nalezen žádný kandidátní záznam Prahy 8.');

await mkdir(outDir, { recursive: true });
const summary = [];
for (let i = 0; i < Math.min(hits.length, 3); i++) {
  const h = hits[i];
  const paths = leafPaths(h.xml);
  const targetPaths = paths.filter(x => x.value.includes(TARGET_ICO) || x.value.toLowerCase().includes(TARGET_DS));
  const idVerze = tag(h.xml, 'idVerze');
  const idSmlouvy = tag(h.xml, 'idSmlouvy');
  const platny = tag(h.xml, 'platnyZaznam');
  const predmet = tag(h.xml, 'predmet');
  const published = tag(h.xml, 'casZverejneni') || tag(h.xml, 'datumZverejneni');
  const contractDate = tag(h.xml, 'datumUzavreni');
  const partyBlocks = findEnclosingBlocks(h.xml, 'smluvniStrana', TARGET_ICO);

  const file = resolve(outDir, `sample-${i + 1}-record-${h.index}.xml`);
  await writeFile(file, h.xml);

  console.log(`\nVZOREK ${i + 1} · XML záznam #${h.index}`);
  console.log(`idVerze: ${idVerze || '-'} · idSmlouvy: ${idSmlouvy || '-'} · platnyZaznam: ${platny || '-'}`);
  console.log(`datum uzavření: ${contractDate || '-'} · zveřejnění: ${published || '-'}`);
  console.log(`předmět: ${predmet || '-'}`);
  console.log('PŘESNÉ CESTY K IDENTIFIKÁTORŮM PRAHY 8:');
  for (const p of targetPaths) console.log(`  ${p.path} = ${p.value}`);

  console.log('SMLUVNÍ STRANA OBSAHUJÍCÍ IČO 00063797 – listové hodnoty:');
  if (!partyBlocks.length) console.log('  (nenalezena pomocí samostatného blokového řezu)');
  for (const pb of partyBlocks.slice(0, 2)) {
    for (const p of leafPaths(pb).slice(0, 30)) console.log(`  ${p.path} = ${p.value}`);
  }

  console.log('DALŠÍ POTENCIÁLNĚ DŮLEŽITÁ POLE V CELÉM ZÁZNAMU:');
  const interesting = paths.filter(p => /(vklad|publik|odes|schrank|subjekt|strana|zverej|identifik|platny|ico|nazev)/i.test(p.path));
  for (const p of interesting.slice(0, 80)) console.log(`  ${p.path} = ${p.value}`);
  if (interesting.length > 80) console.log(`  … + ${interesting.length - 80} dalších hodnot (plný XML vzorek je uložen v data/forensics-2016-07).`);

  console.log(`Raw XML vzorku: ${file.replace(root + '/', '')}`);
  summary.push({ sample: i + 1, recordIndex: h.index, idVerze, idSmlouvy, platny, contractDate, published, predmet, targetPaths, partyLeafs: partyBlocks.flatMap(leafPaths) });
}

await writeFile(resolve(outDir, 'summary.json'), JSON.stringify({ generatedAt: new Date().toISOString(), source: URL, targetIco: TARGET_ICO, targetDs: TARGET_DS, totalRecords: total, matchingRecords: hits.length, samples: summary }, null, 2));
console.log('\n────────────────────────────────────────────────────────');
console.log(`✓ Uloženy ${Math.min(hits.length, 3)} raw XML vzorky + summary.json do data/forensics-2016-07/`);
console.log('➡️ Pošli mi výstup terminálu od „VZOREK 1“ dál. Z něj už určíme skutečné pravidlo nejstaršího formátu bez dalšího hádání.');
