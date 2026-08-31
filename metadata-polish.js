(()=>{
  const SITE_NAME='Praha 8 v přehledech';
  const DESCRIPTION='Usnesení, hlasování, rozpočet, organizace a další veřejné informace. Na jednom místě, s dohledatelným zdrojem a bez nutnosti procházet desítky dokumentů.';
  const TITLES={
    '#/usneseni':'Usnesení a hlasování',
    '#/penize':'Rozpočty a veřejné finance',
    '#/uredni-deska':'Úřední deska',
    '#/smlouvy':'Registr smluv',
    '#/smlouvy-organizace':'Smlouvy příspěvkových organizací',
    '#/smlouvy-firmy':'Smlouvy městských firem',
    '#/organy':'Komise a výbory',
    '#/skoly':'Školy',
    '#/organizace':'Organizace a městské firmy',
    '#/volby':'Volby',
    '#/lide':'Zastupitelstvo',
    '#/info106':'Informace podle zákona č. 106/1999 Sb.',
    '#/novinky':'Novinky',
    '#/scitani-2021':'Sčítání 2021',
    '#/zdroje':'Datové zdroje'
  };

  function setMeta(selector,attr,value){
    const el=document.querySelector(selector);
    if(el&&el.getAttribute(attr)!==value)el.setAttribute(attr,value);
  }

  function pageLabel(){
    const hash=location.hash.split('?')[0];
    if(!hash||hash==='#'||hash==='#/')return '';
    if(TITLES[hash])return TITLES[hash];
    const h1=document.querySelector('#app h1');
    return (h1?.textContent||'').replace(/\s+/g,' ').trim();
  }

  function apply(){
    const label=pageLabel();
    const title=label?`${SITE_NAME} – ${label}`:SITE_NAME;
    if(document.title!==title)document.title=title;

    setMeta('meta[name="description"]','content',DESCRIPTION);
    setMeta('meta[property="og:title"]','content',title);
    setMeta('meta[property="og:description"]','content',DESCRIPTION);
    setMeta('meta[name="twitter:title"]','content',title);
    setMeta('meta[name="twitter:description"]','content',DESCRIPTION);
  }

  let queued=false;
  const schedule=()=>{
    if(queued)return;
    queued=true;
    queueMicrotask(()=>{queued=false;apply()});
  };

  addEventListener('hashchange',schedule);
  addEventListener('DOMContentLoaded',schedule,{once:true});
  const app=document.querySelector('#app');
  if(app)new MutationObserver(schedule).observe(app,{childList:true,subtree:true});
  apply();
})();
