import {spawn} from 'node:child_process';
import {resolve} from 'node:path';

const script=resolve(import.meta.dirname,'sync-praha8.mjs');
const args=process.argv.slice(2);
const child=spawn(process.execPath,[script,...args],{stdio:['inherit','pipe','inherit'],env:process.env});

const resolutionRun=args.includes('--all-usneseni')||args.includes('--refresh-usneseni')||args.includes('--zastupitelstvo')||args.includes('--usneseni-incremental');
let buffer='';
let sectionPrinted=false;

function outputLine(line){
  if(resolutionRun && !sectionPrinted && /^(\s*)(Rada: synchronizuji|Inkrementální režim:)/.test(line)){
    process.stdout.write('6/13 Usnesení a hlasování Rady a Zastupitelstva…\n');
    sectionPrinted=true;
  }
  if(sectionPrinted && line.trim()==='6/13 Usnesení a hlasování Rady a Zastupitelstva…')return;
  process.stdout.write(line+'\n');
}

child.stdout.setEncoding('utf8');
child.stdout.on('data',chunk=>{
  buffer+=chunk;
  const lines=buffer.split(/\r?\n/);
  buffer=lines.pop()||'';
  for(const line of lines)outputLine(line);
});
child.stdout.on('end',()=>{if(buffer)outputLine(buffer)});
child.on('exit',code=>process.exitCode=code??1);
