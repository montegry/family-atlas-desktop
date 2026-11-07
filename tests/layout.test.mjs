import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syntheticTree} from './fixtures.mjs';
import {buildForest,layoutForest,layoutTree,edgePath,CARD_W,CARD_H} from '../web/layout.mjs';

const people=Object.fromEntries(['a','b','c','d','e','f','g','h','alone'].map(id=>[id,{id}]));
const families={f1:{id:'f1',husband:'a',wife:'b',children:['c','d']},f2:{id:'f2',husband:'c',wife:'e',children:['f','g']},f3:{id:'f3',husband:'d',wife:'h',children:['g']}};
const data={people,families};
function overlap(a,b){return a.x<b.x+CARD_W && b.x<a.x+CARD_W && a.y<b.y+CARD_H && b.y<a.y+CARD_H;}
function flatten(trees){return trees.flatMap(n=>[n,...flatten(n.children)]);}

test('cards and unrelated edge segments never cross',()=>{
  const {nodes,edges}=layoutForest(buildForest(data,{all:true}));
  for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++)assert.ok(!overlap(nodes[a],nodes[b]));
  for(const {from,to} of edges){
    const segments=[{x1:from.x+CARD_W/2,y1:from.y+CARD_H,x2:from.x+CARD_W/2,y2:(from.y+CARD_H+to.y)/2},{x1:from.x+CARD_W/2,y1:(from.y+CARD_H+to.y)/2,x2:to.x+CARD_W/2,y2:(from.y+CARD_H+to.y)/2},{x1:to.x+CARD_W/2,y1:(from.y+CARD_H+to.y)/2,x2:to.x+CARD_W/2,y2:to.y}];
    for(const n of nodes)if(n!==from&&n!==to)for(const s of segments)assert.ok(!(Math.max(s.x1,s.x2)>n.x && Math.min(s.x1,s.x2)<n.x+CARD_W && Math.max(s.y1,s.y2)>n.y && Math.min(s.y1,s.y2)<n.y+CARD_H));
  }
  // Edges in the same horizontal corridor may share a sibling bus; disjoint
  // parent subtrees must have disjoint x-intervals, preventing crossing buses.
  for(const a of edges)for(const b of edges)if(a.from!==b.from && a.from.y===b.from.y){
    const a1=Math.min(a.from.x,a.to.x)+CARD_W/2,a2=Math.max(a.from.x,a.to.x)+CARD_W/2;
    const b1=Math.min(b.from.x,b.to.x)+CARD_W/2,b2=Math.max(b.from.x,b.to.x)+CARD_W/2;
    assert.ok(a2<b1 || b2<a1);
  }
});
test('forest covers people, spouses, disconnected records and families',()=>{
  const nodes=flatten(buildForest(data,{all:true})), covered=new Set(nodes.filter(n=>n.type==='person').map(n=>n.id));
  for(const n of nodes.filter(n=>n.type==='family'))for(const p of [families[n.id].husband,families[n.id].wife])if(p)covered.add(p);
  assert.deepEqual(covered,new Set(Object.keys(people)));
  assert.deepEqual(new Set(nodes.filter(n=>n.type==='family').map(n=>n.id)),new Set(Object.keys(families)));
});
test('individual and family branches collapse independently',()=>{
  const all=flatten(buildForest(data,{root:'a'}));
  const collapsed=flatten(buildForest(data,{root:'a',collapsed:new Set(['root/a/f1/c'])}));
  assert.ok(collapsed.length<all.length);
  assert.ok(collapsed.some(n=>n.id==='d'));assert.ok(!collapsed.some(n=>n.id==='f2'));
  assert.equal(flatten(buildForest(data,{root:'a',collapsed:new Set(['root/a/f1'])})).length,2);
});
test('collapse-all does not create spurious standalone roots',()=>{
  const expanded=buildForest(data,{all:true});const collapsed=buildForest(data,{all:true,depth:0});
  assert.deepEqual(collapsed.map(n=>n.id),expanded.map(n=>n.id));
  assert.ok(collapsed.every(n=>n.children.length===0));
});
test('shared descendants become reference leaves',()=>{
  const nodes=flatten(buildForest(data,{root:'a'}));const refs=nodes.filter(n=>n.id==='g');
  assert.equal(refs.length,2);assert.ok(refs[1].repeated);assert.equal(refs[1].children.length,0);
});
test('ancestor direction and cycle guard',()=>{
  const ancestors=flatten(buildForest(data,{root:'f',mode:'ancestors'}));assert.ok(ancestors.some(n=>n.id==='a'));
  const cyclic={people:{a:{id:'a'}},families:{f:{id:'f',husband:'a',wife:'',children:['a']}}};
  const nodes=flatten(buildForest(cyclic,{root:'a'}));assert.equal(nodes.length,3);assert.ok(nodes[2].repeated);
});
test('families without known parents remain visible',()=>{
  const orphan={people:{a:{id:'a'}},families:{f:{id:'f',husband:'',wife:'',children:['a']}}};
  const nodes=flatten(buildForest(orphan,{all:true}));
  assert.deepEqual(nodes.map(n=>n.id),['f','a']);
});
test('large synthetic tree: all people and families covered, no overlaps or crossing buses',()=>{
  const real=syntheticTree();
  const {nodes,edges}=layoutForest(buildForest(real,{all:true}));
  const covered=new Set(nodes.filter(n=>n.type==='person').map(n=>n.id));
  for(const n of nodes.filter(n=>n.type==='family'))for(const p of [real.families[n.id].husband,real.families[n.id].wife])if(p)covered.add(p);
  assert.equal(covered.size,78);
  assert.equal(new Set(nodes.filter(n=>n.type==='family').map(n=>n.id)).size,27);
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)assert.ok(!overlap(nodes[i],nodes[j]));
  for(const a of edges)for(const b of edges)if(a.from!==b.from && a.from.y===b.from.y){
    const a1=Math.min(a.from.x,a.to.x),a2=Math.max(a.from.x,a.to.x),b1=Math.min(b.from.x,b.to.x),b2=Math.max(b.from.x,b.to.x);
    assert.ok(a2<b1||b2<a1);
  }
});

