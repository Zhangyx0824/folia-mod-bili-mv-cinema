/**
 * 预览图生成：拿真 B 站 MV 的一帧当画面，把模组真实的 DOM/CSS 跑在 Chromium 里截图。
 *
 *   node test/build_preview.mjs
 *
 * 产出 bili-mv-cinema/preview.jpg（1280×720）。
 * 依赖：本机 ffmpeg、Google Chrome。中间文件都在 test/.build/ 里，已被 .gitignore 忽略。
 */

import { createRequire } from 'node:module';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const modDir = path.join(repo, 'bili-mv-cinema');
const buildDir = path.join(here, '.build');
fs.mkdirSync(buildDir, { recursive: true });

const FFMPEG = '/Users/pomepii/bin/ffmpeg';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SONG = { title: 'Shape of You', artists: [{ name: 'Ed Sheeran' }], duration: 234 };

/* ------------------------------------------------------------------ *
 * 1. 真去 B 站要一个 MV，并截一帧
 * ------------------------------------------------------------------ */

const mod = require(path.join(modDir, 'index.cjs'));
const handlers = {};
mod({
  host: { folium: { major: 1, minor: 9 } },
  log: { info() {}, warn() {}, error() {}, debug() {} },
  rpc: { handle: (name, fn) => (handlers[name] = fn) },
  secrets: { get: async () => '' },
  onDispose() {},
});

const info = await handlers.resolveMv({
  title: SONG.title,
  artist: SONG.artists[0].name,
  durationMs: SONG.duration * 1000,
  quality: '720p',
});

if (!info.ok) {
  console.error('取流失败，预览图没做成：', info.error);
  process.exit(1);
}
console.log('取到：', info.title, '|', info.mode, info.quality.label);

const framePath = path.join(buildDir, 'frame.jpg');
const clipPath = path.join(buildDir, 'loop.mp4');
const headers = 'Referer: https://www.bilibili.com/\r\nUser-Agent: Mozilla/5.0\r\n';

try {
  await execFile(
    FFMPEG,
    [
      '-y',
      '-headers',
      headers,
      '-ss',
      '45',
      '-i',
      info.sources[0].video,
      '-frames:v',
      '1',
      '-vf',
      'scale=1600:-2',
      '-q:v',
      '2',
      framePath,
    ],
    { timeout: 90000 },
  );
  console.log('截帧成功');
} catch (err) {
  console.error('截帧失败：', String(err.stderr || err).slice(0, 400));
  process.exit(1);
}

// 做一段 6 秒的静音视频，让 <video> 真的有东西可解码（不然会走 error 分支）。
await execFile(
  FFMPEG,
  [
    '-y',
    '-loop',
    '1',
    '-i',
    framePath,
    '-t',
    '6',
    '-r',
    '24',
    '-vf',
    'scale=1600:900',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    clipPath,
  ],
  { timeout: 90000 },
);

/* ------------------------------------------------------------------ *
 * 2. 造 harness 页面
 * ------------------------------------------------------------------ */

const harness = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#08080a;overflow:hidden}
  #app{position:fixed;inset:0}
  #bar{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);display:flex;gap:10px;
       padding:8px 12px;border-radius:12px;background:rgba(255,255,255,.06)}
</style></head>
<body>
<div id="app"></div>
<div id="bar"></div>
<script type="module">
const RESULT = ${JSON.stringify({ ...info, quality: { ...info.quality, label: '1080P', width: 1920, height: 1080 }, sources: [{ kind: 'proxy', video: '/loop.mp4', audio: '' }], mode: 'muxed' })};

const listeners = new Map();
const folium = {
  env: { context: 'main' },
  host: { folium: { major: 1, minor: 9 } },
  log: { info(){}, warn(){}, error(){}, debug(){} },
  storage: { get: async () => null, set: async () => {} },
  playback: {
    getState: () => ({ song: ${JSON.stringify(SONG)}, state: 'paused', position: 0, duration: ${SONG.duration} }),
    pause(){}, play(){},
  },
  events: {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
      return () => {};
    },
  },
  rpc: { call: async () => RESULT },
  secrets: { set: async () => {} },
  ui: { toast(){}, navigate(){}, openPlayerPanel(){}, openHomeTab(){} },
  registries: {
    settingsSections: { register: (def) => ({ id: def.id, settings: { get: () => ({ quality: 'auto', pauseMusic: false, volume: 90 }) } }) },
    progressButtons: { register: (def) => { window.__btn = def; return () => {}; } },
    stageLayers: { register: (def) => { window.__layer = def; return () => {}; } },
    commands: { register: () => () => {} },
  },
  theme: { resolveFontStack: () => 'sans-serif', resolveFontWeight: () => 600 },
};

