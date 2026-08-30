import {existsSync} from 'node:fs';
import puppeteer from 'puppeteer-core';

const source='https://www.praha8.cz/Prehled-hlasovani-zastupitelstva-12-06-2019.html';
const date='2019-06-12';

function findChrome(){
  const candidates=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.PUPPETEER_EXECUTABLE_PATH].filter(Boolean);
  const hit=candidates.find(existsSync);
  if(!hit)throw new Error('Chrome/Edge nenalezen.');
  return hit;
}

const browser=await puppeteer.launch({headless:true,executablePath:findChrome(),args:['--no-sandbox','--disable-setuid-sandbox']});
try{
  const page=await browser.newPage();
  await page.goto(source,{waitUntil:'domcontentloaded',timeout:30000});
  await new Promise(r=>setTimeout(r,500));
  const info=await page.evaluate(()=>({
    title:document.title,
    frames:[...document.querySelectorAll('iframe,frame')].map(x=>x.getAttribute('src')).filter(Boolean),
    embeds:[...document.querySelectorAll('object,embed')].map(x=>x.getAttribute('data')||x.getAttribute('src')).filter(Boolean),
    links:[...document.querySelectorAll('a')].map(x=>x.href).filter(x=>/podklady|hlasov|export|ZMC/i.test(x)),
    matches:[...(document.documentElement.innerHTML||'').matchAll(/[^\s"'<>]*?(?:podklady_mc|hlasov|export|ZMC)[^\s"'<>]*/gi)].map(m=>m[0]).slice(0,100)
  }));
  console.log('\nLEGACY DIAGNOSTIKA 12.06.2019');
  console.log('wrapper:',source);
  console.log('title:',info.title);
  console.log('\nFRAME/IFRAME:'); for(const x of info.frames)console.log(' -',x);
  console.log('\nEMBED/OBJECT:'); for(const x of info.embeds)console.log(' -',x);
  console.log('\nRELEVANTNÍ ODKAZY:'); for(const x of info.links)console.log(' -',x);
  console.log('\nHTML MATCHES:'); for(const x of info.matches)console.log(' -',x);
  console.log('\nCHROME FRAMES:'); for(const f of page.frames())console.log(' -',f.url());

  const [,y,mo,da]=date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const forms=[`${y}${mo}${da}`,`${y}${Number(mo)}${Number(da)}`,`${y}${mo}${Number(da)}`,`${y}${Number(mo)}${da}`];
  const roots=[];
  for(const form of new Set(forms))for(const suffix of ['audiohlasovani','hlasovani'])for(const exp of ['export','Export'])roots.push(`https://praha8.cz/podklady_mc/ZMC${form}${suffix}/${exp}/html/`);
  console.log('\nTEST VARIANT 0001.html:');
  for(const base of roots){
    try{
      const r=await page.goto(`${base}0001.html`,{waitUntil:'domcontentloaded',timeout:15000});
      const status=r?.status()||0;
      const text=(await page.evaluate(()=>document.body?.innerText||'')).replace(/\s+/g,' ').slice(0,140);
      const ok=/Výsledek hlasování/i.test(text);
      console.log(`${ok?'✅':'·'} ${status} ${base}0001.html${ok?` -> ${text}`:''}`);
    }catch(e){console.log(`× ERROR ${base}0001.html -> ${e.message}`)}
  }
} finally {await browser.close()}
