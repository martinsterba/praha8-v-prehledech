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

  function normalizeVotingCard(app){
    for(const el of app.querySelectorAll('.status-card-title')){
      const text=el.textContent.trim();
      if(text!=='Usnesení'&&text!=='Hlasování'&&text!=='Výsledek hlasování')continue;

      // production-fixes upravuje mezititulky hlasování na stránce usnesení.
      // Na stránce Datové zdroje ale musí jít o běžný název karty „Hlasování“.
      // Vložený span zároveň zabrání obecné opravě mezititulků, aby tuto kartu znovu nepřepsala.
      if(text!=='Hlasování'||el.classList.contains('voting-mini-heading')||el.children.length===0){
        el.classList.remove('voting-mini-heading');
        el.innerHTML='<span>Hlasování</span>';
      }
    }
  }

  async function polish(){
    if(location.hash.split('?')[0]!=='#/zdroje')return;
    if(running){rerun=true;return}
    running=true;
    try{
      const status=await loadStatus();
      const app=document.querySelector('#app');
      if(!app)return;

      normalizeVotingCard(app);

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
