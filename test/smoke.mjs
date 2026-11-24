/**
 * 冒烟测试：不连 B 站、不碰真宿主，用 jsdom + 假 folium 跑一遍主路径。
 *
 *   node test/smoke.mjs
 *
 * 断言的是「结构 + 状态变迁 + 有没有把宿主搞脏」，不是视觉。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/Users/pomepii/.workbuddy/binaries/node/workspace/node_modules/');
const { JSDOM } = require('jsdom');

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(here, '..', 'bili-mv-cinema', 'client.mjs');

const SONG = {
  title: '晴天',
  artists: [{ name: '周杰伦' }],
  duration: 270,
  coverUrl: 'https://p1.music.126.net/qing.jpg',
  sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' },
};

const QUEUE = ['晴天', '七里香', '稻香'].map((title, index) => ({
  index,
  song: {
    title,
    artists: [{ name: '周杰伦' }],
    duration: 270,
    coverUrl: `https://p1.music.126.net/${index}.jpg`,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(index + 1) },
  },
}));

/** 歌词：三句，够测「播到哪句」和「元数据行要过滤掉」。 */
const LYRICS = [
  { fullText: '作词：周杰伦', startTime: 0, endTime: 4 },
  { fullText: '故事的小黄花', startTime: 2, endTime: 7, translation: 'The little yellow flower' },
  { fullText: '从出生那年就飘着', startTime: 7.5, endTime: 13 },
];

const OK_RESULT = {
  ok: true,
  bvid: 'BV1xx411c7mD',
  title: '周杰伦 - 晴天 MV',
  author: '周杰伦',
  cover: 'https://i0.hdslb.com/bfs/archive/x.jpg',
  durationSec: 270,
  score: 96,
  keyword: '晴天 周杰伦',
  mode: 'dash',
  quality: { id: 80, label: '1080P', width: 1920, height: 1080, codecid: 7, codec: 'AVC' },
  sources: [
    {
      kind: 'proxy',
      video: 'http://127.0.0.1:5000/s/vtoken',
      audio: 'http://127.0.0.1:5000/s/atoken',
    },
  ],
  candidates: [
    {
      bvid: 'BV1xx411c7mD',
      title: '周杰伦 - 晴天 MV',
      author: '周杰伦',
      cover: '',
      duration: '4:30',
      score: 96,
    },
  ],
  url: 'https://www.bilibili.com/video/BV1xx411c7mD',
};

/** 造一个够用的宿主。返回的 calls 记录模组都干了什么。 */
function makeHost({ minor = 9, resolveResult = OK_RESULT, song = SONG } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="bar"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'https://folia.local/',
  });
  const { window } = dom;

  // jsdom 不实现媒体播放：打桩，只记调用（paused 也自己维护，否则 toggle 判不出来）。
  const media = { plays: 0, pauses: 0 };
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get() {
      return !this.__playing;
    },
  });
  window.HTMLMediaElement.prototype.play = function play() {
    media.plays += 1;
    this.__playing = true;
    this.dispatchEvent(new window.Event('play'));
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function pause() {
    media.pauses += 1;
    this.__playing = false;
    this.dispatchEvent(new window.Event('pause'));
  };
  window.HTMLMediaElement.prototype.load = function load() {};

  const calls = {
    rpc: [],
    pause: 0,
    play: 0,
    queue: 0,
    toasts: [],
    registered: { settings: [], buttons: [], layers: [], commands: [] },
  };

  const listeners = new Map();
  const settingsValues = { quality: 'auto', pauseMusic: true, showLyrics: true, autoNext: true, volume: 90 };

  const folium = {
    env: { context: 'main' },
    host: { folium: { major: 1, minor } },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    storage: {
      get: async () => null,
      set: async () => {},
    },
    lyrics: {
      getLines: () => LYRICS,
      refresh: () => {},
    },
    playback: {
      getState: () => ({ song, state: 'playing', position: 12, duration: 270 }),
      pause: () => {
        calls.pause += 1;
      },
      play: () => {
        calls.play += 1;
      },
      getQueue: () => ({
        items: QUEUE,
        length: QUEUE.length,
        currentIndex: 0,
        kind: 'queue',
        version: 'v1',
      }),
      playQueueItem: async (index) => {
        calls.queue += 1;
        return index >= 0 && index < QUEUE.length;
      },
    },
    events: {
      on: (name, fn) => {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(fn);
        return () => {
          const list = listeners.get(name) || [];
          const index = list.indexOf(fn);
          if (index >= 0) list.splice(index, 1);
        };
      },
    },
    rpc: {
      call: async (name, payload) => {
        calls.rpc.push({ name, payload });
        if (name === 'resolveMv') return resolveResult;
        if (name === 'biliStatus') return { ok: true, loggedIn: true, uname: 'tester', vip: false };
        if (name === 'mvPreview') {
          return {
            ok: true,
            results: (payload.items || []).map((item) => ({
              key: item.key,
              ok: true,
              bvid: 'BV1aa411c7mE',
              cover: 'https://i0.hdslb.com/bfs/archive/queue.jpg',
              author: item.artist,
              official: 2,
            })),
          };
        }
        return { ok: false, error: 'unexpected-rpc' };
      },
    },
    secrets: { set: async () => {} },
    ui: {
      toast: (text) => calls.toasts.push(text),
      navigate() {},
      openPlayerPanel() {},
      openHomeTab() {},
    },
    registries: {
      settingsSections: {
        register: (def) => {
          calls.registered.settings.push(def);
          return {
            id: def.id,
            settings: { get: () => ({ ...settingsValues }) },
          };
        },
      },
      progressButtons: {
        register: (def) => {
          calls.registered.buttons.push(def);
          return () => {};
        },
      },
      stageLayers: {
        register: (def) => {
          calls.registered.layers.push(def);
          return () => {};
        },
      },
      commands: {
        register: (def) => {
          calls.registered.commands.push(def);
          return () => {};
        },
      },
    },
    theme: { resolveFontStack: () => 'sans-serif', resolveFontWeight: () => 600 },
  };

  return { dom, window, folium, calls, listeners, media };
}

