import assert from 'node:assert/strict';
import {dueWorkflows,runScheduler} from './external-scheduler.mjs';
const date=s=>new Date(s);
assert.deepEqual(dueWorkflows(date('2026-11-26T04:59:00Z')),[]);
assert.deepEqual(dueWorkflows(date('2026-11-26T05:00:00Z')),['daily-sync.yml']);
assert.deepEqual(dueWorkflows(date('2026-07-20T04:00:00Z')),['daily-sync.yml']);
assert.deepEqual(dueWorkflows(date('2026-07-20T04:30:00Z')),['daily-sync.yml','weekly-sync.yml']);
assert.deepEqual(dueWorkflows(date('2026-11-30T05:30:00Z')),['daily-sync.yml','weekly-sync.yml']);
const env={GITHUB_DISPATCH_TOKEN:'dummy-test-token'};
const now=date('2026-11-26T05:00:00Z');
const run={created_at:'2026-11-26T05:00:00Z',status:'completed',conclusion:'success'};
let posts=0;
const stub=runs=>async(url,opts={})=>{
 assert.equal(new URL(url).origin,'https://api.github.com');
 assert.equal(opts.redirect,'error');
 if(opts.method==='POST'){posts++;return {ok:true,status:204}}
 return {ok:true,json:async()=>({workflow_runs:runs})};
};
assert.equal((await runScheduler(now,env,stub([])))[0].status,'dispatched');
assert.equal(posts,1);
assert.equal((await runScheduler(now,env,stub([run])))[0].status,'already-running-or-successful');
assert.equal((await runScheduler(now,env,stub([{...run,status:'in_progress',conclusion:null}])))[0].status,'already-running-or-successful');
assert.equal((await runScheduler(now,env,stub([{...run,conclusion:'failure'},{...run,conclusion:'failure'}])))[0].status,'retry-limit');
assert.equal(posts,1);
await assert.rejects(()=>runScheduler(now,{},stub([])),/secret/);
console.log('Externí plánovač: časová pásma, pondělí, duplicity, omezení pokusů OK.');
