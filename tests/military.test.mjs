import test from 'node:test';
import assert from 'node:assert/strict';
import {militarySummary, militaryBadge, sourceLinks} from '../web/military.mjs';

test('unknown military information stays unknown', () => {
  assert.deepEqual(militarySummary({}), {rank:'',service:'',awards:[]});
  assert.equal(militaryBadge({}), '');
  assert.equal(militarySummary({serviceStart:'1935'}).service, '1935 г — не указано');
});
test('ranks, service dates and award counts are separate', () => {
  const p={militaryRank:'Майор',serviceStart:'25 SEP 1935',serviceEnd:'1 SEP 1961',awards:'Орден\nМедаль'};
  assert.equal(militarySummary(p).awards.length, 2);
  assert.match(militarySummary(p).service, /1935.*1961/);
  assert.match(militaryBadge(p), /Майор.*Награды: 2/);
});
test('only HTTP links from citations become links', () => {
  assert.deepEqual(sourceLinks('javascript:alert(1) https://example.org/a/; file:///local https://example.org/a/'), ['https://example.org/a/']);
  assert.deepEqual(sourceLinks('<script>bad</script>'), []);
});