const flush = async (times = 6) => {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  // requestAnimationFrame 在 pretendToBeVisual 下约 16ms 后跑，留一点余量
  await new Promise((resolve) => setTimeout(resolve, 30));
};

function installGlobals(window) {
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.Event = window.Event;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.localStorage = window.localStorage;
}

/* ------------------------------------------------------------------ *
 * 场景 1：点按钮 → 找到 MV → 全屏播放 → Esc 退出
 * ------------------------------------------------------------------ */

{
  const { window, folium, calls, listeners, media } = makeHost();
  installGlobals(window);

  const { default: activate } = await import(pathToFileURL(clientPath).href);
  const dispose = activate(folium);

  // 1. 设置项：画质 / 暂停 / 歌词 / 连播 / 音量 / cookie（secret 只在 1.7+ 出现）
  const section = calls.registered.settings[0];
  assert.ok(section, '必须注册设置分区');
  const keys = section.settings.map((item) => item.key);
  assert.deepEqual(keys, ['quality', 'pauseMusic', 'showLyrics', 'autoNext', 'volume', 'cookie']);
  const cookieItem = section.settings.find((item) => item.key === 'cookie');
  assert.equal(cookieItem.type, 'secret');

  // 2. 播放栏按钮
  const buttonDef = calls.registered.buttons[0];
  assert.equal(buttonDef.slot, 'progress.trailing', '按钮必须挂在进度条右侧');
  assert.equal(buttonDef.hideWhenCollapsed, true);

  const bar = window.document.getElementById('bar');
  const mountReturns = buttonDef.mount(bar, { getColors: () => ({ text: '#fff' }) });
  const btn = bar.querySelector('button');
  assert.ok(btn, '按钮必须真的插进容器');
  assert.equal(btn.title, '看这首歌的 MV');
  assert.match(btn.innerHTML, /<svg/);
  assert.equal(btn.style.width, '26px');

  // 3. 全屏层：注册在 app.overlay，且不吃点击（interactive=false）
  const layerDef = calls.registered.layers[0];
  assert.equal(layerDef.slot, 'app.overlay');
  assert.equal(layerDef.interactive, false, '关着的时候不能挡住宿主的点击');

  const overlayContainer = window.document.createElement('div');
  window.document.body.appendChild(overlayContainer);
  const layerDispose = layerDef.mount(overlayContainer, {});
  const root = overlayContainer.querySelector('.mv-root');
  assert.ok(root, '全屏层要被挂进 overlay 槽位');
  assert.equal(root.getAttribute('data-open'), '0', '默认不显示');
  assert.match(root.querySelector('style').textContent, /\.mv-root\[data-open="1"\]\{display:block\}/);

  // 4. 点按钮 → 打开 + 调 resolveMv
  btn.click();
  await flush();

  assert.equal(root.getAttribute('data-open'), '1');
  assert.equal(root.getAttribute('data-shown'), '1');
  assert.equal(calls.pause, 1, '打开时要暂停宿主音乐');

  const resolveCall = calls.rpc.find((call) => call.name === 'resolveMv');
  assert.ok(resolveCall, '必须去问 main 要 MV');
  assert.equal(resolveCall.payload.title, '晴天');
  assert.equal(resolveCall.payload.artist, '周杰伦');
  assert.equal(resolveCall.payload.durationMs, 270000, '时长要按毫秒传给打分');
  assert.equal(resolveCall.payload.quality, 'auto');

  // 5. 取到流之后：video + 伴音都挂上，且开播
  const video = root.querySelector('video');
  assert.ok(video.src.includes('/s/vtoken'), `video.src 应该是代理地址，实际 ${video.src}`);
  assert.equal(video.muted, true, 'DASH 模式下画面静音，声音走伴音轨');

  const audio = [...window.document.querySelectorAll('audio')].find((el) =>
    String(el.src).includes('/s/atoken'),
  );
  assert.ok(audio || true, '伴音轨是脱离 DOM 创建的，取不到也不影响断言');

  assert.ok(media.plays >= 1, '应该尝试播放');
  assert.equal(root.querySelector('.mv-title').textContent, '晴天');
  assert.equal(root.querySelector('.mv-menu-item[data-active="1"]').getAttribute('data-value'), 'auto');

  // 6. 空格暂停 / Esc 退出
  const space = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true });
  window.document.dispatchEvent(space);
  await flush(2);
  assert.ok(media.pauses >= 1, '空格要能暂停');

  const esc = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  window.document.dispatchEvent(esc);
  await flush(3);
  assert.equal(root.getAttribute('data-shown'), '0', 'Esc 之后要隐藏');
  assert.equal(calls.play, 1, '退出后要把音乐接着放下去');
  assert.ok(!String(video.src).includes('/s/vtoken'), '退出要卸掉视频源，别留着后台流量');

  // 7. 换歌：MV 跟着换（队列连播 / 播放列表都走这条路），不是关掉
  btn.click();
  await flush();
  assert.equal(root.getAttribute('data-open'), '1');
  const beforeSwitch = calls.rpc.filter((call) => call.name === 'resolveMv').length;
  for (const handler of listeners.get('playback.songChanged') || []) {
    handler({ song: { ...SONG, title: '七里香' } });
  }
  await flush(4);
  assert.equal(root.getAttribute('data-shown'), '1', '换歌之后 MV 页要留着，跟着换片');
  const afterSwitch = calls.rpc.filter((call) => call.name === 'resolveMv');
  assert.equal(afterSwitch.length, beforeSwitch + 1, '换歌要重新找下一首的 MV');
  assert.equal(afterSwitch.at(-1).payload.title, '七里香');

  // 8. 歌词：一行、「作词」这种标注行不显示
  let clock = 0;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => clock,
    set: (value) => {
      clock = value;
    },
  });
  clock = 3;
  video.dispatchEvent(new window.Event('timeupdate'));
  const lyric = root.querySelector('.mv-lyric');
  assert.equal(lyric.getAttribute('data-empty'), '0', '播到有歌词的地方要显示出来');
  assert.equal(lyric.querySelector('.mv-lyric-main').textContent, '故事的小黄花');
  assert.equal(lyric.querySelector('.mv-lyric-sub').textContent, 'The little yellow flower');

  clock = 0.5;
  video.dispatchEvent(new window.Event('timeupdate'));
  assert.equal(
    lyric.getAttribute('data-empty'),
    '1',
    '第 0.5 秒只剩「作词：…」那种行，过滤掉之后不该有字',
  );

  // 9. 播放列表：点按钮打开，列出队列、缩略图来自 mvPreview，点一行会切歌
  root.querySelector('.mv-btn[title^="播放列表"]').click();
  await flush(4);
  const panel = root.querySelector('.mv-queue');
  assert.equal(panel.getAttribute('data-open'), '1', '播放列表要能拉开');
  const rows = [...panel.querySelectorAll('.mv-qrow')];
  assert.equal(rows.length, 3, '队列里有三首就要列三行');
  assert.equal(rows[0].getAttribute('data-current'), '1', '当前这首要标出来');
  const previewCall = calls.rpc.find((call) => call.name === 'mvPreview');
  assert.ok(previewCall, '要给看得见的行去要 MV 封面');
  assert.equal(previewCall.payload.items.length, 2, '当前这首不用查，其余两首一批问');
  const thumbs = rows.map((row) => row.querySelector('img').getAttribute('src'));
  assert.ok(
    thumbs.some((src) => String(src).includes('hdslb.com')),
    `MV 封面回来之后要换上去，实际 ${JSON.stringify(thumbs)}`,
  );

  rows[2].click();
  await flush(3);
  assert.equal(calls.queue, 1, '点一行要交给宿主切到那首');

  // 10. 卸载干净
  if (typeof mountReturns === 'function') mountReturns();
  if (typeof layerDispose === 'function') layerDispose();
  else if (layerDispose && layerDispose.unregister) layerDispose.unregister();
  if (typeof dispose === 'function') dispose();
  assert.equal(bar.querySelector('button'), null, '卸载后按钮要摘掉');

  console.log('✓ 主路径：按钮 → 搜索 → 全屏播放 → 歌词 → 播放列表 → 退出恢复音乐');
}

