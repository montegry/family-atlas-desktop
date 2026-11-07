import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {invoke,getTree,getMedia,photoUrl,readPhoto,localPhotoName} from '../web/native.mjs';

test('native bridge calls narrowly scoped Tauri commands',async()=>{
  const calls=[];globalThis.__TAURI__={core:{invoke:async(command,args)=>{calls.push({command,args});return command==='get_media'?{local:['a'.repeat(20)+'.jpg'],embedded:{['/photos/'+'a'.repeat(20)+'.jpg']:'data:image/jpeg;base64,/9j/'}}:{people:{},families:{}};}}};
  await getTree();await getMedia();assert.deepEqual(calls.map(c=>c.command),['get_tree','get_media']);
  const path='/photos/'+'a'.repeat(20)+'.jpg';assert.equal(await readPhoto(path),photoUrl(path));
  await assert.rejects(readPhoto('/photos/../../private'));assert.ok(!localPhotoName('../file.jpg'));
  delete globalThis.__TAURI__;await assert.rejects(invoke('get_tree'),/приложение/);
});
test('runtime contains no fetch, Python or local HTTP endpoints',()=>{
  for(const path of ['app.mjs','native.mjs','poster-export.mjs']){
    const code=readFileSync(new URL('../web/'+path,import.meta.url),'utf8');
    assert.ok(!/\bfetch\s*\(|\/api\/|python|127\.0\.0\.1/.test(code),path);
  }
  const config=JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8'));
  assert.ok(!config.build.devUrl);assert.ok(!config.build.beforeDevCommand);
  assert.deepEqual(config.bundle.resources,{'../LICENSE':'LICENSE.txt','../NOTICE.md':'NOTICE.md'},'Only public legal notices may be bundled as extra resources');
});
