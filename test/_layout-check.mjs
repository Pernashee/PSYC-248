#!/usr/bin/env node
/* temp layout check — not committed */
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const rel = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try { const b = readFileSync(join(root, rel)); res.writeHead(200, { 'Content-Type': mime[extname(rel)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(8765, '127.0.0.1', r));

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9223', '--user-data-dir=' + join(root, '.tmp-chrome2'), 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(u) { this.ws = new WebSocket(u); this.id = 0; this.p = new Map(); this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.p.has(m.id)) { const { res, rej } = this.p.get(m.id); this.p.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } }; }
  ready() { return new Promise((r) => (this.ws.readyState === 1 ? r() : (this.ws.onopen = r))); }
  send(method, params = {}) { return new Promise((res, rej) => { const id = ++this.id; this.p.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); rej(new Error('timeout ' + method)); } }, 15000); }); }
  async ev(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.value; }
}

let targets;
for (let i = 0; i < 40; i++) { try { targets = await (await fetch('http://127.0.0.1:9223/json')).json(); if (targets.length) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const c = new CDP(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await c.ready();
await c.send('Page.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await c.send('Page.navigate', { url: 'http://127.0.0.1:8765/' });
for (let i = 0; i < 40; i++) { if (await c.ev('document.readyState') === 'complete') break; await new Promise((r) => setTimeout(r, 250)); }
await new Promise((r) => setTimeout(r, 400));

console.log('-- desktop 1280 --');
console.log('overflow-x:', await c.ev('document.documentElement.scrollWidth > document.documentElement.clientWidth'));
console.log('canvases:', await c.ev('JSON.stringify([...document.querySelectorAll("canvas.hist")].map(x=>({cw:x.clientWidth,ch:x.clientHeight})))'));
console.log('layout cols:', await c.ev('getComputedStyle(document.querySelector(".layout")).gridTemplateColumns'));
console.log('sidebar position:', await c.ev('getComputedStyle(document.querySelector(".sidebar")).position'));
console.log('theme:', await c.ev('document.documentElement.dataset.theme'));

await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await new Promise((r) => setTimeout(r, 500));
console.log('-- mobile 390 --');
console.log('overflow-x:', await c.ev('document.documentElement.scrollWidth > document.documentElement.clientWidth'));
console.log('layout cols:', await c.ev('getComputedStyle(document.querySelector(".layout")).gridTemplateColumns'));
console.log('sidebar position:', await c.ev('getComputedStyle(document.querySelector(".sidebar")).position'));
const s = await c.send('Page.captureScreenshot', { format: 'png' });
mkdirSync(join(root, '.tmp-shots'), { recursive: true });
import('node:fs').then((fs2) => { fs2.writeFileSync(join(root, '.tmp-shots', '07-mobile.png'), Buffer.from(s.data, 'base64')); });
console.log('📸 saved .tmp-shots/07-mobile.png');

await c.send('Browser.close');
server.close(); chrome.kill();