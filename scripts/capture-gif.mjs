// Build docs/stepthrough.gif: an animated capture of the NFA step-through.
// Drives the running dev server with system Chrome, screenshots one frame per
// simulation step, and encodes a GIF with pure-JS libs (no ffmpeg).
//
// Requires: `npm i puppeteer-core pngjs gifenc` and a local Chrome.
// Usage: node scripts/capture-gif.mjs [baseURL]
import puppeteer from 'puppeteer-core';
import pkgPng from 'pngjs';
import gifenc from 'gifenc';
import { writeFileSync } from 'node:fs';

const { PNG } = pkgPng;
const { GIFEncoder, quantize, applyPalette } = gifenc;

const BASE = process.argv[2] ?? 'http://localhost:5173';
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PATTERN = '(a|b)*abb';
const INPUT = 'aababb';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--no-sandbox', '--force-color-profile=srgb'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 1 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#nfa svg');

  const lastStep = await page.evaluate(
    (p, s) => {
      window.__viz.setPattern(p);
      window.__viz.setInput(s);
      window.__viz.step(0);
      return s.length; // frames are 0..length
    },
    PATTERN,
    INPUT,
  );

  // Fixed clip (layout is constant across steps) covering the tape + NFA.
  const clip = await page.evaluate(() => {
    const rects = ['.stepper', '#nfa']
      .map((s) => document.querySelector(s).getBoundingClientRect());
    const x = Math.min(...rects.map((r) => r.left)) - 12;
    const y = Math.min(...rects.map((r) => r.top)) - 12;
    const right = Math.max(...rects.map((r) => r.right)) + 12;
    const bottom = Math.max(...rects.map((r) => r.bottom)) + 12;
    return { x, y, width: right - x, height: bottom - y };
  });

  const frames = [];
  for (let step = 0; step <= lastStep; step++) {
    await page.evaluate((n) => window.__viz.step(n), step);
    await new Promise((r) => setTimeout(r, 120));
    const buf = await page.screenshot({ clip, type: 'png' });
    frames.push(PNG.sync.read(Buffer.from(buf)));
  }

  const { width, height } = frames[0];
  const gif = GIFEncoder();
  frames.forEach((png, i) => {
    const rgba = new Uint8Array(png.data);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    // Hold the first and last (verdict) frames longer; brisk in between.
    const delay = i === 0 ? 1100 : i === frames.length - 1 ? 2200 : 850;
    gif.writeFrame(index, width, height, { palette, delay });
  });
  gif.finish();

  const bytes = Buffer.from(gif.bytes());
  writeFileSync('docs/stepthrough.gif', bytes);
  if (bytes.length < 5000) throw new Error(`GIF looks empty (${bytes.length} bytes)`);
  console.log(`wrote docs/stepthrough.gif  ${width}x${height}, ${frames.length} frames, ${(bytes.length / 1024).toFixed(0)} KB`);
} finally {
  await browser.close();
}