const { default: activate } = await import('/bili-mv-cinema/client.mjs');
activate(folium);

const app = document.getElementById('app');
app.style.cssText = 'position:fixed;inset:0';
window.__layer.mount(app, {});
const holder = document.createElement('div');
document.getElementById('bar').appendChild(holder);
window.__btn.mount(holder, { getColors: () => ({ text: '#fff' }) });

holder.querySelector('button').click();

// 等播放器把 DOM 建好、媒体元数据到齐，然后把画面换成刚截下来的那一帧。
// 无头 Chrome 里让 <video> 真的解码出一帧不稳（虚拟时间 + 媒体管线），
// 预览图只是「展示」，所以画面用静态帧，其余控件全是模组真实的 DOM/CSS。
await new Promise((r) => setTimeout(r, 600));

const root = document.querySelector('.mv-root');
const video = root.querySelector('video');

await new Promise((resolve) => {
  if (video.readyState >= 1) return resolve();
  video.addEventListener('loadedmetadata', () => resolve(), { once: true });
  setTimeout(resolve, 1200);
});

video.pause();
video.style.visibility = 'hidden';

const frame = document.createElement('img');
frame.src = '/frame.jpg';
frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000';
root.insertBefore(frame, video.nextSibling);

// 中间层整个摘掉（加载 / 错误 / 点击播放三种卡片都在里面）
const center = root.querySelector('.mv-center');
if (center) center.remove();

// 装成「正在播、播到中段」的样子（等排队的事件都跑完再写，免得被 timeupdate 盖掉）
await new Promise((r) => setTimeout(r, 250));

root.querySelector('.mv-controls .mv-btn.round').innerHTML =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.4"/><rect x="13.5" y="5" width="4" height="14" rx="1.4"/></svg>';
root.querySelector('.mv-fill').style.width = '37.6%';
root.querySelector('.mv-knob').style.left = '37.6%';
const times = root.querySelectorAll('.mv-time');
times[0].textContent = '1:29';
times[1].textContent = '3:54';
root.removeAttribute('data-idle');
document.title = 'ready';
</script>
</body></html>`;

fs.writeFileSync(path.join(buildDir, 'harness.html'), harness);

/* ------------------------------------------------------------------ *
 * 3. 起本地服务器 + Chromium 截图
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  let file;
  if (url.pathname === '/' || url.pathname === '/harness.html') {
    file = path.join(buildDir, 'harness.html');
  } else if (url.pathname === '/loop.mp4') {
    file = clipPath;
  } else if (url.pathname === '/frame.jpg') {
    file = framePath;
  } else {
    file = path.join(repo, decodeURIComponent(url.pathname));
  }

  let data;
  try {
    data = fs.readFileSync(file);
  } catch {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Content-Length': data.length,
  });
  res.end(data);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const shot = path.join(buildDir, 'shot.png');
await execFile(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--in-process-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--autoplay-policy=no-user-gesture-required',
    '--virtual-time-budget=4000',
    `--screenshot=${shot}`,
    '--window-size=1600,900',
    `http://127.0.0.1:${port}/harness.html`,
  ],
  { timeout: 120000 },
);

server.close();

/* ------------------------------------------------------------------ *
 * 4. 缩到 1280×720 转 jpg
 * ------------------------------------------------------------------ */

const pngPath = path.join(buildDir, 'preview.png');
await execFile(FFMPEG, ['-y', '-i', shot, '-vf', 'scale=1280:720', '-q:v', '3', pngPath], { timeout: 60000 });
await execFile('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', pngPath, '--out', path.join(modDir, 'preview.jpg')], { timeout: 60000 });

const size = fs.statSync(path.join(modDir, 'preview.jpg')).size;
console.log(`预览图已生成：bili-mv-cinema/preview.jpg（${Math.round(size / 1024)} KB）`);
process.exit(0);
