(()=>{
  const CADENCE={
    'MČ Praha 8|Hlasování':['voting','aktualizace 1x denně'],
    'MČ Praha 8|Usnesení Rady a Zastupitelstva':['resolutions','aktualizace 1x denně'],
    'MČ Praha 8|Informace podle zákona č. 106/1999 Sb.':['info106','aktualizace 1x denně'],
    'MČ Praha 8|Novinky – Aktuality z městské části':['news','aktualizace 1x denně'],
    'MČ Praha 8|Úřední deska':['noticeboard','aktualizace 1x denně'],
    'Registr smluv|Smlouvy MČ Praha 8':['contracts','aktualizace 1x denně'],
    'Registr smluv|Smlouvy příspěvkových organizací a firem MČ Praha 8':['contractEntities','aktualizace 1x denně'],

    'MČ Praha 8|Zastupitelstvo a politické kluby':['people','aktualizace 1x týdně (vždy v pondělí)'],
    'MČ Praha 8|Organizace':['organizations','aktualizace 1x týdně (vždy v pondělí)'],
    'MČ Praha 8|Školská otevřená data':['schoolOpenData','aktualizace 1x týdně (vždy v pondělí)'],
    'MČ Praha 8|Firmy':['p8Companies','aktualizace 1x týdně (vždy v pondělí)'],
    'MČ Praha 8|Komise, výbory a zvláštní orgány':['bodies','aktualizace 1x týdně (vždy v pondělí)'],
    'Hlavní město Praha|Zastupitelstvo, výbory, komise':['hmpFunctions','aktualizace 1x týdně (vždy v pondělí)'],
    'Hlavní město Praha|Firmy':['hmpCompanies','aktualizace 1x týdně (vždy v pondělí)'],
    'Parlament ČR|Poslanci a senátoři':['nationalRoles','aktualizace 1x týdně (vždy v pondělí)'],

    'MČ Praha 8|Rozpočet':['budgetOpenData','ruční aktualizace'],
    'ČSÚ|Volby':['elections','ruční aktualizace'],
    'ČSÚ|Sčítání lidu, domů a bytů 2021':['census2021','ruční aktualizace']
  };

  let statusPromise=null;
  let running=false;
  let rerun=false;

  function loadStatus(){
    if(!statusPromise){
      statusPromise=fetch(`data/source-status.json?v=${Date.now()}`,{cache:'no-store'})
        .then(r=>r.ok?r.json():{})
        .catch(()=>({}));
    }
    return statusPromise;
  }

  function formatUpdated(value){
    if(!value)return '—';
    const text=String(value).trim();
    const dateOnly=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(dateOnly)return `${Number(dateOnly[3])}. ${Number(dateOnly[2])}. ${dateOnly[1]}`;
    const d=new Date(text);
    if(Number.isNaN(d.getTime()))return text;
    return new Intl.DateTimeFormat('cs-CZ',{
      timeZone:'Europe/Prague',day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'
    }).format(d).replace(',','');
  }

  function groupName(card){
    const group=card.closest('.status-group');
    return group?.querySelector('.status-group-head h3')?.textContent?.trim()||'';
  }

  async function polish(){
    if(location.hash.split('?')[0]!=='#/zdroje')return;
    if(running){rerun=true;return}
    running=true;
    try{
      const status=await loadStatus();
      const app=document.querySelector('#app');
      if(!app)return;

      // Hlasování má v datových zdrojích jediný název „Hlasování“ a stejnou
      // typografii jako ostatní názvy zdrojů. Starší prezentační oprava z něj
      // dělala mezititulek „Výsledek hlasování“, což na této stránce nechceme.
      app.querySelectorAll('.status-card').forEach(card=>{
        const titleEl=card.querySelector('.status-card-title');
        if(!titleEl)return;
        const title=titleEl.textContent.replace(/\s+/g,' ').trim();
        if(title==='Usnesení'||title==='Výsledek hlasování'){
          titleEl.textContent='Hlasování';
          titleEl.classList.remove('voting-mini-heading');
        }
      });

      app.querySelectorAll('.status-card').forEach(card=>{
        const titleEl=card.querySelector('.status-card-title');
        const metaEl=card.querySelector('.status-card-meta');
        if(!titleEl||!metaEl)return;
        const group=groupName(card);
        const title=titleEl.textContent.trim();
        const cfg=CADENCE[`${group}|${title}`];
        if(!cfg)return;
        const [key,cadence]=cfg;
        const updated=formatUpdated(status?.[key]?.updated);
        const text=`${cadence} | poslední proběhla ${updated}`;
        if(metaEl.textContent!==text)metaEl.textContent=text;
      });
    }finally{
      running=false;
      if(rerun){rerun=false;queueMicrotask(polish)}
    }
  }

  let timer=0;
  const schedule=()=>{
    clearTimeout(timer);
    timer=setTimeout(polish,30);
  };
  addEventListener('hashchange',()=>{statusPromise=null;schedule()});
  addEventListener('DOMContentLoaded',schedule,{once:true});
  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  schedule();
})();