function checkDirectedGeometry(result) {
  const {nodes,edges}=result;
  for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++)assert.ok(!overlap(nodes[a],nodes[b]));
  for(const {from,to} of edges){
    const up=to.y<from.y, x1=from.x+CARD_W/2, x2=to.x+CARD_W/2;
    const y1=from.y+(up?0:CARD_H),y2=to.y+(up?CARD_H:0),mid=(y1+y2)/2;
    assert.equal(edgePath(from,to),`M${x1},${y1} V${mid} H${x2} V${y2}`);
    const segments=[[x1,y1,x1,mid],[x1,mid,x2,mid],[x2,mid,x2,y2]];
    for(const n of nodes)if(n!==from&&n!==to)for(const [a,b,c,d]of segments)assert.ok(!(Math.max(a,c)>n.x && Math.min(a,c)<n.x+CARD_W && Math.max(b,d)>n.y && Math.min(b,d)<n.y+CARD_H));
  }
  for(const a of edges)for(const b of edges)if(a.from!==b.from && a.from.y===b.from.y && a.to.y===b.to.y){
    const a1=Math.min(a.from.x,a.to.x),a2=Math.max(a.from.x,a.to.x),b1=Math.min(b.from.x,b.to.x),b2=Math.max(b.from.x,b.to.x);
    assert.ok(a2<b1||b2<a1);
  }
}
test('ancestors go up and descendants go down, with correct edge ports',()=>{
  for(const mode of ['ancestors','descendants']){
    const result=layoutTree(data,{root:'c',mode});
    assert.ok(result.edges.length>0);
    assert.ok(result.edges.every(({from,to})=>mode==='ancestors'?to.y<from.y:to.y>from.y));
    checkDirectedGeometry(result);
  }
});
test('combined mode has one centre and independent upper/lower lanes',()=>{
  const result=layoutTree(data,{root:'c',mode:'both'}),root=result.nodes.find(n=>n.isRoot);
  assert.equal(result.nodes.filter(n=>n.id==='c'&&n.type==='person').length,1);
  assert.ok(result.nodes.some(n=>n.y<root.y));assert.ok(result.nodes.some(n=>n.y>root.y));
  assert.equal(root.branches.length,2);checkDirectedGeometry(result);
});
test('combined ancestor and descendant branches collapse independently',()=>{
  const expanded=layoutTree(data,{root:'c',mode:'both'});
  const upCollapsed=layoutTree(data,{root:'c',mode:'both',collapsed:new Set(['up/root/c'])});
  assert.ok(!upCollapsed.nodes.some(n=>n.direction==='up'));
  assert.equal(upCollapsed.nodes.filter(n=>n.direction==='down').length,expanded.nodes.filter(n=>n.direction==='down').length);
  const downCollapsed=layoutTree(data,{root:'c',mode:'both',collapsed:new Set(['down/root/c'])});
  assert.ok(!downCollapsed.nodes.some(n=>n.direction==='down'&&!n.isRoot));
  assert.equal(downCollapsed.nodes.filter(n=>n.direction==='up').length,expanded.nodes.filter(n=>n.direction==='up').length);
  assert.equal(layoutTree(data,{root:'c',mode:'both',depth:0}).nodes.length,1);
});
test('all directed modes on all 78 synthetic people have collision-free geometry',()=>{
  const real=syntheticTree();
  for(const root of Object.keys(real.people))for(const mode of ['ancestors','descendants','both'])checkDirectedGeometry(layoutTree(real,{root,mode}));
});
