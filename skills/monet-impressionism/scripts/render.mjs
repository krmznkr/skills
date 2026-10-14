#!/usr/bin/env node
// Headless render of the Monet viewer to a PNG for self-inspection.
//
// Usage:
//   node scripts/render.mjs --series lilies-twilight --seed 7 --out out.png
//
// Loads templates/viewer.html via file://, overrides params.series/seed,
// calls syncUI() + paint(), then screenshots the p5 canvas. Console/page
// errors are surfaced to stderr. Exits non-zero on any page error.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = { series: 'lilies-morning', seed: 0, out: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--series') a.series = argv[++i];
    else if (k === '--seed') a.seed = parseInt(argv[++i], 10);
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--help' || k === '-h') a.help = true;
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('Usage: node scripts/render.mjs --series <id> --seed <n> [--out file.png]');
  process.exit(0);
}

const VALID = ['lilies-morning', 'lilies-twilight', 'haystacks-sunset', 'poplars-midday', 'rouen-fog'];
if (!VALID.includes(args.series)) {
  console.error(`Unknown series "${args.series}". Valid: ${VALID.join(', ')}`);
  process.exit(1);
}

const htmlPath = resolve(__dirname, '..', 'templates', 'viewer.html');
const outPath = resolve(args.out || resolve(__dirname, '..', `render-${args.series}-${args.seed}.png`));

// Lazy import puppeteer so a missing dep produces a friendly message.
let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.error(
    'Puppeteer is not installed. Install it first:\n' +
    '  npm i -D puppeteer\n' +
    '(or `bun add -d puppeteer`), then re-run this script.'
  );
  process.exit(2);
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

let failed = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1300, deviceScaleFactor: 1 });

  page.on('pageerror', (err) => { failed = true; console.error('[pageerror]', err.message); });
  page.on('console', (msg) => {
    if (msg.type() === 'error') { failed = true; console.error('[console.error]', msg.text()); }
  });

  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });

  // Wait for the p5 canvas + engine globals to exist.
  await page.waitForFunction(
    () => typeof window.paint === 'function' && !!document.querySelector('#canvas-holder canvas'),
    { timeout: 15000 }
  );

  // Override params and repaint deterministically.
  await page.evaluate(({ series, seed }) => {
    window.params.series = series;
    window.params.seed = seed;
    if (typeof window.syncUI === 'function') window.syncUI();
    window.paint();
  }, { series: args.series, seed: args.seed });

  // Give the (synchronous) paint a beat to flush to the canvas backing store.
  await new Promise((r) => setTimeout(r, 400));

  const canvas = await page.$('#canvas-holder canvas');
  if (!canvas) throw new Error('Canvas element not found after paint().');

  await canvas.screenshot({ path: outPath });
  console.error(`Wrote ${outPath}  (series=${args.series} seed=${args.seed})`);
} catch (err) {
  failed = true;
  console.error('[render error]', err.message);
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