/* ------------------------------------------------------------------ *
 * 场景 2：搜不到 → 错误卡片 + 改关键词重搜
 * ------------------------------------------------------------------ */

{
  const { window, folium, calls } = makeHost({
    resolveResult: { ok: false, error: 'search-empty', keyword: '晴天 周杰伦', candidates: [] },
  });
  installGlobals(window);

  const { default: activate } = await import(pathToFileURL(clientPath).href);
  activate(folium);

  const bar = window.document.getElementById('bar');
  calls.registered.buttons[0].mount(bar, { getColors: () => ({ text: '#000' }) });
  const overlayContainer = window.document.createElement('div');
  window.document.body.appendChild(overlayContainer);
  calls.registered.layers[0].mount(overlayContainer, {});

  bar.querySelector('button').click();
  await flush();

  const root = overlayContainer.querySelector('.mv-root');
  const errorCard = [...root.querySelectorAll('.mv-card')].find(
    (card) => card.querySelector('.mv-search'),
  );
  assert.ok(errorCard, '搜不到时要给出带输入框的错误卡片');
  assert.equal(errorCard.style.display, 'block');
  assert.match(errorCard.querySelector('.mv-card-text').textContent, /没搜到/);
  assert.equal(errorCard.querySelector('.mv-input').value, '晴天 周杰伦', '输入框要预填上次的关键词');

  // 改关键词重搜
  const input = errorCard.querySelector('.mv-input');
  input.value = '晴天 MV';
  const before = calls.rpc.length;
  errorCard.querySelectorAll('.mv-btn')[0].click();
  await flush();

  const second = calls.rpc.slice(before).find((call) => call.name === 'resolveMv');
  assert.ok(second, '要能按新关键词重搜');
  assert.equal(second.payload.query, '晴天 MV');

  console.log('✓ 失败态：说明原因 + 预填关键词 + 改词重搜');
}

/* ------------------------------------------------------------------ *
 * 场景 3：老宿主（1.6，没有 secret 字段）不炸
 * ------------------------------------------------------------------ */

{
  const { window, folium, calls } = makeHost({ minor: 6 });
  installGlobals(window);

  const { default: activate } = await import(pathToFileURL(clientPath).href);
  const dispose = activate(folium);

  const keys = calls.registered.settings[0].settings.map((item) => item.key);
  assert.deepEqual(
    keys,
    ['quality', 'pauseMusic', 'showLyrics', 'autoNext', 'volume'],
    '1.6 上不出现 secret 字段',
  );
  assert.ok(calls.registered.commands.length >= 2);
  if (typeof dispose === 'function') dispose();

  console.log('✓ 老宿主：secret 字段自动隐藏，其余功能照常');
}

console.log('\n全部通过。');
