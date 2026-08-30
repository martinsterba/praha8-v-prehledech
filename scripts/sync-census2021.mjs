import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'..');
const out=path.join(root,'data','scitani2021.json');
const TARGET={uzemi_cis:'44',uzemi_kod:'500208',uzemi_txt:'Praha 8'};
const URLS={
 population:'https://csu.gov.cz/docs/107508/79c509a0-261c-b4dd-d58d-c05955a24a2c/sldb2021_pohlavi.csv?version=1.0',
 age:'https://csu.gov.cz/docs/107508/4317620c-7502-7dc1-5c96-0cdb9affb540/sldb2021_vek.csv?version=1.0',
 age5:'https://csu.gov.cz/docs/107508/669330fa-7201-a927-a7c8-16e45db63de0/sldb2021_vek5_pohlavi.csv?version=1.0',
 education:'https://csu.gov.cz/docs/107508/4c8e648b-043b-98b0-9c42-9096989c1bce/sldb2021_vzdelani.csv?version=1.0',
 activity:'https://csu.gov.cz/docs/107508/ce2847c2-5f85-399c-f905-3bd1eff51cc0/sldb2021_aktivita_pohlavi.csv?version=1.0',
 households:'https://csu.gov.cz/docs/107508/05638b19-13ea-2ecf-f097-608a80e053eb/sldb2021_domacnosti_clenu_typ.csv?version=1.0',
 commuting:'https://csu.gov.cz/docs/107508/1c4621b8-bf78-532d-47bd-3626dc749681/sldb2021_vyjizdka_vsichni_prostredek_pohlavi.csv?version=1.0',
 flats:'https://csu.gov.cz/docs/107508/2a0f57cc-df70-e0c9-c4d8-837ed04c7e69/sldb2021_byty_obydlenost.csv?version=1.0',
 houses:'https://csu.gov.cz/docs/107508/4f3ca3a1-86ab-aaaa-424e-be47bc03729e/sldb2021_domy_obydlen_druh.csv?version=1.0'
};
function parseCsvLine(line){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q}else if(c===','&&!q){out.push(cur);cur=''}else cur+=c}out.push(cur);return out}
async function targetRows(url){const r=await fetch(url);if(!r.ok)throw new Error(`${r.status} ${r.statusText}: ${url}`);const dec=new TextDecoder('utf-8');let buf='',header=null,found=[];for await(const chunk of r.body){buf+=dec.decode(chunk,{stream:true});let idx;while((idx=buf.indexOf('\n'))>=0){let line=buf.slice(0,idx).replace(/\r$/,'');buf=buf.slice(idx+1);if(!header){header=parseCsvLine(line).map(x=>x.replace(/^\uFEFF/,''));continue}if(!line.includes('Praha 8'))continue;const vals=parseCsvLine(line);const row=Object.fromEntries(header.map((h,i)=>[h,vals[i]??'']));if(row.uzemi_cis===TARGET.uzemi_cis&&row.uzemi_kod===TARGET.uzemi_kod&&row.uzemi_txt===TARGET.uzemi_txt)found.push(row)}}return found}
const n=x=>Number(x?.hodnota||0);const pick=(rows,pred)=>rows.find(pred);const value=(rows,key,label)=>n(rows.find(x=>x[key]===label&&!x.pohlavi_txt));
console.log('Sčítání 2021 – MČ Praha 8');console.log('Načítám 9 oficiálních CSV datových sad ČSÚ…');
const [pop,age,age5,education,activity,households,commuting,flats,houses]=await Promise.all(Object.values(URLS).map(targetRows));
const total=n(pick(pop,x=>!x.pohlavi_txt)),men=n(pick(pop,x=>x.pohlavi_txt==='muž')),women=n(pick(pop,x=>x.pohlavi_txt==='žena'));
const ageGroups=['0 - 14 let','15 - 64 let','65 a více let'].map(label=>({label:label.replace(' - ','–'),value:n(pick(age,x=>x.vek_txt===label))}));
const age5Groups=age5.filter(x=>x.vek_txt&&!x.pohlavi_txt).map(x=>({label:x.vek_txt.replace(' - ','–').replace(' roky',' let'),value:n(x)}));
const eduLabels=[['Základní vč. neukončeného','Základní a neukončené'],['Střední vč. vyučení (bez maturity)','Střední bez maturity'],['Úplné  střední (s maturitou), vč. nástavbového a pomaturitního','Střední s maturitou'],['Vyšší odborné, konzervatoř','Vyšší odborné / konzervatoř'],['Vysokoškolské','Vysokoškolské'],['Bez vzdělání','Bez vzdělání'],['Nezjištěno','Nezjištěno']];
const educationGroups=eduLabels.map(([src,label])=>({label,value:value(education,'vzdelani_txt',src)}));
const activityLabels=[['Zaměstnaní','Zaměstnaní'],['Nezaměstnaní','Nezaměstnaní'],['Nepracující důchodci','Nepracující důchodci'],['Žáci, studenti','Žáci a studenti'],['Osoby na rodičovské dovolené','Na rodičovské dovolené'],['Ostatní s vlastním zdrojem obživy','Ostatní s vlastním zdrojem'],['Nezjištěno','Nezjištěno']];
const activityGroups=activityLabels.map(([src,label])=>({label,value:value(activity,'ekonaktiv_txt',src)}));
const hhTotal=n(pick(households,x=>!x.clenu_txt&&!x.typ_txt)),hhSingle=n(pick(households,x=>x.typ_txt==='Domácnost jednotlivce'&&!x.clenu_txt)),hhFamily=n(pick(households,x=>x.typ_txt==='Rodinné domácnosti'&&!x.clenu_txt));
const hhSizes=households.filter(x=>x.clenu_txt&&!x.typ_txt).map(x=>({label:`${x.clenu_txt} ${x.clenu_txt==='1'?'člen':(['2','3','4'].includes(x.clenu_txt)?'členové':'členů')}`,value:n(x)}));
const commuteModes=commuting.filter(x=>!x.pohlavi_txt&&x.prostredek_txt&&x.prostredek_txt!=='Nezjištěno').map(x=>({label:x.prostredek_txt,value:n(x)})).sort((a,b)=>b.value-a.value);
const houseTotal=n(pick(houses,x=>!x.obydlen_txt&&!x.druh_txt)),houseOccupied=n(pick(houses,x=>x.obydlen_txt==='Obvykle obydlen'&&!x.druh_txt)),family=n(pick(houses,x=>x.obydlen_txt==='Obvykle obydlen'&&x.druh_txt==='Rodinné domy')),apartment=n(pick(houses,x=>x.obydlen_txt==='Obvykle obydlen'&&x.druh_txt==='Bytový dům')),other=n(pick(houses,x=>x.obydlen_txt==='Obvykle obydlen'&&x.druh_txt?.startsWith('Ostatní budovy')));
const flatsTotal=n(pick(flats,x=>!x.obydlenost_txt)),flatsOccupied=n(pick(flats,x=>x.obydlenost_txt==='obvykle obydlen')),flatsUnoccupied=n(pick(flats,x=>x.obydlenost_txt==='obvykle neobydlen'));
if(!total||!houseTotal||!flatsTotal||!hhTotal)throw new Error('Nepodařilo se bezpečně identifikovat základní řádky Prahy 8 v datech ČSÚ.');
const result={meta:{year:2021,censusDate:'2021-03-26',territory:'Praha 8',territoryCode:'500208',territoryTypeCode:'44',updated:new Date().toISOString(),source:'Český statistický úřad – Sčítání 2021',sourceUrl:'https://csu.gov.cz/produkty/vysledky-scitani-2021-otevrena-data',note:'Obyvatelstvo je uváděno podle obvyklého pobytu.'},population:{total,men,women,ageGroups,age5:age5Groups},education:{population15plus:n(pick(education,x=>!x.vzdelani_txt&&!x.pohlavi_txt)),groups:educationGroups},economicActivity:{labourForce:value(activity,'ekonaktiv_txt','Pracovní síla'),outsideLabourForce:value(activity,'ekonaktiv_txt','Mimo pracovní sílu'),groups:activityGroups},households:{total:hhTotal,single:hhSingle,family:hhFamily,sizes:hhSizes},commuting:{total:n(pick(commuting,x=>!x.prostredek_txt&&!x.pohlavi_txt)),modes:commuteModes},housing:{housesTotal:houseTotal,housesOccupied:houseOccupied,familyHousesOccupied:family,apartmentHousesOccupied:apartment,otherBuildingsOccupied:other,flatsTotal,flatsOccupied,flatsUnoccupied},datasets:['Obyvatelstvo podle pohlaví','Obyvatelstvo podle věkových skupin','Obyvatelstvo podle pětiletých věkových skupin a pohlaví','Obyvatelstvo podle vzdělání','Obyvatelstvo podle ekonomické aktivity a pohlaví','Hospodařící domácnosti podle velikosti a typu domácnosti','Vyjíždějící do zaměstnání a školy podle hlavního dopravního prostředku','Domy podle obydlenosti a druhu domu','Byty podle obydlenosti']};
await fs.writeFile(out,JSON.stringify(result,null,2)+'\n');
console.log(`✓ Obyvatel: ${total.toLocaleString('cs-CZ')}`);console.log(`✓ Domácností: ${hhTotal.toLocaleString('cs-CZ')}`);console.log(`✓ Domů: ${houseTotal.toLocaleString('cs-CZ')}`);console.log(`✓ Bytů: ${flatsTotal.toLocaleString('cs-CZ')}`);console.log('✓ Uloženo data/scitani2021.json');
