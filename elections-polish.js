function polishElectionLayout(){
  if(location.hash!=='#/volby')return;
  const app=document.querySelector('#app');
  if(!app)return;

  for(const section of app.querySelectorAll('.election-year')){
    const head=section.querySelector(':scope > .section-head');
    if(!head)continue;

    const source=section.querySelector(':scope > .source-inline');
    const meta=head.querySelector(':scope > p');
    if(source){
      source.textContent='volby.cz ↗';
      source.classList.add('election-source-link');
    }

    let side=head.querySelector('.election-year-side');
    if(!side){
      side=document.createElement('div');
      side.className='election-year-side';
      head.appendChild(side);
    }
    if(source&&source.parentElement!==side)side.appendChild(source);
    if(meta&&meta.parentElement!==side)side.appendChild(meta);
  }
}

function scheduleElectionLayout(){
  requestAnimationFrame(polishElectionLayout);
}

window.addEventListener('hashchange',scheduleElectionLayout);
document.addEventListener('DOMContentLoaded',scheduleElectionLayout,{once:true});
const electionApp=document.querySelector('#app');
if(electionApp)new MutationObserver(scheduleElectionLayout).observe(electionApp,{childList:true,subtree:true});
