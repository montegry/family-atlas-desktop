import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TUTORIAL_STEPS} from '../web/tutorial-steps.mjs';

test('tutorial covers a complete first-run path using only static instructions',()=>{
  assert.deepEqual(TUTORIAL_STEPS.map(s=>s.id),['welcome','start','family','navigation','portraits','poster','backup','ready']);
  for(const step of TUTORIAL_STEPS){for(const key of ['label','title','icon','target','location','text'])assert.ok(typeof step[key]==='string'&&step[key].length>0);assert.ok(step.tips.length>=2);}
  assert.ok(TUTORIAL_STEPS.find(s=>s.id==='poster').tips.some(t=>t.includes('Даты')));
  assert.ok(TUTORIAL_STEPS.find(s=>s.id==='backup').tips.some(t=>t.includes('GEDCOM')));
});
test('help button is accessible and tutorial runs only after application data are ready',()=>{
  const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8'),app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
  assert.match(html,/<button[^>]+id="help-button"[^>]+aria-label="Открыть обучение"[^>]+aria-haspopup="dialog"[^>]*>\?<\/button>/);
  assert.ok(html.includes('/tutorial.css'));
  assert.ok(app.indexOf('await tutorial.startIfNeeded();')>app.lastIndexOf('await reloadTree();'));
  const module=readFileSync(new URL('../web/tutorial.mjs',import.meta.url),'utf8');
  assert.ok(!/applyAction|save\(|fetch\(|localStorage/.test(module));
  assert.ok(module.includes("dialog.addEventListener('cancel'"));
  assert.ok(module.includes('if(dialog.open)return;'),'Queued close events must not damage a reopened tutorial');
});
