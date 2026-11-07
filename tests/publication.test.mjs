import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function project(t){
  const directory=mkdtempSync(join(tmpdir(),'atlas-publication-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const root=join(directory,'project');mkdirSync(join(root,'scripts'),{recursive:true});
  for(const name of ['check-publication.mjs','prepare-public-folder.mjs'])copyFileSync(new URL('../scripts/'+name,import.meta.url),join(root,'scripts',name));
  writeFileSync(join(root,'README.md'),'Synthetic public source\n');writeFileSync(join(root,'.gitignore'),'data/\n*.sqlite\n');
  mkdirSync(join(root,'data'));writeFileSync(join(root,'data','family.sqlite'),'SYNTHETIC PRIVATE PLACEHOLDER');
  execFileSync('git',['init','-b','main'],{cwd:root,stdio:'ignore'});return {directory,root};
}
test('public copy excludes ignored private files and local Git history; never overwrites a directory',t=>{
  const {directory,root}=project(t),destination=join(directory,'public');
  const run=()=>spawnSync(process.execPath,['scripts/prepare-public-folder.mjs',destination],{cwd:root,encoding:'utf8'});
  const result=run();assert.equal(result.status,0,result.stderr);assert.ok(existsSync(join(destination,'.git')));assert.ok(!existsSync(join(destination,'data')));
  assert.equal(readFileSync(join(destination,'README.md'),'utf8'),'Synthetic public source\n');
  assert.notEqual(run().status,0);assert.equal(readFileSync(join(destination,'README.md'),'utf8'),'Synthetic public source\n');
  const head=spawnSync('git',['rev-parse','--verify','HEAD'],{cwd:destination,stdio:'ignore'});assert.notEqual(head.status,0,'No author metadata or commits copied');
});
test('publication audit blocks a private database even if it was force-added to Git',t=>{
  const {root}=project(t);execFileSync('git',['add','-f','data/family.sqlite'],{cwd:root});
  const result=spawnSync(process.execPath,['scripts/check-publication.mjs'],{cwd:root,encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/forbidden private/);assert.ok(!result.stderr.includes('SYNTHETIC PRIVATE PLACEHOLDER'));
});
