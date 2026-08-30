import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'https://data.smlouvy.gov.cz/dump_2016_07.xml';
const TARGET_ICO = '00063797';
const TARGET_DS = 'g5ybpd2';
const UA = 'Mozilla/5.0 Praha8Prehledy/2.5.7 QA-roles';

const unesc = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
const tag = (xml, name) => {
  const m = String(xml || '').match(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`, 'i'));
  return m ? unesc(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
};
const blocks = (xml, name) => [...String(xml || '').matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`, 'gi'))].map(m => m[1]);
const normIco = s => String(s || '').replace(/\D/g, '').padStart(8, '0');
const entityFrom = b => ({ name: tag(b, 'nazev') || tag(b, 'nazevSubjektu') || tag(b, 'jmeno'), ico: normIco(tag(b, 'ico')), box: tag(b, 'datovaSchranka') || tag(b, 'datovaSchrankaId') });
const isTarget = e => e.ico === TARGET_ICO || String(e.box || '').toLowerCase() === TARGET_DS;

async function fetchText(url, timeout = 240000) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/xml,text/xml,*/*' }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return await r.text();
}

console.log('QA rolí v nejstarším dumpu Registru smluv — v2.5.7');
console.log('──────────────────────────────────────────────────────');
console.log(`Kontrola: ${URL}`);
console.log(`MČ Praha 8: IČO ${TARGET_ICO} / DS ${TARGET_DS}`);
console.log('Cíl: u všech záznamů s Prahou 8 rozlišit PUBLIKUJÍCÍ SUBJEKT vs. SMLUVNÍ STRANA.\n');

const xml = await fetchText(URL);
console.log(`Staženo ${(Buffer.byteLength(xml) / 1024 / 1024).toFixed(1)} MB.`);
const recordRe = /<(?:(?:[\w.-]+):)?zaznam\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?zaznam>/gi;
let m, idx = 0;
const rows = [];
while ((m = recordRe.exec(xml))) {
  idx++;
  const z = m[1];
  if (!z.includes(TARGET_ICO) && !z.toLowerCase().includes(TARGET_DS)) continue;

  const publishers = blocks(z, 'subjekt').map(entityFrom).filter(e => e.name || e.ico || e.box);
  const parties = blocks(z, 'smluvniStrana').map(entityFrom).filter(e => e.name || e.ico || e.box);
  const targetPublisher = publishers.some(isTarget);
  const targetParty = parties.some(isTarget);
  const publisher = publishers[0] || { name: '', ico: '', box: '' };
  const idVerze = tag(z, 'idVerze');
  const idSmlouvy = tag(z, 'idSmlouvy');
  const platny = tag(z, 'platnyZaznam');
  const predmet = tag(z, 'predmet');

  let role = targetPublisher && targetParty ? 'PUBLIKující + SMLUVNÍ STRANA' : targetPublisher ? 'PUBLIKUJÍCÍ SUBJEKT' : targetParty ? 'SMLUVNÍ STRANA / PROTISTRANA' : 'JINÝ VÝSKYT';
  rows.push({ recordIndex: idx, idVerze, idSmlouvy, platny, predmet, publisher, targetPublisher, targetParty, role });
}

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  console.log(`${String(i + 1).padStart(2, ' ')}. idVerze ${r.idVerze || '-'} · platný ${r.platny || '-'} · ${r.role}`);
  console.log(`    publikující subjekt: ${r.publisher.name || '-'} · IČO ${r.publisher.ico || '-'} · DS ${r.publisher.box || '-'}`);
  console.log(`    předmět: ${r.predmet || '-'}`);
}

const asPublisher = rows.filter(r => r.targetPublisher).length;
const asParty = rows.filter(r => r.targetParty).length;
const onlyParty = rows.filter(r => !r.targetPublisher && r.targetParty).length;
const neither = rows.filter(r => !r.targetPublisher && !r.targetParty).length;
const validAsPublisher = rows.filter(r => r.targetPublisher && !['false','0','ne'].includes(String(r.platny || 'true').toLowerCase())).length;

console.log('\nSOUHRN');
console.log('──────────────────────────────────────────────────────');
console.log(`Záznamů obsahujících Prahu 8:             ${rows.length}`);
console.log(`Praha 8 jako publikující subjekt:          ${asPublisher}`);
console.log(`Praha 8 jako smluvní strana:               ${asParty}`);
console.log(`Pouze smluvní strana (ne publikující):      ${onlyParty}`);
console.log(`Jiný/nezařazený výskyt:                     ${neither}`);
console.log(`Platných záznamů publikovaných Prahou 8:    ${validAsPublisher}`);

const passed = rows.length === 11 && asPublisher === 0 && onlyParty === 11 && neither === 0;
if (passed) {
  console.log('\n✅ POTVRZENO: všech 11 výskytů Prahy 8 v dumpu 2016-07 je pouze role smluvní strany.');
  console.log('✅ Nula smluv publikovaných MČ Praha 8 v tomto dumpu je tedy SPRÁVNÝ výsledek parseru.');
  console.log('✅ `smluvniStrana` se nesmí používat jako fallback publikujícího subjektu.');
} else {
  console.log('\n⚠️ Výsledek není čistý 0 publikující / 11 pouze smluvní strana. Full-history zatím nespouštěj.');
}

const report = { generatedAt: new Date().toISOString(), source: URL, targetIco: TARGET_ICO, targetDs: TARGET_DS, totalMatches: rows.length, asPublisher, asParty, onlyParty, neither, validAsPublisher, passed, rows };
await writeFile(resolve(root, 'data', 'contracts-roles-qa.json'), JSON.stringify(report, null, 2));
console.log('\n✓ Report uložen do data/contracts-roles-qa.json');
