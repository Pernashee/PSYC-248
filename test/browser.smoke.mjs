#!/usr/bin/env node
/**
 * End-to-end browser smoke test (optional; requires Google Chrome or Edge).
 * Serves index.html, drives it via the DevTools Protocol, asserts the app
 * behaves correctly, and saves screenshots.
 *
 *   node test/browser.smoke.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8765;
const DEBUG_PORT = 9222;
const CHROME = process.env.CHROME ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0, fail = 0;
function assert(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

/* ---- static server ---- */
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const rel = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = join(root, rel);
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'Content-Type': mime[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

/* ---- minimal CDP client (Node 24 global WebSocket) ---- */
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.pending = new Map();
    this.events = [];
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method) this.events.push(m);
    };
  }
  ready() { return new Promise((r) => (this.ws.readyState === 1 ? r() : (this.ws.onopen = () => r()))); }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++this.id;
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 20000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.value;
  }
}

/* ---- launch Chrome ---- */
const userData = join(root, '.tmp-chrome');
mkdirSync(userData, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userData}`, 'about:blank'
], { stdio: 'ignore' });

let cdp;
try {
  // wait for the debug endpoint
  let targets;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`); targets = await r.json(); if (targets.length) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!targets || !targets.length) throw new Error('Chrome debug endpoint not reachable');
  const page = targets.find((t) => t.type === 'page');
  cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  // wait for load
  for (let i = 0; i < 40; i++) {
    const ready = await cdp.eval('document.readyState');
    if (ready === 'complete') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 400)); // let canvases draw

  const shot = async (name) => {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const out = join(root, '.tmp-shots', name + '.png');
    mkdirSync(join(root, '.tmp-shots'), { recursive: true });
    writeFileSync(out, Buffer.from(s.data, 'base64'));
    console.log('  📸 saved', out);
  };

  console.log('\n— initial render —');
  assert('core exposed as window.SampCore', await cdp.eval('typeof window.SampCore === "object"'));
  assert('three canvases present', await cdp.eval('document.querySelectorAll("canvas.hist").length === 3'));
  assert('population stats show Mean μ', (await cdp.eval('document.getElementById("popStatsRow").textContent')).includes('Mean'));
  assert('reps start at 0', (await cdp.eval('document.getElementById("repsChip").textContent')).includes('0'));
  await shot('01-initial');

  console.log('\n— draw 10,000 samples (normal, N=5 default) —');
  await cdp.eval('document.querySelector(\'[data-batch="10000"]\').click()');
  await new Promise((r) => setTimeout(r, 300));
  const reps = await cdp.eval('document.getElementById("repsChip").textContent');
  assert('reps = 10,000', reps.includes('10,000'), reps);
  const sdRow = await cdp.eval('document.getElementById("sampDistStatsRow").textContent');
  assert('sampling dist stats populated', sdRow.includes('Observed SD'), sdRow);
  await shot('02-drawn-10k');

  console.log('\n— skewed population, N=30, 20,000 samples —');
  await cdp.eval('document.querySelector(\'[data-shape="skewed"]\').click()');
  await cdp.eval(`(() => { const s = document.getElementById('nSlider'); s.value = '30'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); })()`);
  await cdp.eval('document.querySelector(\'[data-batch="10000"]\').click()');
  await cdp.eval('document.querySelector(\'[data-batch="10000"]\').click()');
  await new Promise((r) => setTimeout(r, 300));
  const reps2 = await cdp.eval('document.getElementById("repsChip").textContent');
  assert('reps = 20,000', reps2.includes('20,000'), reps2);
  const eq = await cdp.eval('document.getElementById("eqLine").textContent');
  assert('theory panel shows SE = σ⁄√N', eq.includes('√30'), eq);
  const row = await cdp.eval('document.getElementById("sampDistStatsRow").textContent');
  // Extract the observed SD value
  const m = row.match(/Observed SD([\d.]+)/);
  assert('observed SD value present', !!m, row);
  if (m) {
    const seEq = await cdp.eval('document.getElementById("eqLine").innerText');
    const seV = parseFloat(seEq.split('=').pop().replace(/[^\d.]/g, ''));
    const obsV = parseFloat(m[1]);
    console.log(`  info: SE=${seV} observed=${obsV}`);
    assert('observed SD close to theoretical SE (skewed N=30)', Math.abs(seV - obsV) / seV < 0.05, `SE=${seV} obs=${obsV}`);
  }
  await shot('03-skewed-n30');

  console.log('\n— animated sampling + custom population —');
  const before = await cdp.eval('document.getElementById("repsChip").textContent');
  await cdp.eval('document.getElementById("btnAnimate").click()');
  await new Promise((r) => setTimeout(r, 700));
  await cdp.eval('document.getElementById("btnAnimate").click()'); // pause
  const after = await cdp.eval('document.getElementById("repsChip").textContent');
  assert('animate increased reps', after !== before, `${before} → ${after}`);
  await cdp.eval('document.querySelector(\'[data-shape="custom"]\').click()');
  assert('custom hint shown', await cdp.eval('document.getElementById("customHint").classList.contains("show")'));
  await shot('04-custom-population');

  console.log('\n— guide modal & theme —');
  await cdp.eval('document.getElementById("guideBtn").click()');
  assert('guide opens', await cdp.eval('!document.getElementById("guide").classList.contains("hidden")'));
  await shot('05-guide');
  const themeBefore = await cdp.eval('document.documentElement.dataset.theme');
  await cdp.eval('document.getElementById("themeBtn").click()');
  const themeAfter = await cdp.eval('document.documentElement.dataset.theme');
  assert('theme toggles on click (light↔dark)', themeAfter !== themeBefore && ['dark', 'light'].includes(themeAfter), `before=${themeBefore} after=${themeAfter}`);
  await shot('06-dark-theme');

  // collect any page errors
  const errs = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown');
  assert('no uncaught exceptions', errs.length === 0, errs.map((e) => e.params.exceptionDetails.text).join('; '));
  const consoleErr = cdp.events.filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error');
  assert('no console errors', consoleErr.length === 0);

} finally {
  try { if (cdp) await cdp.send('Browser.close'); } catch {}
  chrome.kill();
  await new Promise((r) => server.close(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);