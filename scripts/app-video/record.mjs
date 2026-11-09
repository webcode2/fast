// Records a scripted walkthrough of the app preview, using only Chrome and Node.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const here = import.meta.dirname;
const work = mkdtempSync(join(tmpdir(), 'app-video-'));
const appSource = resolve(here, '../../apps/mobile/build/web');
const app = join(work, 'app');
const frames = join(work, 'frames');
const out = process.argv[2] ?? resolve(here, '../../apps/web/media');
const [W, H, SCALE] = [390, 844, 1.5];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
cpSync(appSource, app, { recursive: true });
mkdirSync(frames, { recursive: true });
mkdirSync(out, { recursive: true });

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.otf': 'font/otf', '.ttf': 'font/ttf',
  '.css': 'text/css', '.bin': 'application/octet-stream', '.symbols': 'text/plain' };
const encoder = readFileSync(join(here, 'encoder.html'));
let frameLog = [];
let tapLog = [];
let finished;
const done = new Promise((r) => { finished = r; });
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/__encoder') return res.writeHead(200, { 'content-type': 'text/html' }).end(encoder);
  if (path === '/__plan') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(plan()));
  if (path.startsWith('/__frame/')) return res.writeHead(200, { 'content-type': 'image/jpeg' })
    .end(readFileSync(join(frames, path.slice(9))));
  if (path === '/__upload') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { res.end('ok'); finished({ type: req.headers['content-type'], data: Buffer.concat(chunks) }); });
    return;
  }
  let file = resolve(app, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(app) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
}).listen(8091, '127.0.0.1');

const chrome = spawn('google-chrome', ['--remote-debugging-port=9333', `--user-data-dir=${join(work, 'profile')}`,
  '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--use-angle=gl', '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--window-position=3000,3000', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  target = await fetch('http://127.0.0.1:9333/json').then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null);
}
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { socket.onopen = r; });
let id = 0;
const pending = new Map();
const handlers = {};
socket.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } else handlers[m.method]?.(m.params);
};
const send = (method, params = {}) => new Promise((r, reject) => {
  const n = ++id;
  pending.set(n, (m) => m.error ? reject(new Error(method + ': ' + m.error.message)) : r(m.result));
  socket.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};

let n = 0;
handlers['Page.screencastFrame'] = ({ data, metadata, sessionId }) => {
  const name = `${String(n++).padStart(6, '0')}.jpg`;
  writeFileSync(join(frames, name), Buffer.from(data, 'base64'));
  frameLog.push({ name, t: metadata.timestamp * 1000 });
  send('Page.screencastFrameAck', { sessionId }).catch(() => {});
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
await send('Page.startScreencast', { format: 'jpeg', quality: 82, everyNthFrame: 1, maxWidth: Math.round(W * SCALE), maxHeight: Math.round(H * SCALE) });

const finder = `(label, exact) => {
  const nodes = [...document.querySelectorAll('flt-semantics, [role], input, textarea')];
  const hit = nodes.map((el) => {
    const text = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '').trim();
    const r = el.getBoundingClientRect();
    return { el, text, r };
  }).filter(({ text, r }) => r.width > 2 && r.height > 2 && (exact ? text === label : text.includes(label)));
  hit.sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height);
  return hit;
}`;
const locate = (label, exact = false, index = 0) => evaluate(`(() => { const h = (${finder})(${JSON.stringify(label)}, ${exact});
  const x = h[${index}]; return x ? { x: x.r.x + x.r.width / 2, y: x.r.y + x.r.height / 2, count: h.length } : null; })()`);
const until = async (label, { exact = false, timeout = 120000 } = {}) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const at = await locate(label, exact).catch(() => null);
    if (at) return at;
    await sleep(150);
  }
  const text = await evaluate(`[...document.querySelectorAll('flt-semantics')].map((e) => e.getAttribute('aria-label') || e.textContent).filter(Boolean).slice(0, 30).join(' | ')`);
  throw new Error(`Timed out waiting for "${label}". Visible: ${text}`);
};
const tapAt = async ({ x, y }) => {
  tapLog.push({ t: Date.now(), x: x / W, y: y / H });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(90);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const tap = async (label, options) => { await tapAt(await until(label, options)); await sleep(350); };
const tapField = async (label, x, y, options = {}) => {
  const at = await until(label, { ...options, timeout: 1500 }).catch(() => null);
  await tapAt(at ?? { x, y });
  await sleep(450);
};
const type = async (text, delay = 90) => {
  for (const c of text) { await send('Input.insertText', { text: c }); await sleep(delay); }
};
const open = async (url) => {
  await send('Page.navigate', { url });
  await sleep(3000);
  for (let i = 0; i < 100; i++) {
    const ready = await evaluate(`(() => { const p = document.querySelector('flt-semantics-placeholder'); if (p) { p.click(); return true; } return false; })()`).catch(() => false);
    if (ready) break;
    await sleep(200);
  }
};

// Recorded time is kept only outside cuts.
const cuts = [];
const chapters = [];
let cutFrom = null;
const cut = () => { if (cutFrom === null) cutFrom = Date.now(); };
const resume = () => { if (cutFrom !== null) { cuts.push([cutFrom, Date.now()]); cutFrom = null; } };
const chapter = (key) => chapters.push({ key, t: Date.now() });
const snap = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  writeFileSync(join(out, name), Buffer.from(data, 'base64'));
};
const finishedAt = { t: 0 };

