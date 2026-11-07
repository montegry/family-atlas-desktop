// Audit only Git-visible source files. Never opens ignored family databases.
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync,lstatSync} from 'node:fs';
import {extname} from 'node:path';

const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:30*1024*1024});
const forbidden=/(?:^|\/)(?:migration|data|photos|backups|research|exports|releases|private|test-results|node_modules|target)(?:\/|$)|\.(?:sqlite(?:3)?(?:-\w+)?|db(?:-\w+)?|ged|gedcom|bundle|pem|p12|pfx|key|jks|exe|msi|dmg|deb|appimage|zip)$/i;
const credentialPath=/(?:^|\/)(?:\.env(?:\..*)?|credentials(?:\.json)?|id_rsa|id_ed25519)$/i;
const textFile=p=>['.md','.rs','.sql','.mjs','.js','.json','.toml','.lock','.yml','.yaml','.svg','.sh','.ps1','.bat','.xml','.txt'].includes(extname(p))||['LICENSE','.gitignore','.gitattributes'].includes(p);
const suspicious=[
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{24,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /@I\d{7,}@/,
];
const errors=[];
function check(path,content,label){
  if(forbidden.test(path)||(credentialPath.test(path)&&!path.endsWith('.env.example')))errors.push(`${label}: forbidden private/generated file ${path}`);
  if(/\.(?:png|jpe?g|gif|webp|ico|icns)$/i.test(path)&&!(/^(?:web\/images\/|artwork\/|src-tauri\/icons\/|docs\/images\/)/.test(path)||path==='web/app-icon.png'))errors.push(`${label}: image outside reviewed public artwork directories ${path}`);
  if(content&&path.endsWith('.json')){
    try{const value=JSON.parse(content);if(value.format==='family-atlas'||(value.people&&value.families)||(value.files&&Object.keys(value.files).some(key=>/^https?:\/\//.test(key))))errors.push(`${label}: possible family export or private photo manifest ${path}`);}catch{/* Syntax checks are separate; this audit does not execute source files. */}
  }
  if(content&&suspicious.some(pattern=>pattern.test(content)))errors.push(`${label}: review possible secret or non-synthetic person ID in ${path}`);
}
const files=[...new Set(git('ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean))];
for(const file of files){if(!existsSync(file))continue;if(lstatSync(file).isSymbolicLink()){errors.push(`working tree: symlink requires manual review ${file}`);continue;}check(file,textFile(file)?readFileSync(file,'utf8'):null,'working tree');}
let commits=0;
if(process.argv.includes('--history')){
  const revisions=git('rev-list','--all').trim().split('\n').filter(Boolean);
  for(const revision of revisions){
    commits++;
    for(const file of git('ls-tree','-r','--name-only','-z',revision).split('\0').filter(Boolean)){
      check(file,textFile(file)?git('show',`${revision}:${file}`):null,`history ${revision.slice(0,8)}`);
    }
  }
}
if(errors.length){console.error([...new Set(errors)].join('\n'));process.exitCode=1;}
else console.log(`Publication audit passed: ${files.length} source files${commits?`, ${commits} historical commits`:''}. Ignored local family data were not read.`);
console.log('This is a safety net, not a guarantee: manually review images, author metadata, staged changes and artwork permissions before publishing.');
