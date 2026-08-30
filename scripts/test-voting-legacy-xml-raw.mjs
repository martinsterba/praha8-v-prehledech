const url='https://praha8.cz/podklady_mc/ZMC20190612audiohlasovani/hlasovani/0001.xml';
const UA='Praha8-v-prehledech/xml-diagnostic';

const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/xml,text/xml,text/plain,*/*'}});
console.log('\nRAW XML DETAIL — 12.06.2019 / 0001.xml');
console.log('────────────────────────────────────');
console.log('URL:',url);
console.log('STATUS:',r.status);
console.log('CONTENT-TYPE:',r.headers.get('content-type'));
const text=await r.text();
console.log('BYTES:',Buffer.byteLength(text,'utf8'));
console.log('\nRAW ZAČÁTEK:\n');
console.log(text.slice(0,12000));
console.log('\n────────────────────────────────────');
const tags=[...new Set([...text.matchAll(/<\/?([A-Za-z_][\w:.-]*)\b/g)].map(m=>m[1]))];
console.log('TAGY:',tags.join(', '));
for(const word of ['PRO','PROTI','ZDR','NEHLAS','NEPŘÍT','jmeno','name','hlas']){
  const hits=(text.match(new RegExp(word,'gi'))||[]).length;
  console.log(`${word}: ${hits}`);
}