function plan() {
  const removedBefore = (t) => cuts.reduce((sum, [a, b]) => sum + (b <= t ? b - a : t > a ? t - a : 0), 0);
  const start = cuts[0][1];
  const clock = (t) => t - removedBefore(t) - (start - removedBefore(start));
  const windows = cuts.map(([, from], i) => [from, cuts[i + 1]?.[0] ?? finishedAt.t]);
  const kept = [];
  for (const [from, to] of windows) {
    // The screencast only sends changes, so a window starts from the frame already on screen.
    const showing = frameLog.findLast((f) => f.t <= from);
    if (showing) kept.push({ name: showing.name, at: clock(from) });
    for (const f of frameLog) if (f.t > from && f.t <= to) kept.push({ name: f.name, at: clock(f.t) });
  }
  const inWindow = (t) => windows.some(([from, to]) => t >= from && t <= to);
  return {
    width: Math.round(W * SCALE),
    height: Math.round(H * SCALE),
    frames: kept,
    taps: tapLog.filter((p) => inWindow(p.t)).map((p) => ({ ...p, at: clock(p.t) })),
    chapters: chapters.map((c) => ({ key: c.key, at: clock(c.t) })),
    end: clock(finishedAt.t),
  };
}

try {
  cut();
  await open('http://127.0.0.1:8091/?v=film');
  await until('Get started');
  await sleep(1500);
  resume();
  chapter('welcome');
  await sleep(2600);

  cut();
  await tap('Sign in', { exact: true });
  await tapField('Email', 195, 345);
  await type('customer@example.test', 25);
  await tapField('Password', 170, 420, { exact: true });
  await type('preview-only-value', 25);
  await tap('Sign in', { exact: true });
  await until('Where to, and for how much?');
  await sleep(6000);
  resume();

  chapter('pin');
  await sleep(2600);
  await tap('Where to, and for how much?');
  await sleep(900);
  chapter('search');
  await type('river', 260);
  await until('Rivers State University');
  await sleep(1400);
  await tap('Rivers State University');
  cut();
  await until('Raise your offer');
  await sleep(4500);
  resume();

  chapter('fare');
  await sleep(1800);
  await tap('Raise your offer');
  await sleep(600);
  await tap('Raise your offer');
  await sleep(1100);
  await tap('Find riders');
  await until('Finding riders');
  chapter('offers');
  await sleep(1500);
  cut();
  await until('Your price', { timeout: 30000 });
  await sleep(5000);
  resume();
  await sleep(1800);
  const accepts = await until('Accept', { exact: true });
  await tapAt(accepts);
  await until('Confirm this rider');
  await sleep(1800);
  await tap('Accept for');
  await until('Track delivery');
  await sleep(1200);
  await tap('Track delivery');
  await until('km left by road');
  chapter('tracking');
  await sleep(3200);
  cut();
  await until('left the planned route', { timeout: 60000 });
  await sleep(1200);
  resume();
  chapter('reroute');
  await sleep(3600);

  await tap('Message rider');
  await sleep(1500);
  chapter('chat');
  await sleep(1200);
  await tapField('Enter your message', 160, 806);
  await sleep(300);
  await type('I’m at the gate', 70);
  await sleep(500);
  await tap('Send message');
  await sleep(2200);

  cut();
  await open('http://127.0.0.1:8091/?v=film2#/login');
  await until('Welcome back');
  await sleep(1800);
  await tapField('Email', 195, 345);
  await type('rider@example.test', 25);
  await tapField('Password', 170, 420, { exact: true });
  await type('preview-only-value', 25);
  await tap('Sign in', { exact: true });
  await until('Go available');
  await sleep(5000);
  resume();

  chapter('rider');
  await sleep(1500);
  await tap('Go available');
  await until('Claim', { exact: true });
  await sleep(2600);
  await tap('Claim', { exact: true });
  cut();
  await until('arrived at the pickup');
  await sleep(2500);
  resume();
  chapter('arrive');
  await sleep(3200);
  await tap('Mark picked up');
  cut();
  await until('arrived at the drop-off', { timeout: 150000 });
  await sleep(2000);
  resume();
  await sleep(2600);
  await tap('More actions');
  await until('Report a problem');
  chapter('actions');
  await sleep(3000);
  await tap('Close');
  await sleep(700);
  await tap('End trip');
  await until('End this trip?');
  await sleep(1300);
  const confirm = await locate('End trip', true, 0);
  await tapAt(confirm);
  await until('Delivered');
  chapter('delivered');
  await sleep(2600);
  finishedAt.t = Date.now();
  await send('Page.stopScreencast');

  await sleep(500);
  const summary = plan();
  writeFileSync(join(out, 'chapters.json'), JSON.stringify({ end: summary.end, chapters: summary.chapters }, null, 2));
  const posterAt = summary.chapters.find((c) => c.key === 'reroute').at + 1500;
  cpSync(join(frames, summary.frames.findLast((f) => f.at <= posterAt).name), join(out, 'poster.jpg'));
  console.log('frames', summary.frames.length, 'seconds', (summary.end / 1000).toFixed(1),
    'fps', (summary.frames.length / (summary.end / 1000)).toFixed(1));
  await send('Page.navigate', { url: 'http://127.0.0.1:8091/__encoder' });
  const result = await Promise.race([done, sleep(Math.max(180000, summary.end * 3)).then(() => { throw new Error('Encoder timed out'); })]);
  const extension = result.type.includes('mp4') ? 'mp4' : 'webm';
  writeFileSync(join(out, `walkthrough.${extension}`), result.data);
  console.log('video', extension, (result.data.length / 1e6).toFixed(1), 'MB', result.type);
} catch (error) {
  await snap('failure.jpg').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  chrome.kill();
  server.close();
  server.closeAllConnections();
  socket.close();
  setTimeout(() => {
    rmSync(work, { recursive: true, force: true, maxRetries: 5 });
    process.exit(process.exitCode ?? 0);
  }, 500);
}
