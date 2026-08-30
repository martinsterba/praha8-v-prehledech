import puppeteer from 'puppeteer-core';
import {existsSync} from 'node:fs';

const URL='https://praha8.cz/podklady_mc/ZMC20260617audiohlasovani/export/html/0001.html';
const candidates=[
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  process.env.PUPPETEER_EXECUTABLE_PATH
].filter(Boolean);
const executablePath=candidates.find(existsSync);
if(!executablePath)throw new Error('Chrome nebyl nalezen.');
const browser=await puppeteer.launch({headless:true,executablePath,args:['--no-sandbox','--disable-setuid-sandbox']});
try{
  const page=await browser.newPage();
  await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
  const data=await page.evaluate(()=>{
    const text=document.body.innerText.replace(/\r/g,'');
    const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
    const total=label=>{
      const m=text.match(new RegExp(label+'\\s*:\\s*(\\d+)','i'));
      return m?Number(m[1]):null;
    };
    const head=(lines.find(x=>/Výsledek hlasování č\./i.test(x))||'').match(/Výsledek hlasování č\.\s*(\d+)\s*-\s*bod č\.\s*([^\s]+)\s*-\s*(.*)/i);
    const votes=[];
    for(const row of [...document.querySelectorAll('tr')]){
      const cells=[...row.querySelectorAll('td,th')].map(x=>x.innerText.trim()).filter(Boolean);
      const vi=cells.findIndex(x=>/^(PRO|PROTI|ZDRŽEL(?:A)? SE|NEHLASOVAL(?:A)?|NEPŘÍTOMEN|NEPŘÍTOMNA)$/i.test(x));
      if(vi<0)continue;
      const before=cells.slice(0,vi);
      const name=[...before].reverse().find(x=>/^[\p{L}.]+(?:\s+[\p{L}.]+)+$/u.test(x) && !/^\d+$/.test(x));
      if(name)votes.push({name,vote:cells[vi]});
    }
    return {
      titleLine:lines.find(x=>/Výsledek hlasování č\./i.test(x))||'',
      number:head?Number(head[1]):null,
      item:head?.[2]||'',
      title:head?.[3]||'',
      present:total('PŘÍTOMNÝCH'),
      for:total('PRO'),
      against:total('PROTI'),
      abstained:total('ZDRŽELO SE'),
      notVoting:total('NEHLASOVALO'),
      absent:total('NEPŘÍTOMNÝCH'),
      votes,
      sample:lines.slice(0,12)
    };
  });
  console.log('HLASOVÁNÍ — TEST PŘES CHROME DOM');
  console.log('───────────────────────────────');
  console.log(`titulek: ${data.titleLine}`);
  console.log(`číslo: ${data.number} · bod: ${data.item}`);
  console.log(`přítomných: ${data.present} · pro: ${data.for} · proti: ${data.against} · zdrželo: ${data.abstained} · nehlasovalo: ${data.notVoting} · nepřítomných: ${data.absent}`);
  console.log(`jmenovitých hlasů: ${data.votes.length}`);
  if(data.votes.length)console.log(`první hlas: ${data.votes[0].name} → ${data.votes[0].vote}`);
  if(data.present!==35 || data.for!==34 || data.against!==0 || data.abstained!==0 || data.notVoting!==1 || data.absent!==10 || data.votes.length<40){
    console.log('\nDiagnostický výřez stránky:');
    console.log(data.sample.join('\n'));
    process.exitCode=1;
  }else{
    console.log('\n✅ Parser přes Chrome čte oficiální hlasování správně.');
  }
} finally {
  await browser.close();
}
