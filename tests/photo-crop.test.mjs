import test from 'node:test';
import assert from 'node:assert/strict';
import {PHOTO_FRAMES,centeredCrop,moveCrop,cropZoom,validCrop,photoCrop,portraitReference,portraitKey} from '../web/photo-crop.mjs';
import {drawCrop} from '../web/photo-render.mjs';
import {createPosterScene,renderPosterSvg} from '../web/poster.mjs';

test('all display frames preserve aspect ratios and remain within the original image',()=>{
  for(const [w,h] of [[4000,3000],[600,900],[1,1],[1024,256]])for(const mode of Object.keys(PHOTO_FRAMES))for(const z of [1,2,12])for(const [x,y] of [[.5,.5],[0,0],[1,1],[-5,20]]){
    const crop=centeredCrop(w,h,mode,z,x,y);assert.ok(validCrop(crop));
    assert.ok(Math.abs(crop.width*w/(crop.height*h)-PHOTO_FRAMES[mode].width/PHOTO_FRAMES[mode].height)<1e-5);
    assert.ok(Math.abs(cropZoom(crop,w,h,mode)-z)<.0001);
  }
});
test('dragging clamps at boundaries; malformed coordinates never enter render geometry',()=>{
  const c=centeredCrop(600,900,'tree',3);
  assert.equal(moveCrop(c,-100,-100).x,0);assert.equal(moveCrop(c,-100,-100).y,0);
  const edge=moveCrop(c,100,100);assert.ok(validCrop(edge));assert.ok(Math.abs(edge.x+edge.width-1)<1e-8);
  for(const invalid of [{...c,x:-1},{...c,width:0},{...c,height:NaN},{...c,x:2}])assert.ok(!validCrop(invalid));
  assert.throws(()=>moveCrop(c,NaN,0));assert.throws(()=>centeredCrop(0,100,'tree'));assert.throws(()=>centeredCrop(100,100,'unknown'));
});
test('rendering uses the exact normalized source rectangle without altering originals',()=>{
  const calls=[],context={clearRect:(...args)=>calls.push(['clear',...args]),drawImage:(...args)=>calls.push(['draw',...args])};
  const image={naturalWidth:1000,naturalHeight:800},crop={x:.1,y:.2,width:.3,height:.4};
  drawCrop(context,image,crop,150,160);
  assert.deepEqual(calls[1],['draw',image,100,160,300,320,150-150,160-160,150,160]);
  assert.deepEqual(crop,{x:.1,y:.2,width:.3,height:.4});
});
test('primary photo selection falls back safely if the requested original is unavailable',()=>{
  const p={portraitPhoto:'second',photos:['first','second'],photoCrops:{second:{tree:{x:0,y:0,width:1,height:1,privateNote:'must not copy'}}}};
  assert.equal(portraitReference(p,ref=>ref==='first'?'/photos/first':null),'first');
  assert.equal(portraitReference(p,ref=>ref),'second');
  assert.deepEqual(photoCrop(p,'second','tree'),{x:0,y:0,width:1,height:1});
  assert.equal(photoCrop(p,'second','poster'),null);
});
test('artwork honors primary portrait and distinct solo/pair crops, with no biographical payload',()=>{
  const one='/photos/'+'a'.repeat(64)+'.png',two='/photos/'+'b'.repeat(64)+'.png';
  const crop={x:.1,y:.2,width:.3,height:.4},pair={x:.2,y:.3,width:.2,height:.5};
  const p={id:'a',given:'Имя',surname:'Фамилия',photos:['one','two'],portraitPhoto:'two',birth:'1 JAN 1900',note:'PRIVATE',photoCrops:{two:{tree:{x:0,y:0,width:1,height:1},poster:crop,posterPair:pair}}};
  const data={people:{a:p,b:{...p,id:'b'}},families:{f:{id:'f',husband:'a',wife:'b',children:[]}}};
  const scene=createPosterScene(data,{nodes:[{type:'person',id:'a',x:0,y:0}],edges:[]},ref=>ref==='one'?one:two);
  const portrait=scene.nodes[0].portraits[0];assert.equal(portrait.photo,two);assert.deepEqual(portrait.crop,crop);
  const art=renderPosterSvg(scene,{images:new Map([[portraitKey(portrait),'data:image/png;base64,AAAA']])});assert.ok(art.includes('href="data:image/png;base64,AAAA"'));
  assert.ok(!JSON.stringify(scene).includes('PRIVATE'));assert.ok(!JSON.stringify(scene).includes('1900'));
  const both=createPosterScene(data,{nodes:[{type:'family',id:'f',x:0,y:0}],edges:[]},()=>two);
  assert.deepEqual(both.nodes[0].portraits.map(p=>p.crop),[pair,pair]);
});
