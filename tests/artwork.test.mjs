import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('desktop and application icons are built from the square artwork derivative',()=>{
  const source=readFileSync(new URL('../artwork/app-icon.png',import.meta.url));
  assert.equal(source.readUInt32BE(16),1024);assert.equal(source.readUInt32BE(20),1024);
  const ico=readFileSync(new URL('../src-tauri/icons/icon.ico',import.meta.url));
  assert.equal(ico.readUInt16LE(2),1);assert.ok(ico.readUInt16LE(4)>=4);
  const icns=readFileSync(new URL('../src-tauri/icons/icon.icns',import.meta.url));assert.equal(icns.toString('ascii',0,4),'icns');
  assert.deepEqual(readFileSync(new URL('../web/app-icon.png',import.meta.url)),readFileSync(new URL('../src-tauri/icons/128x128.png',import.meta.url)));
  const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');assert.ok(html.includes('href="/app-icon.png"'));
});
