import puppeteer from 'puppeteer-core';
import {existsSync} from 'node:fs';

const INDEX='https://praha8.cz/podklady_mc/ZMC20190612audiohlasovani/hlasovani/index.xml';
const XSL='https://praha8.cz/podklady_mc/ZMC20190612audiohlasovani/hlasovani/xsls/her_six.xsl';
function chrome(){const xs=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',process.env.PUPPETEER_EXECUTABLE_PATH].filter(Boolean);return xs.find(existsSync)}
const browser=await puppeteer.launch({headless:true,executablePath:chrome(),args:['--no-sandbox']});
try{
  const page=await browser.newPage();
  for(const url of [INDEX,XSL]){
    const r=await page.goto(url,{waitUntil:'networkidle0',timeout:30000});
    console.log(`\nURL: ${url}\nSTATUS: ${r?.status()}`);
    const out=await page.evaluate(()=>({text:(document.body?.innerText||'').slice(0,12000),html:(document.documentElement?.outerHTML||'').slice(0,12000),links:[...document.querySelectorAll('a')].slice(0,100).map(a=>({text:a.innerText.trim(),href:a.href}))}));
    console.log('\nTEXT:\n'+out.text);
    console.log('\nLINKS:'); for(const x of out.links)console.log(`- ${x.text} -> ${x.href}`);
    console.log('\nHTML:\n'+out.html);
  }
}finally{await browser.close()}
