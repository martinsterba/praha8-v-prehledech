import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import puppeteer from 'puppeteer-core';
const root=resolve(import.meta.dirname,'..');
const headerFile=await readFile(resolve(root,'_headers'),'utf8');
const headers=Object.fromEntries(headerFile.split('\n').filter(l=>/^\s+[\w-]+:/.test(l)).map(l=>{const i=l.indexOf(':');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+sep)||!(await stat(file)).isFile())throw Error('not found');
  res.writeHead(200,{...headers,'Content-Type':mime[extname(file)]||'application/octet-stream'});
  createReadStream(file).pipe(res);
 }catch{res.writeHead(404);res.end('Not found')}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await puppeteer.launch({headless:true,executablePath:process.env.PUPPETEER_EXECUTABLE_PATH,args:['--no-sandbox']});
 const page=await browser.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);
 page.on('request',r=>{if(r.url().startsWith(base+'/')||r.url().startsWith('data:'))void r.continue();else void r.abort()});
 await page.evaluateOnNewDocument(()=>{window.__cspViolations=[];document.addEventListener('securitypolicyviolation',e=>window.__cspViolations.push({directive:e.effectiveDirective,blocked:e.blockedURI}))});
 await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:60000});
 const waitHeading=async expected=>{
  await page.waitForFunction(t=>document.querySelector('#app h1')?.textContent.includes(t),{timeout:60000},expected);
  assert.equal(await page.$('.error-notice[role="alert"]'),null);
  console.log('OK:',expected);
 };
 await waitHeading('Radnice zveřejňuje');
 await page.click('[data-open-search]');
 assert.equal(await page.$eval('#searchDialog',d=>d.open),true);
 await page.$eval('#searchDialog',d=>d.close());
 const routes=[
  ['usneseni','Usnesení a hlasování'],['lide','Kdo rozhoduje na Praze 8'],
  ['organy','Výbory a další orgány'],['skoly','Mateřské a základní školy Prahy 8'],
  ['organizace','Organizace a městské firmy'],['volby','Volby'],['info106','Informace podle zákona'],
  ['uredni-deska','Úřední deska'],['novinky','Novinky z městské části'],
  ['penize','Rozpočty a veřejné finance'],['smlouvy','Kam tečou peníze Prahy 8'],
  ['smlouvy-organizace','Smlouvy organizací Prahy 8'],['smlouvy-firmy','Smlouvy městských firem'],
  ['dotace','Dotace a granty'],['scitani-2021','Praha 8 podle Sčítání 2021'],
  ['zdroje','Jak to funguje a odkud jsou data']
 ];
 for(const [route,expected] of routes){await page.evaluate(r=>{location.hash='#/'+r},route);await waitHeading(expected)}
 const csp=await page.evaluate(()=>window.__cspViolations.filter(x=>x.directive.startsWith('script-src')&&x.blocked==='inline'));
 assert.deepEqual(csp,[],'CSP zablokovala interní inline skript');
 assert.deepEqual(errors,[],'Chyba JavaScriptu');
 console.log('Prošlo '+(routes.length+1)+' pohledů, vyhledávání a CSP.');
}finally{await browser?.close();await new Promise(r=>server.close(r))}
