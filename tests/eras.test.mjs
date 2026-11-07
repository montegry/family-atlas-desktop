import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ERAS,resolveEra} from '../web/eras.mjs';

test('five local, self-contained original era illustrations exist',()=>{
  assert.equal(ERAS.length,5);
  for(const era of ERAS){
    const svg=readFileSync(new URL(`../web${era.image}`,import.meta.url),'utf8');
    assert.ok(svg.startsWith('<svg'));assert.ok(svg.includes('<title'));
    assert.ok(!svg.includes('<script'));assert.ok(!/href="https?:/.test(svg));
  }
});
test('automatic themes cover all five epochs with explicit boundaries',()=>{
  for(const [birth,id]of [['1880','imperial'],['1900','early-ussr'],['1940','late-ussr'],['1980','young-russia'],['2000','modern-russia']])assert.equal(resolveEra({birth},2026).id,id);
  for(const [death,id]of [['1916','imperial'],['1917','early-ussr'],['1955','early-ussr'],['1956','late-ussr'],['1991','late-ussr'],['1992','young-russia'],['2009','young-russia'],['2010','modern-russia']])assert.equal(resolveEra({death},2026).id,id);
});
test('theme never uses a later year than death or the present',()=>{
  assert.equal(resolveEra({birth:'1905',death:'1915'},2026).id,'imperial');
  assert.equal(resolveEra({birth:'7 NOV 2024'},2026).reference,2026);
  assert.equal(resolveEra({birth:'ABT 1900'},2026).reference,1920);
});
test('missing and ambiguous dates remain neutral, death alone can be used',()=>{
  assert.equal(resolveEra({}).id,'neutral');
  assert.equal(resolveEra({birth:'BET 1900 AND 1930'}).id,'neutral');
  assert.equal(resolveEra({death:'1999'}).id,'young-russia');
});
test('explicit override wins and unknown overrides fall back safely',()=>{
  assert.equal(resolveEra({birth:'1880',era:'modern-russia'}).id,'modern-russia');
  assert.ok(resolveEra({era:'imperial'}).manual);
  assert.equal(resolveEra({birth:'1880',era:'unknown'}).id,'imperial');
});
