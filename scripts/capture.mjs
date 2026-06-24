// Headless screenshot capture for docs/. Drives the running dev server with
// the system Chrome via puppeteer-core and writes faithful PNGs.
//
// Usage: node scripts/capture.mjs [baseURL]   (default http://localhost:5173)
import puppeteer from 'puppeteer-core';

// Requires a local Chrome/Chromium and `npm i puppeteer-core` (not a project
// dependency). Override the browser with CHROME_PATH and the URL via argv[2].
const BASE = process.argv[2] ?? 'http://localhost:5173';
const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--no-sandbox', '--force-color-profile=srgb'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1320, height: 1000, deviceScaleFactor: 2 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#nfa svg');

  // Deterministic sample state.
  await page.evaluate(() => {
    window.__viz.setPattern('(a|b)*abb');
    window.__viz.setInput('aababb');
    window.__viz.step(3);
  });
  await new Promise((r) => setTimeout(r, 150));

  const clipOf = async (selectors) => {
    const boxes = await page.evaluate((sels) => {
      const rects = sels
        .map((s) => document.querySelector(s))
        .filter(Boolean)
        .map((el) => el.getBoundingClientRect());
      const x = Math.min(...rects.map((r) => r.left));
      const y = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      return { x, y, width: right - x, height: bottom - y };
    }, selectors);
    const pad = 14;
    return {
      x: Math.max(0, boxes.x - pad),
      y: Math.max(0, boxes.y - pad),
      width: boxes.width + pad * 2,
      height: boxes.height + pad * 2,
    };
  };

  const shot = async (file, selectors) => {
    const clip = await clipOf(selectors);
    await page.screenshot({ path: `docs/${file}`, clip });
    console.log(`wrote docs/${file}  (${Math.round(clip.width)}x${Math.round(clip.height)})`);
  };

  // (1) Step-through mid-simulation: tape + active-set-highlighted NFA together.
  await shot('stepthrough.png', ['.stepper', '#nfa']);

  // (2) All four diagrams.
  await shot('graphs.png', ['.graphs']);

  // (3) Overview hero: masthead through the graphs grid.
  await shot('overview.png', ['.masthead', '.graphs']);

  // (4) ReDoS benchmark — run it, then capture the chart.
  await page.evaluate(() => window.__viz.runBenchmark());
  await new Promise((r) => setTimeout(r, 150));
  await shot('redos.png', ['.redos']);

  // Verify non-empty output.
  const { statSync } = await import('node:fs');
  for (const f of ['stepthrough.png', 'graphs.png', 'overview.png', 'redos.png']) {
    const size = statSync(`docs/${f}`).size;
    if (size < 2000) throw new Error(`docs/${f} looks empty (${size} bytes)`);
    console.log(`verified docs/${f}: ${size} bytes`);
  }
} finally {
  await browser.close();
}
