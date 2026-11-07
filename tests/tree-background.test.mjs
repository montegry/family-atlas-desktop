import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/style.css',import.meta.url),'utf8');
test('full-resolution lossless background is available locally',()=>{
  const png=readFileSync(new URL('../web/images/nano-banana-4k-6aee231e41f09db7edd3a148.png',import.meta.url));
  assert.equal(png.readUInt32BE(16),5504);assert.equal(png.readUInt32BE(20),3072);
});
test('tree backdrop is a decorative viewport sibling, not a zoomed world layer',()=>{
  assert.ok(html.includes('<div id="tree-background" aria-hidden="true"></div><div id="world">'));
  const rule=css.match(/#tree-background\s*\{([^}]+)\}/)[1];
  assert.ok(rule.includes('pointer-events: none'));assert.ok(rule.includes('opacity: .35'));
  assert.ok(rule.includes('/images/nano-banana-4k-6aee231e41f09db7edd3a148.png'));assert.ok(rule.includes('cover no-repeat'));
});
test('era blending no longer participates in canvas rendering',()=>{
  const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
  assert.ok(!app.includes('treeEraLayers'));assert.ok(!css.includes('.tree-era-layer'));
});
