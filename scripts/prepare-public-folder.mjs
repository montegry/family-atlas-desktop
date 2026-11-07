// Make a source-only copy without private working data or the local Git history.
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,lstatSync} from 'node:fs';
import {resolve,dirname,join,relative,isAbsolute,sep} from 'node:path';

const root=process.cwd(),destination=resolve(process.argv[2]||'../family-atlas-desktop');
const location=relative(root,destination);
if(!location||(!isAbsolute(location)&&location!=='..'&&!location.startsWith('..'+sep)))throw new Error('Choose a new directory outside the working repository.');
if(existsSync(destination))throw new Error('Destination already exists. Nothing was overwritten: '+destination);
execFileSync(process.execPath,['scripts/check-publication.mjs'],{stdio:'inherit'});
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean))];
mkdirSync(destination,{recursive:true});
for(const file of files){
  if(!existsSync(file))continue;
  const metadata=lstatSync(file);if(metadata.isSymbolicLink()||!metadata.isFile())throw new Error('Unexpected source entry: '+file);
  const target=join(destination,file);mkdirSync(dirname(target),{recursive:true});copyFileSync(file,target);
}
execFileSync('git',['init','-b','main'],{cwd:destination,stdio:'inherit'});
console.log('Clean public source folder: '+destination);
console.log('No commit was created and nothing was uploaded. Configure your GitHub author identity before the first commit.');
