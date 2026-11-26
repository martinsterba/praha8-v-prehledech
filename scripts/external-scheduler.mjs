// Cloudflare Worker – pouze plánovač, žádný veřejný HTTP endpoint.
// Přístupový token patří do Cloudflare Worker Secret GITHUB_DISPATCH_TOKEN.
const API='https://api.github.com/repos/martinsterba/praha8-v-prehledech';
const zone='Europe/Prague';
export function pragueClock(date){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
 return {day:parts.year+'-'+parts.month+'-'+parts.day,weekday:parts.weekday,minutes:Number(parts.hour)*60+Number(parts.minute)};
}
export function dueWorkflows(date){
 const c=pragueClock(date);
 if(c.minutes<360||c.minutes>=540)return [];
 return ['daily-sync.yml',...(c.weekday==='Mon'&&c.minutes>=390?['weekly-sync.yml']:[])];
}
export async function runScheduler(now,env,request=fetch){
 const due=dueWorkflows(now);
 if(!due.length)return [];
 if(!env.GITHUB_DISPATCH_TOKEN)throw new Error('Chybí secret GITHUB_DISPATCH_TOKEN.');
 const headers={Authorization:'Bearer '+env.GITHUB_DISPATCH_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Praha8-Prehledy-Scheduler','Content-Type':'application/json'};
 const day=pragueClock(now).day;
 const result=[];
 for(const workflow of due){
  const url=API+'/actions/workflows/'+workflow;
  const response=await request(url+'/runs?branch=main&per_page=20',{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(workflow+': GitHub API HTTP '+response.status);
  const data=await response.json();
  if(!Array.isArray(data.workflow_runs))throw new Error(workflow+': neplatná odpověď GitHub API');
  const today=data.workflow_runs.filter(r=>pragueClock(new Date(r.created_at)).day===day);
  if(data.workflow_runs.some(r=>r.status!=='completed')||today.some(r=>r.conclusion==='success')){
   result.push({workflow,status:'already-running-or-successful'});continue;
  }
  if(today.length>=2){result.push({workflow,status:'retry-limit'});console.warn(workflow+': limit dvou pokusů pro dnešek');continue}
  const dispatch=await request(url+'/dispatches',{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(15000),body:JSON.stringify({ref:'main'})});
  if(!dispatch.ok)throw new Error(workflow+': dispatch HTTP '+dispatch.status);
  result.push({workflow,status:'dispatched'});
 }
 console.log(JSON.stringify(result));
 return result;
}
export default {
 async scheduled(event,env){await runScheduler(new Date(event.scheduledTime),env)}
};
