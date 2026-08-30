const url='https://praha8.cz/podklady_mc/ZMC20190612audiohlasovani/hlasovani/0001.xml';
const r=await fetch(url,{headers:{'user-agent':'Praha8-v-prehledech/xml-structure-diagnostic','accept':'application/xml,text/xml,text/plain,*/*'}});
const text=await r.text();
console.log('\nLEGACY XML STRUCTURE — 12.06.2019 / 0001.xml');
console.log('────────────────────────────────────────');
console.log('STATUS:',r.status,'· BYTES:',Buffer.byteLength(text,'utf8'));

function firstTag(name){
  const m=text.match(new RegExp(`<${name}\\b[^>]*>`, 'i'));
  return m?.[0]||'(nenalezeno)';
}
function blocks(name,limit=5){
  const re=new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}>|<${name}\\b[^>]*/>`, 'gi');
  return [...text.matchAll(re)].slice(0,limit).map(m=>m[0].replace(/\s+/g,' ').trim());
}

for(const name of ['VotingResult','Session','Topic','Comment','Deputy','Parties','Party']){
  console.log(`\n${name}:`);
  console.log(firstTag(name));
}

const members=blocks('Member',8);
console.log(`\nMEMBER UKÁZKY (${members.length}):`);
for(const [i,m] of members.entries()) console.log(`${i+1}. ${m}`);

console.log('\nVŠECHNY ATRIBUTY Member (prvních 8):');
for(const [i,m] of [...text.matchAll(/<Member\b([^>]*)>/gi)].slice(0,8).entries()) console.log(`${i+1}. ${m[1].trim()}`);

console.log('\nTEXTOVÉ HODNOTY Member (prvních 8):');
for(const [i,m] of [...text.matchAll(/<Member\b[^>]*>([\s\S]*?)<\/Member>/gi)].slice(0,8).entries()) console.log(`${i+1}. ${m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}`);
