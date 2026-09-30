#!/usr/bin/env node
/**
 * Unit / sanity tests for the CORE MATH block of index.html.
 *
 * Run with:  node test/core.test.mjs
 * (no external dependencies; the core script block is extracted from index.html)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

// Extract the first <script> block (the pure-math one).
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) { console.error('Could not find core <script> block'); process.exit(1); }
const coreSrc = match[1];

globalThis.window = {};
eval(coreSrc);
const Core = globalThis.window.SampCore || globalThis.SampCore;

let pass = 0, fail = 0;
function assert(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
const approx = (a, b, tol) => Math.abs(a - b) <= tol;
const rng = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();

console.log('Core exports:', Object.keys(Core).join(', '));

/* ---------- Population descriptors ---------- */
{
  const w = Core.weightsFor('uniform', null);
  const ps = Core.popStats(w);
  assert('uniform: total weight = 32 bins', approx(ps.total, 32, 1e-9));
  assert('uniform: mean ≈ 16', approx(ps.mean, 16, 1e-9), `got ${ps.mean}`);
  assert('uniform: sd ≈ 32/√12 ≈ 9.2376', approx(ps.sd, 32 / Math.sqrt(12), 1e-6), `got ${ps.sd}`);
  assert('uniform: median ≈ 16', approx(ps.median, 16, 1e-9), `got ${ps.median}`);
  assert('uniform: skew ≈ 0', approx(ps.skew, 0, 1e-9), `got ${ps.skew}`);
}
{
  const w = Core.weightsFor('normal', null);
  const ps = Core.popStats(w);
  assert('normal: mean ≈ 16', approx(ps.mean, 16, 0.05), `got ${ps.mean}`);
  assert('normal: sd ≈ 4', approx(ps.sd, 4, 0.1), `got ${ps.sd}`);
  assert('normal: skew ≈ 0', approx(ps.skew, 0, 0.1), `got ${ps.skew}`);
}
{
  const w = Core.weightsFor('skewed', null);
  const ps = Core.popStats(w);
  assert('skewed: skew > 0 (right-skewed)', ps.skew > 0.5, `got ${ps.skew}`);
  assert('skewed: median < mean (positive skew)', ps.median < ps.mean, `got med=${ps.median} mean=${ps.mean}`);
}
{
  const w = Core.weightsFor('bimodal', null);
  const ps = Core.popStats(w);
  assert('bimodal: mean ≈ 16 (symmetric mixture)', approx(ps.mean, 16, 0.05), `got ${ps.mean}`);
  assert('bimodal: sd > 4 (two separated peaks)', ps.sd > 8, `got ${ps.sd}`);
}
{
  const custom = new Array(32).fill(1);
  custom[0] = 5; custom[31] = 0;
  const ps = Core.popStats(Core.weightsFor('custom', custom));
  assert('custom: mean shifted left', ps.mean < 16, `got ${ps.mean}`);
}

/* ---------- Sampling validity ---------- */
{
  const w = Core.weightsFor('uniform', null);
  const n = 100000;
  const all = Core.drawSample(w, n, rng);
  assert('drawSample: returns n values', all.length === n);
  let okRange = true; for (const v of all) if (v < 0 || v > 32) { okRange = false; break; }
  assert('drawSample: all values within [0,32]', okRange);
  let mean = 0; for (const v of all) mean += v; mean /= n;
  assert('drawSample: sample mean ≈ 16 (law of large numbers)', approx(mean, 16, 0.1), `got ${mean}`);
}

/* ---------- Sample statistics ---------- */
{
  const s = Core.sampleStats([1, 2, 3, 4, 5]);
  assert('sampleStats: mean = 3', s.mean === 3);
  assert('sampleStats: median = 3', s.median === 3);
  assert('sampleStats: varN = 2', approx(s.varN, 2, 1e-9), `got ${s.varN}`);
  assert('sampleStats: varUnb = 2.5', approx(s.varUnb, 2.5, 1e-9), `got ${s.varUnb}`);
  assert('sampleStats: range = 4', s.range === 4);
  assert('sampleStats: mad = 1.2', approx(s.mad, 1.2, 1e-9), `got ${s.mad}`);
}

/* ---------- Central Limit Theorem: mean of means, SE = σ/√N ---------- */
function cltCheck(shape, N, reps, label, meanTol, sdTol) {
  const w = Core.weightsFor(shape, null);
  const pop = Core.popStats(w);
  const se = pop.sd / Math.sqrt(N);
  const means = new Array(reps);
  for (let i = 0; i < reps; i++) {
    const s = Core.sampleStats(Core.drawSample(w, N, rng));
    means[i] = Core.statisticOf('mean', s);
  }
  const sd = Core.sampDistStats(means);
  assert(`${label}: mean of means ≈ μ (${pop.mean.toFixed(2)})`, approx(sd.mean, pop.mean, meanTol), `got ${sd.mean}`);
  assert(`${label}: sd of means ≈ σ/√N (${se.toFixed(3)})`, approx(sd.sd, se, sdTol), `got ${sd.sd}`);
  return { pop, sd, se };
}

{
  const reps = 50000;
  cltCheck('normal', 16, reps, 'CLT normal N=16', 0.05, 0.03);
  cltCheck('skewed', 4, reps, 'CLT skewed N=4 (mean still ≈ μ, SD = σ/√N)', 0.08, 0.08);
  const big = cltCheck('skewed', 40, reps, 'CLT skewed N=40 (SD shrinks)', 0.05, 0.02);
  const small = cltCheck('skewed', 4, reps, 'CLT skewed N=4 SD > N=40 SD', 0.08, 0.08);
  assert('skewed: SE(N=4) > SE(N=40)', small.se > big.se);
  assert('skewed: observed SD(N=4) > observed SD(N=40)', small.sd.sd > big.sd.sd);
  cltCheck('bimodal', 30, reps, 'CLT bimodal N=30', 0.05, 0.03);
}

/* ---------- Unbiased variance sanity ---------- */
{
  const w = Core.weightsFor('normal', null);
  const pop = Core.popStats(w);
  const reps = 100000, N = 10;
  let sumVarB = 0, sumVarU = 0;
  for (let i = 0; i < reps; i++) {
    const s = Core.sampleStats(Core.drawSample(w, N, rng));
    sumVarB += s.varN; sumVarU += s.varUnb;
  }
  const varPop = pop.sd * pop.sd;
  assert('unbiased variance: mean of varUnb ≈ σ²', approx(sumVarU / reps, varPop, 0.05 * varPop), `got ${sumVarU / reps} expected ${varPop}`);
  assert('biased variance: mean of varN < σ²', sumVarB / reps < varPop, `got ${sumVarB / reps} expected ${varPop}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);