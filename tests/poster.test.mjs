import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {layoutTree} from '../web/layout.mjs';
import {createPosterScene, renderPosterSvg, pngSize} from '../web/poster.mjs';

const person=(id,given,extra={})=>({id,given,surname:'Фамилия',photos:[],birth:'8 JUN 1990',death:'6 NOV 2026',note:'PRIVATE_NOTE',...extra});
const data={people:{a:person('a','Центр'),b:person('b','Супруга'),c:person('c','Ребёнок'),d:person('d','Отец'),e:person('e','Мать'),z:person('z','Отдельная линия')},families:{f:{id:'f',husband:'a',wife:'b',children:['c'],date:'1 JAN 2000'},g:{id:'g',husband:'d',wife:'e',children:['a']}}};
const names=scene=>scene.nodes.flatMap(n=>n.portraits.map(p=>p.name));
for(const mode of ['descendants','ancestors','both'])test(`poster preserves ${mode} layout and all displayed partners`,()=>{
  const layout=layoutTree(data,{root:'a',mode}),before=JSON.stringify(layout),scene=createPosterScene(data,layout);
  const expected=new Set(layout.nodes.flatMap(n=>n.type==='person'?[n.id]:[data.families[n.id].husband,data.families[n.id].wife]).filter(Boolean));
  assert.equal(scene.peopleCount,expected.size);
  for(const id of expected)assert.ok(names(scene).includes(data.people[id].given+' Фамилия'));
  assert.equal(scene.edges.length,layout.edges.length);
  assert.equal(JSON.stringify(layout),before,'Projection must not mutate the editor layout');
  assert.equal(scene.nodes.filter(n=>n.portraits.some(p=>p.name==='Центр Фамилия')).length,1,'No duplicate root portrait in union card');
});
test('collapsed branches stay collapsed, off-screen cards remain in the full branch',()=>{
  const full=createPosterScene(data,layoutTree(data,{root:'a'}));
  const collapsed=createPosterScene(data,layoutTree(data,{root:'a',depth:0}));
  assert.ok(names(full).includes('Ребёнок Фамилия'));
  assert.deepEqual(names(collapsed),['Центр Фамилия']);
  const familyCollapsed=createPosterScene(data,layoutTree(data,{root:'a',collapsed:new Set(['root/a/f'])}));
  assert.ok(names(familyCollapsed).includes('Супруга Фамилия'));
  assert.ok(!names(familyCollapsed).includes('Ребёнок Фамилия'));
});
test('all-lines includes disconnected people; projection contains no biographical payload',()=>{
  const scene=createPosterScene(data,layoutTree(data,{all:true}));
  assert.ok(names(scene).includes('Отдельная линия Фамилия'));
  const json=JSON.stringify(scene),svg=renderPosterSvg(scene);
  for(const forbidden of ['PRIVATE_NOTE','JUN','NOV','JAN','birth','death','families']){
    assert.ok(!json.includes(forbidden));assert.ok(!svg.includes(forbidden));
  }
  const text=[...svg.matchAll(/<(?:text|tspan)[^>]*>([^<]*)/g)].map(m=>m[1]).join(' ');
  assert.ok(!/1990|2026|2000/.test(text),'No birth/death/marriage dates in text');
});
test('only local raster photos can enter scene; export embeds them, no remote references',()=>{
  const path='/photos/'+'a'.repeat(20)+'.jpg';
  const source={people:{a:person('a','Портрет',{photos:['original-remote-reference']})},families:{}};
  const layout=layoutTree(source,{root:'a'});
  const scene=createPosterScene(source,layout,()=>path);
  const image='data:image/jpeg;base64,/9j/';
  const svg=renderPosterSvg(scene,{images:new Map([[path,image]])});
  assert.ok(svg.includes(`href="${image}"`));assert.ok(!svg.includes(path));
  for(const unsafe of ['https://example.org/photo.jpg','/api/export','/photos/../../tree.ged','data:image/svg+xml;base64,abcd']){
    assert.equal(createPosterScene(source,layout,()=>unsafe).nodes[0].portraits[0].photo,null);
  }
  const rejected=renderPosterSvg(scene,{images:new Map([[path,'https://example.org/track']])});
  assert.ok(!rejected.includes('https://example.org/track'));
  assert.ok(!rejected.includes('<image '),'Fallback is a neutral silhouette');
});
test('XML injection and names are escaped; no scripts or foreignObject',()=>{
  const source={people:{a:person('a','<script>alert("x")</script>',{surname:'& Тест'})},families:{}};
  const svg=renderPosterSvg(createPosterScene(source,layoutTree(source,{root:'a'})),{title:'<img onerror="evil()">',subtitle:'<tag>&'});
  assert.ok(!svg.includes('<script>'));assert.ok(!svg.includes('<foreignObject'));assert.ok(!svg.includes('<img '));
  assert.ok(svg.includes('&lt;'));assert.ok(svg.includes('&amp;'));
});
test('repeated-reference markers and safe PNG size limits',()=>{
  const layout=layoutTree(data,{root:'a'});layout.nodes[0].repeated=true;
  assert.ok(renderPosterSvg(createPosterScene(data,layout)).includes('Повторная ссылка'));
  for(const [w,h] of [[720,760],[200000,1200],[1200,200000],[10000,10000]]){
    const size=pngSize(w,h);assert.ok(size.width<=4096&&size.height<=4096);assert.ok(size.width*size.height<=16000000);
    assert.ok(size.width>0&&size.height>0);
  }
  assert.throws(()=>pngSize(Infinity,20));assert.throws(()=>pngSize(0,20));
});
test('empty layout still produces a valid-sized poster without leaking data',()=>{
  const scene=createPosterScene(data,{nodes:[],edges:[]});
  assert.equal(scene.peopleCount,0);assert.ok(renderPosterSvg(scene).startsWith('<svg '));
});
test('user background is embedded once, covering the whole SVG without external references',()=>{
  const png=readFileSync(new URL('../web/images/nano-banana-4k-6aee231e41f09db7edd3a148.png',import.meta.url));
  const background='data:image/png;base64,'+png.toString('base64');
  const scene=createPosterScene(data,layoutTree(data,{root:'a'}));
  const svg=renderPosterSvg(scene,{background});
  assert.equal(svg.split('data-poster-background="true"').length-1,1);
  assert.ok(svg.includes(`width="${scene.width}" height="${scene.height}" preserveAspectRatio="xMidYMid slice"`));
  const href=/data-poster-background="true" href="([^"]+)"/.exec(svg)[1];
  assert.deepEqual(Buffer.from(href.split(',')[1],'base64'),png,'Original lossless bytes, not a degraded conversion');
  assert.ok(!svg.includes('url(#night)'));assert.ok(!svg.includes('/images/'));
  assert.ok(!svg.includes('PRIVATE_NOTE')&&!svg.includes('8 JUN 1990'));
});
test('background rejects external URLs, SVG payloads and attribute injection',()=>{
  const scene=createPosterScene(data,layoutTree(data,{root:'a'}));
  for(const background of ['https://example.org/tracking.png','/images/background.png','data:image/svg+xml;base64,abcd','data:image/png;base64,abcd" onload="evil()'])assert.throws(()=>renderPosterSvg(scene,{background}),/PNG/);
});
