# PSYC 248 — Sampling Distribution Explorer 📊

A modern, dependency-free reimplementation of the classic **Sampling Distributions**
simulation from Rice University's [Virtual Lab in Statistics](https://onlinestatbook.com/stat_sim/sampling_dist/index.html)
(David Lane, public domain), built for PSYC 248.

**Live demo:** https://pernashee.github.io/PSYC-248/

---

## What it teaches

This simulation makes the **Central Limit Theorem** and the concept of a **sampling
distribution** tangible:

- The distribution of the **mean** (and any other statistic) across thousands of random
  samples, not the scores themselves.
- Larger sample size *N* → the sampling distribution of the mean becomes **narrower and
  more normal**, even when the population is skewed or bimodal.
- The **standard error** formula: **SE = σ / √N** — verified live against the simulated data.
- Unbiased vs. biased estimators (sample variance ÷ N vs. ÷ N−1).
- Every statistic (median, variance, SD, range, MAD) has its **own** sampling distribution.

## Features

| Area | What you get |
|------|--------------|
| **Population** | Normal, Uniform, Skewed, Bimodal presets **or draw your own** by dragging on the top chart |
| **Sample size** | Slider, N = 1–64 (try N = 1, then N = 40 and watch the CLT happen) |
| **Statistic** | Mean, median, variance (÷N), variance (÷N−1), SD (÷N), range, mean absolute deviation |
| **Sampling** | Animated one-sample-at-a-time mode + batch buttons (+1 … +10,000) |
| **Fit normal** | Overlays the theoretical normal (dashed orange, **σ/√N**) and the observed normal (green) on the sampling distribution |
| **Live stats** | Mean (blue), median (purple), ±1 SD (red) drawn on every chart; skewness shown for the sampling distribution |
| **Guides** | In-app "Learning Guide" with the theory and suggested activities |
| **Theme** | Light / dark mode, remembered across visits; fully responsive (works on phones) |

Everything runs client-side in a single `index.html` — no build step, no libraries, no
internet needed after load. You can open the file directly in a browser.

## Run it locally

```bash
# just open the file
start index.html

# or serve it (recommended)
npx serve .        # then open the printed URL
```

## Run the tests

The core statistics are separated from the UI so they can be verified.

```bash
# Unit tests for the core math (no dependencies)
node test/core.test.mjs

# End-to-end browser test (optional — needs Chrome/Edge; set CHROME if needed)
node test/browser.smoke.mjs
```

The unit tests verify, among other things, that the CLT actually holds in the code:
the mean of the sample means ≈ μ and the SD of the sample means ≈ σ/√N, for normal,
skewed, and bimodal populations, and that the unbiased variance estimator converges to
σ². The browser test drives the real page through the Chrome DevTools Protocol.

## How the math is handled (accuracy notes)

- The population lives on 32 bins spanning [0, 32]. Samples are drawn **continuously**
  (uniform within each bin), and population moments are computed with exact within-bin
  corrections (Var = 1/12, etc.) — so the uniform population's SD is *exactly* 32/√12,
  matching the textbook value.
- Statistics use divisor **N** by default to match the original Rice applet; the
  "variance (unbiased)" option uses N−1.
- The sampling distribution is empirical (finite replications), so it *approaches* the
  true theoretical distribution as the number of samples grows — the app says so
  explicitly, just like the original.

## Credits & license

Concept and design originally by **David Lane, Rice Virtual Lab in Statistics** (the
RVLS simulations are in the public domain). This is an original reimplementation with a
fresh UI, additional features (bimodal population, animated mode, dark theme,
responsive layout, auto-verification of the SE formula), and a test suite. The code in
this repository is released under the [MIT License](LICENSE).