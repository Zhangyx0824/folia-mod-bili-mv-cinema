/**
 * 冒烟测试：不连 B 站、不碰真宿主，用 jsdom + 假 folium 跑一遍主路径。
 *
 *   node test/smoke.mjs
 *
 * 断言的是「结构 + 状态变迁 + 有没有把宿主搞脏」，不是视觉。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
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

const OK_RESULT = {
  ok: true,
  bvid: 'BV1xx411c7mD',
  typename: 'MV',
  official: 2,
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
function makeHost({
  minor = 9,
  resolveResult = OK_RESULT,
  song = SONG,
  internals = null,
  queueItems = QUEUE,
  stored = {},
} = {}) {
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

  // jsdom 没有 IntersectionObserver。给一个能手动「报可见」的替身：
  // 模组的封面是「滚进可视区才去问」，测试要能控制哪一行算滚进来了。
  const observers = [];
  class FakeIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options || {};
      this.targets = new Set();
      observers.push(this);
    }
    observe(el) {
      this.targets.add(el);
    }
    unobserve(el) {
      this.targets.delete(el);
    }
    disconnect() {
      this.targets.clear();
    }
    /** 测试用：把这几行当成「刚滚进可视区」。 */
    emit(elements) {
      const entries = elements.map((target) => ({ target, isIntersecting: true }));
      if (entries.length) this.callback(entries, this);
    }
  }
  window.IntersectionObserver = FakeIntersectionObserver;
  globalThis.IntersectionObserver = FakeIntersectionObserver;

  const calls = {
    rpc: [],
    pause: 0,
    play: 0,
    queue: 0,
    queueIndex: null,
    toasts: [],
    storageGet: [],
    storageSet: [],
    registered: { settings: [], buttons: [], layers: [], commands: [] },
  };

  /* 不再 mock 宿主 preload 的私有全屏通道：模组里已经完全没有这条依赖。
   * 假 host 只暴露 Folium 的公开 folium.storage（音量 / 挑片记录 / 封面缓存都走它）。 */

  const listeners = new Map();
  const settingsValues = {
    quality: 'auto',
    pauseMusic: true,
    autoNext: true,
    volume: 90,
  };

  const folium = {
    env: { context: 'main' },
    host: { folium: { major: 1, minor }, folia: '0.8.0' },
    // 0.8.0 的 song DTO 只剩 id/title/artist/album/source/ref，时长与封面在这里
    internals: internals || undefined,
    log: { info() {}, warn() {}, error() {}, debug() {} },
    storage: {
      get: async (key) => {
        calls.storageGet.push(key);
        return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null;
      },
      set: async (key, value) => {
        calls.storageSet.push({ key, value });
        stored[key] = value;
      },
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
        items: queueItems,
        length: queueItems.length,
        currentIndex: 0,
        kind: 'queue',
        version: 'v1',
      }),
      playQueueItem: async (index) => {
        calls.queue += 1;
        calls.queueIndex = index;
        return index >= 0 && index < queueItems.length;
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
        if (name === 'searchCandidates') {
          return {
            ok: true,
            keyword: payload.query,
            candidates: [
              {
                bvid: 'BV1oo411c7mF',
                title: '周杰伦 - 晴天（官方 MV）',
                author: '周杰伦',
                cover: 'https://i0.hdslb.com/bfs/archive/alt.jpg',
                duration: '4:29',
                score: 92,
                official: 2,
              },
              {
                bvid: 'BV1pp411c7mG',
                title: '晴天 现场版',
                author: '某电视台',
                cover: '',
                duration: '3:10',
                score: 41,
              },
            ],
          };
        }
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

  return { dom, window, folium, calls, listeners, media, observers };
}

const flush = async (times = 6) => {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  // requestAnimationFrame 在 pretendToBeVisual 下约 16ms 后跑；封面请求还有 90ms 的合批防抖
  await new Promise((resolve) => setTimeout(resolve, 200));
};

function installGlobals(window) {
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.Event = window.Event;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.localStorage = window.localStorage;
}

/* ------------------------------------------------------------------ *
 * 场景 1：点按钮 → 找到 MV → 全屏播放 → 播放列表 → Esc 退出
 * ------------------------------------------------------------------ */

{
  const { window, folium, calls, listeners, media, observers } = makeHost();
  installGlobals(window);

  const { default: activate } = await import(pathToFileURL(clientPath).href);
  const dispose = activate(folium);

  // 1. 设置项：暂停 / 连播 / 画质 / 音量 / cookie（secret 只在 1.7+ 出现）
  const section = calls.registered.settings[0];
  assert.ok(section, '必须注册设置分区');
  const keys = section.settings.map((item) => item.key);
  assert.deepEqual(keys, ['pauseMusic', 'autoNext', 'inlineButton', 'quality', 'volume', 'cookie']);
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

  // 歌词 / 弹幕这些「叠在画面上的东西」已经整块拿掉了，控制条上不该再出现
  assert.equal(root.querySelector('.mv-lyric'), null, '不该再有歌词层');
  assert.equal(root.querySelector('.mv-dmk'), null, '不该再有弹幕层');
  assert.equal(root.querySelector('.mv-dmkbar'), null, '不该再有发弹幕栏');

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
  assert.equal(
    calls.rpc.filter((call) => /^(mvDanmaku|mvSendDanmaku)$/.test(call.name)).length,
    0,
    '不该再调弹幕接口',
  );

  // 5. 取到流之后：video + 伴音都挂上，且开播
  const video = root.querySelector('video');
  assert.ok(video.src.includes('/s/vtoken'), `video.src 应该是代理地址，实际 ${video.src}`);
  assert.equal(video.muted, true, 'DASH 模式下画面静音，声音走伴音轨');

  assert.ok(media.plays >= 1, '应该尝试播放');
  assert.equal(root.querySelector('.mv-title').textContent, '晴天');
  assert.equal(root.querySelector('.mv-menu-item[data-active="1"]').getAttribute('data-value'), 'auto');

  // 6. 点画面本身就能暂停 / 继续（不用去够左下角那个按钮）
  const clickPicture = () => video.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(video.paused, false, '这会儿应该正在播');
  clickPicture();
  await flush(2);
  assert.equal(video.paused, true, '点画面要暂停');
  clickPicture();
  await flush(2);
  assert.equal(video.paused, false, '再点一下要接着播');

  // 点控件不算点画面（不然调个静音都会顺手把片子暂停了）
  root.querySelector('.mv-btn[title="静音"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush(2);
  assert.equal(video.paused, false, '点控件不该暂停画面');

  // 审核整改：整窗全屏按钮已去掉，控制条不该再出现私有全屏通道的入口
  assert.equal(
    root.querySelector('.mv-btn[title="整窗全屏"]'),
    null,
    '控制条不该再有整窗全屏按钮（宿主 preload 私有接口已整条移除）',
  );
  assert.equal(root.getAttribute('data-fs'), null, '不该再维护整窗全屏状态');

  // 音量：改动写进 folium.storage，宿主页面的 localStorage 一个字节都不碰
  const volumeRange = root.querySelector('.mv-range');
  assert.ok(volumeRange, '控制条上要有音量滑块');
  volumeRange.value = '35';
  volumeRange.dispatchEvent(new window.Event('input', { bubbles: true }));
  await flush(2);
  assert.ok(calls.storageGet.includes('volume'), '打开时要从 folium.storage 读回音量');
  const volumeWrite = calls.storageSet.find((entry) => entry.key === 'volume');
  assert.ok(volumeWrite, '音量改动要写进 folium.storage');
  assert.equal(volumeWrite.value, 0.35, '存的应是 0~1 的音量值');
  assert.equal(window.localStorage.length, 0, '不该再写宿主页面的 localStorage');

  // 7. 空格暂停 / Esc 退出
  // jsdom 的媒体桩只派 play、不派 playing：补一次，模组才会认为已经进了播放态
  video.dispatchEvent(new window.Event('playing'));
  await flush(1);
  const space = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true });
  window.document.dispatchEvent(space);
  await flush(2);
  assert.ok(media.pauses >= 1, '空格要能暂停');
  assert.equal(root.getAttribute('data-idle'), null, '刚暂停时控件要亮着');
  // 暂停后停手 3 秒：进度条 / 音量这些也要自己收起来，跟播放时一样
  await new Promise((resolve) => setTimeout(resolve, 3000));
  assert.equal(root.getAttribute('data-idle'), '1', '暂停时控件也要自动隐藏');

  const esc = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  window.document.dispatchEvent(esc);
  await flush(3);
  assert.equal(root.getAttribute('data-shown'), '0', 'Esc 之后要隐藏');
  assert.equal(calls.play, 1, '退出后要把音乐接着放下去');
  assert.ok(!String(video.src).includes('/s/vtoken'), '退出要卸掉视频源，别留着后台流量');

  // 7. 换歌：MV 跟着换，不是关掉
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

  // 8. 播放列表：点按钮打开，列出队列、缩略图来自 mvPreview
  root.querySelector('.mv-btn[title^="播放列表"]').click();
  await flush(4);
  const panel = root.querySelector('.mv-queue');
  assert.equal(panel.getAttribute('data-open'), '1', '播放列表要能拉开');
  const rows = [...panel.querySelectorAll('.mv-qrow')];
  assert.equal(rows.length, 3, '队列里有三首就要列三行');
  assert.equal(rows[1].getAttribute('data-current'), '1', '当前这首（屏幕上演的七里香）要标出来');
  // 封面没到之前不是一块灰：每一格都有一个「胶片 + 播放」的占位图标
  for (const row of rows) {
    assert.ok(row.querySelector('.mv-qph svg'), '没有封面时要有占位图标');
  }

  const keysAsked = () =>
    calls.rpc
      .filter((call) => call.name === 'mvPreview')
      .flatMap((call) => (call.payload.items || []).map((item) => item.key));

  // 一拉开列表还不该朝 B 站打一串搜索：只有真的滚进可视区的那几行才问。
  assert.equal(keysAsked().length, 0, '列表刚画出来、还没滚到，就不该去搜封面');

  const io = observers.at(-1);
  assert.ok(io, '要给列表挂一个可见性观察器');
  assert.equal(io.options.root, panel.querySelector('.mv-queue-list'), '以列表本身作滚动容器');

  // 只滚到第三行：只问这一首（前两行手上都有封面：一行是队列当前，一行是屏幕上演的）
  io.emit([rows[2]]);
  await flush(2);
  assert.deepEqual(keysAsked(), ['稻香\u241F周杰伦'], '滚到哪一行就只问那一行');
  assert.ok(!keysAsked().includes('晴天\u241F周杰伦'), '列表里当前那一行不用查，它手上就有封面');
  assert.ok(!keysAsked().includes('七里香\u241F周杰伦'), '屏幕上演的那首也不用查');
  for (const call of calls.rpc.filter((item) => item.name === 'mvPreview')) {
    assert.ok((call.payload.items || []).length <= 3, '一批最多问 3 首，回来一批先贴一批');
  }

  const thumbs = rows.map((row) => row.querySelector('img').getAttribute('src'));
  assert.ok(
    thumbs.some((src) => String(src).includes('hdslb.com')),
    `MV 封面回来之后要换上去，实际 ${JSON.stringify(thumbs)}`,
  );

  // 点第三行：就地放这一行的 MV。
  // 关键：**不许碰宿主** —— 宿主一换歌就会打开它自己的播放页，把 MV 页顶掉。
  const resolveBeforeRow = calls.rpc.filter((call) => call.name === 'resolveMv').length;
  rows[2].click();
  await flush(4);
  assert.equal(calls.queue, 0, '点一行时不要动宿主队列（否则会跳到歌曲播放页）');
  const rowResolve = calls.rpc.filter((call) => call.name === 'resolveMv');
  assert.equal(rowResolve.length, resolveBeforeRow + 1, '点一行只搜一次');
  assert.equal(rowResolve.at(-1).payload.bvid, 'BV1aa411c7mE', '要直接用这行的 bvid 取流');
  assert.equal(rowResolve.at(-1).payload.title, '稻香', '歌名要跟着换成这一行的');
  assert.equal(root.getAttribute('data-shown'), '1', 'MV 页要一直在，不能被顶掉');
  const afterRows = [...panel.querySelectorAll('.mv-qrow')];
  assert.equal(afterRows.length, 3, '整个队列都列出来，能往回点');
  assert.equal(afterRows[0].getAttribute('data-current'), '0', '当前不再是最上面那行');
  assert.equal(afterRows[2].getAttribute('data-current'), '1', '高亮要跟着点到的那一行走');
  assert.equal(afterRows[2].querySelector('.mv-qtitle').textContent, '稻香');

  // 宿主自己换了歌（媒体键等）时，MV 照样跟着换
  for (const handler of listeners.get('playback.songChanged') || []) {
    handler({ song: { ...SONG, title: '稻香' } });
  }
  await flush(3);
  assert.equal(
    calls.rpc.filter((call) => call.name === 'resolveMv').length,
    resolveBeforeRow + 1,
    '同一首歌的 songChanged 不该再搜一遍',
  );

  // 9. 退出时才把宿主挪到刚看的那首（第一次 Esc 先收列表，第二次才退出）
  const esc2 = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  window.document.dispatchEvent(esc2);
  await flush(2);
  assert.equal(panel.getAttribute('data-open'), '0', 'Esc 先收播放列表');
  assert.equal(root.getAttribute('data-shown'), '1', '列表收起来时 MV 还在');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(4);
  assert.equal(root.getAttribute('data-shown'), '0');
  assert.equal(calls.queue, 1, '退出影院才让宿主的队列跟过去');
  assert.equal(calls.queueIndex, 2, '跟到点的那一行');
  assert.equal(calls.play, 2, '退出后音乐从那首接着放');

  // 10. 卸载干净
  if (typeof mountReturns === 'function') mountReturns();
  if (typeof layerDispose === 'function') layerDispose();
  else if (layerDispose && layerDispose.unregister) layerDispose.unregister();
  if (typeof dispose === 'function') dispose();
  assert.equal(bar.querySelector('button'), null, '卸载后按钮要摘掉');

  console.log('✓ 主路径：按钮 → 搜索 → 全屏播放 → 播放列表点播 → 退出恢复音乐');
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
    ['pauseMusic', 'autoNext', 'inlineButton', 'quality', 'volume'],
    '1.6 上不出现 secret 字段',
  );
  assert.ok(calls.registered.commands.length >= 2);
  if (typeof dispose === 'function') dispose();

  console.log('✓ 老宿主：secret 字段自动隐藏，其余功能照常');
}

/* ------------------------------------------------------------------ *
 * 场景 4：换源（同一首歌换另一支 MV）+ 播放列表定位到当前
 * ------------------------------------------------------------------ */

{
  const { window, folium, calls } = makeHost();
  installGlobals(window);

  const { default: activate } = await import(pathToFileURL(clientPath).href);
  const dispose = activate(folium);

  const bar = window.document.getElementById('bar');
  calls.registered.buttons[0].mount(bar, { getColors: () => ({ text: '#fff' }) });
  const overlayContainer = window.document.createElement('div');
  window.document.body.appendChild(overlayContainer);
  calls.registered.layers[0].mount(overlayContainer, {});

  bar.querySelector('button').click();
  await flush();

  const root = overlayContainer.querySelector('.mv-root');
  const queuePanel = root.querySelector('.mv-queue:not(.mv-src)');
  const srcPanel = root.querySelector('.mv-src');
  const video = root.querySelector('video');

  // 1. 播放列表：标题栏上有「定位到正在看的这首」
  const locate = queuePanel.querySelector('.mv-btn[title="定位到正在看的这首"]');
  assert.ok(locate, '播放列表要能一键定位到正在看的那首');

  root.querySelector('.mv-btn[title^="播放列表"]').click();
  await flush(3);
  assert.equal(queuePanel.getAttribute('data-open'), '1');
  assert.equal(root.getAttribute('data-side'), '1', '抽屉拉开时控件要让出右边');

  const currentRow = queuePanel.querySelector('.mv-qrow[data-current="1"]');
  assert.ok(currentRow, '当前这首要高亮');
  locate.click();
  await flush(2);
  assert.equal(currentRow.getAttribute('data-flash'), '1', '定位之后要闪一下，眼睛才跟得上');

  // 2. 换源：列表旁边那个按钮，点开是同一首歌的其他 MV
  const switchBtn = root.querySelector('.mv-btn[title^="换一个 MV 源"]');
  assert.ok(switchBtn, '控制条上要有换源按钮');
  switchBtn.click();
  await flush(3);
  assert.equal(srcPanel.getAttribute('data-open'), '1', '换源抽屉要能拉开');
  assert.equal(queuePanel.getAttribute('data-open'), '0', '两个抽屉同一块地方，不能叠着');
  assert.equal(root.getAttribute('data-side'), '1', '抽屉换了一个，控件还在右边让位');

  const firstRows = [...srcPanel.querySelectorAll('.mv-srow')];
  assert.equal(firstRows.length, 1, '手上只有一个候选就先列一个');
  assert.equal(firstRows[0].getAttribute('data-current'), '1', '正在看的这支要标出来');
  assert.ok(firstRows[0].querySelector('.mv-srow-now'), '要有「正在看」的字样');

  // 3. 换个关键词重搜，从结果里挑另一支
  const srcInput = srcPanel.querySelector('input');
  srcInput.value = '晴天 MV';
  srcInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await flush(4);

  const searchCall = calls.rpc.find((call) => call.name === 'searchCandidates');
  assert.ok(searchCall, '换源面板要能自己搜');
  assert.equal(searchCall.payload.query, '晴天 MV');
  assert.equal(searchCall.payload.artist, '周杰伦', '搜索时带上歌手名，命中率更高');

  const rowsAfter = [...srcPanel.querySelectorAll('.mv-srow')];
  assert.equal(rowsAfter.length, 3, '正在看的那支补在最前面，再加两条搜索结果');
  assert.equal(rowsAfter[0].getAttribute('data-current'), '1');

  const resolveBefore = calls.rpc.filter((call) => call.name === 'resolveMv').length;
  const otherRow = rowsAfter.find((row) => row.getAttribute('data-bvid') === 'BV1oo411c7mF');
  assert.ok(otherRow, '搜索结果里要有另一支可选');
  otherRow.click();
  await flush(4);

  const picked = calls.rpc.filter((call) => call.name === 'resolveMv');
  assert.equal(picked.length, resolveBefore + 1, '挑一支就取一次流');
  assert.equal(picked.at(-1).payload.bvid, 'BV1oo411c7mF', '要按挑中的那支的 bvid 取流');
  assert.equal(calls.queue, 0, '换源同样不动宿主，别把 MV 页顶掉');
  assert.equal(srcPanel.getAttribute('data-open'), '1', '换完面板还开着，方便再换一支');
  assert.equal(root.getAttribute('data-shown'), '1', 'MV 页要一直在');

  // 4. S 键开合，Esc 先收面板，再按一次才退出
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(2);
  assert.equal(srcPanel.getAttribute('data-open'), '0', 'Esc 先收换源面板');
  assert.equal(root.getAttribute('data-shown'), '1', '收面板不该退出影院');

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', bubbles: true }));
  await flush(2);
  assert.equal(srcPanel.getAttribute('data-open'), '1', 'S 键也能开合换源面板');

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(2);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(4);
  assert.equal(root.getAttribute('data-shown'), '0', '再按一次退出影院');
  assert.ok(!String(video.src).includes('/s/vtoken'), '退出要卸掉视频源');

  if (typeof dispose === 'function') dispose();

  console.log('✓ 换源：列候选 → 自己搜 → 挑一支直接播；播放列表能定位到当前');
}

/* ------------------------------------------------------------------ *
 * 场景 5：宿主搜索列表里的 MV 图标
 * ------------------------------------------------------------------ */

{
  const { window, folium, calls } = makeHost();
  installGlobals(window);

  const { default: activate } = await import(pathToFileURL(clientPath).href);
  const dispose = activate(folium);

  // 全屏层要像宿主那样挂一次，MV 页才会进 DOM
  const stage = window.document.createElement('div');
  window.document.body.appendChild(stage);
  for (const layer of calls.registered.layers) layer.mount(stage);

  // 复刻宿主搜索结果的一行（结构来自真机 dump：.search-row > 封面 / 文本 / 时长 / 操作）
  const row = window.document.createElement('div');
  row.className = 'search-row';
  row.innerHTML = `
    <span class="search-row-index">01</span>
    <button class="search-row-cover"><img><span class="search-row-play"></span></button>
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2"><button><span>晴天</span></button></div>
      <div class="mt-1 flex"><span><button>周杰伦</button></span><button>叶惠美</button></div>
    </div>
    <span class="font-mono text-xs">4:29</span>
    <button class="search-row-action"></button>
    <button class="search-row-action"></button>`;
  window.document.body.appendChild(row);

  await flush(4);

  const inline = row.querySelector('.mv-row-btn');
  assert.ok(inline, '搜索结果的每一行要长出一个 MV 图标');
  assert.match(inline.title, /晴天/, '图标要说明是哪首歌的 MV');
  assert.equal(row.getAttribute('data-mv-row'), '1', '同一行别重复插');
  assert.equal(
    row.querySelectorAll('.mv-row-btn').length,
    1,
    '重扫一次也只留一个图标（宿主列表会频繁重渲染）',
  );

  // 点图标：直接进影院找这首的 MV，且**不动宿主**
  inline.click();
  await flush(4);
  const resolveCalls = calls.rpc.filter((call) => call.name === 'resolveMv');
  assert.equal(resolveCalls.length, 1, '点图标要就地去找 MV');
  assert.equal(resolveCalls[0].payload.title, '晴天', '歌名从这一行读');
  assert.equal(resolveCalls[0].payload.artist, '周杰伦', '歌手也从这一行读');
  assert.equal(resolveCalls[0].payload.durationMs, 269000, '时长同样跟着这一行');
  assert.equal(calls.queue, 0, '点图标不能切歌（否则会跳到宿主播放页）');
  assert.equal(calls.pause, 1, '看 MV 时按设置把音乐压住');
  const root = window.document.querySelector('.mv-root');
  assert.equal(root.getAttribute('data-shown'), '1', 'MV 页要在屏幕上');

  // 关掉开关：图标收回去
  window.document.body.appendChild(window.document.createElement('div'));
  if (typeof dispose === 'function') dispose();
  assert.equal(window.document.querySelectorAll('.mv-row-btn').length, 0, '退出时把自己的图标摘干净');

  console.log('✓ 搜索列表：行内 MV 图标 → 就地看这支 MV，不动宿主播放');
}

/* ------------------------------------------------------------------ *
 * 场景 6：播放器侧栏「播放列表」里的 MV 图标
 * ------------------------------------------------------------------ */

{
  const { window, folium, calls } = makeHost();
  installGlobals(window);

  const { default: activate } = await import(pathToFileURL(clientPath).href);
  const dispose = activate(folium);

  const stage = window.document.createElement('div');
  window.document.body.appendChild(stage);
  for (const layer of calls.registered.layers) layer.mount(stage);

  // 复刻真机 dump：侧栏面板 → 虚拟列表的队列行（带 data-active / 队列下标）
  const panel = window.document.createElement('div');
  panel.className = 'dock-companion dock-companion--panel-surface';
  const scroller = window.document.createElement('div');
  scroller.className = 'st-scroll';
  panel.appendChild(scroller);
  window.document.body.appendChild(panel);

  const row = window.document.createElement('div');
  row.setAttribute('data-active', 'false');
  row.setAttribute('data-react-window-index', '1');
  row.setAttribute('aria-posinset', '2');
  row.setAttribute('role', 'listitem');
  row.className =
    'st-t-fast group flex cursor-pointer items-center rounded-lg pl-3 pr-1.5 transition-colors';
  row.innerHTML = `
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2 text-[13px] leading-[19px]"><span class="truncate">七里香</span></div>
      <div class="truncate text-xs leading-[17px]">周杰伦</div>
    </div>
    <div class="st-t-fast flex w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0">
      <span><button></button></span>
    </div>`;
  scroller.appendChild(row);

  await flush(4);

  const inline = row.querySelector('.mv-row-btn');
  assert.ok(inline, '播放器队列的每一行也要长出 MV 图标');
  assert.match(inline.title, /七里香/, '图标要说明是哪首歌的 MV');
  assert.equal(inline.style.width, '28px', '侧栏行用 28×28 的小方钮，跟宿主那排图标一致');
  assert.equal(inline.style.borderRadius, '8px', '侧栏行用圆角方钮，不是搜索行的圆形大钮');
  assert.ok(row.getAttribute('data-mv-song'), '记下这一行装的是哪首歌');
  assert.equal(row.querySelectorAll('.mv-row-btn').length, 1, '重扫也只留一个图标');

  // 虚拟列表会复用同一个 DOM 节点：换成下一首，图标得跟着换
  row.setAttribute('data-react-window-index', '2');
  row.querySelector('span.truncate').textContent = '稻香';
  row.appendChild(window.document.createElement('span')); // 触发一次子树变化
  await flush(4);
  assert.match(row.querySelector('.mv-row-btn').title, /稻香/, '复用行时要换成新歌');
  assert.equal(row.querySelectorAll('.mv-row-btn').length, 1, '换歌后仍只有一个图标');

  // 点图标：拿宿主队列里的完整 song（含时长）去找 MV，不切歌
  row.querySelector('.mv-row-btn').click();
  await flush(4);
  const resolveCalls = calls.rpc.filter((call) => call.name === 'resolveMv');
  assert.equal(resolveCalls.length, 1, '点图标要就地去找 MV');
  assert.equal(resolveCalls[0].payload.title, '稻香', '歌名用宿主队列里的');
  assert.equal(resolveCalls[0].payload.artist, '周杰伦', '歌手也用宿主队列里的');
  assert.equal(resolveCalls[0].payload.durationMs, 270000, '时长从宿主队列补齐（行上没有 mm:ss）');
  assert.equal(calls.queue, 0, '点图标不能切歌');

  if (typeof dispose === 'function') dispose();
  assert.equal(window.document.querySelectorAll('.mv-row-btn').length, 0, '退出时把自己的图标摘干净');

  console.log('✓ 播放器队列：行内 MV 图标 → 就地看这支 MV，不动宿主播放');
}

/* ------------------------------------------------------------------ *
 * 场景 7：0.8.0 的 song DTO（只剩 id/title/artist/album/source/ref）
 * ------------------------------------------------------------------ */

{
  // 0.8.0 起宿主给模组的 DTO：没有 duration、没有封面、artist 是字符串
  const dtoSong = {
    id: '97773',
    title: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    source: 'qq',
    ref: 'song-c9',
  };
  // 宿主内部那份还是完整的（时长 / 多歌手 / 专辑封面都在）
  const richSong = {
    id: 97773,
    name: '晴天',
    artists: [{ name: '周杰伦' }],
    album: { name: '叶惠美', coverUrl: 'https://y.gtimg.cn/music/photo_new/T002.jpg' },
    durationMs: 269746,
  };
  const dtoNext = {
    id: '185809',
    title: '七里香',
    artist: '周杰伦',
    album: '七里香',
    source: 'qq',
    ref: 'song-7',
  };
  const richNext = {
    id: 185809,
    name: '七里香',
    artists: [{ name: '周杰伦' }],
    album: { name: '七里香', coverUrl: 'https://y.gtimg.cn/music/photo_new/T003.jpg' },
    durationMs: 299000,
  };
  const internals = {
    stores: {
      playback: {
        getState: () => ({ currentSong: richSong, playQueue: [richSong, richNext] }),
      },
    },
  };
  const queueItems = [
    { index: 0, song: dtoSong },
    { index: 1, song: dtoNext },
  ];

  const { window, folium, calls } = makeHost({ song: dtoSong, internals, queueItems });
  installGlobals(window);

  const { default: activate } = await import(pathToFileURL(clientPath).href);
  const dispose = activate(folium);

  const stage = window.document.createElement('div');
  window.document.body.appendChild(stage);
  for (const layer of calls.registered.layers) layer.mount(stage);

  const bar = window.document.getElementById('bar');
  calls.registered.buttons[0].mount(bar, { getColors: () => ({ text: '#fff' }) });
  bar.querySelector('button').click();
  await flush(4);

  const resolveCalls = calls.rpc.filter((call) => call.name === 'resolveMv');
  assert.equal(resolveCalls.length, 1);
  assert.equal(resolveCalls[0].payload.title, '晴天');
  assert.equal(resolveCalls[0].payload.artist, '周杰伦', '0.8 的 artist 是字符串，也要读得出来');
  assert.equal(
    resolveCalls[0].payload.durationMs,
    269746,
    'DTO 里没有时长，要从宿主内部队列补齐（时长是挑片的一条硬信号）',
  );

  const root = window.document.querySelector('.mv-root');
  // jsdom 量不到按钮位置 → 至少要让开宿主顶栏那 32px（+8px 间距）
  assert.equal(
    root.style.getPropertyValue('--mv-chrome-top'),
    '40px',
    '抽屉标题栏要让开宿主右上角的窗口按钮',
  );

  // 队列列表里也应该看得见时长与封面（都是从内部那份补的）：看第二行的那首待播
  root.querySelector('.mv-btn[title^="播放列表"]').click();
  await flush(3);
  const rows = root.querySelectorAll('.mv-qrow');
  assert.equal(rows.length, 2, '队列两首都列出来');
  const sub = rows[1].querySelector('.mv-qsub');
  assert.match(sub.textContent, /周杰伦/, '歌手照常显示');
  assert.match(sub.textContent, /4:59/, '时长从宿主内部队列补回来了');
  const cover = rows[1].querySelector('.mv-qthumb img');
  assert.match(
    String(cover && cover.getAttribute('src')),
    /T003\.jpg/,
    '封面先用宿主队列里的专辑图顶上',
  );

  if (typeof dispose === 'function') dispose();
  console.log('✓ 0.8.0：song DTO 只剩 id/title/artist，时长与封面从宿主队列补齐');
}

/* ------------------------------------------------------------------ *
 * 场景 8：从搜索列表点进来的 MV 不在宿主队列里
 * 列表要把它置顶成当前项，而不是拿宿主队列的下标去高亮另一首歌；
 * 计数只报列表实际条数，不写「48/439」那种宿主队列位置。
 * ------------------------------------------------------------------ */

{
  const { window, folium, calls } = makeHost();
  installGlobals(window);

  const { default: activate } = await import(pathToFileURL(clientPath).href);
  const dispose = activate(folium);

  const stage = window.document.createElement('div');
  window.document.body.appendChild(stage);
  for (const layer of calls.registered.layers) layer.mount(stage);

  // 宿主队列里是周杰伦三首；搜索到的是完全另一首
  const row = window.document.createElement('div');
  row.className = 'search-row';
  row.innerHTML = `
    <span class="search-row-index">01</span>
    <button class="search-row-cover"><img><span class="search-row-play"></span></button>
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2"><button><span>快点告诉你</span></button></div>
      <div class="mt-1 flex"><span><button>李梦璐</button></span><button>儿歌</button></div>
    </div>
    <span class="font-mono text-xs">3:21</span>
    <button class="search-row-action"></button>`;
  window.document.body.appendChild(row);

  await flush(4);
  row.querySelector('.mv-row-btn').click();
  await flush(4);

  const root = window.document.querySelector('.mv-root');
  root.querySelector('.mv-btn[title^="播放列表"]').click();
  await flush(3);

  const rows = [...root.querySelectorAll('.mv-qrow')];
  assert.equal(rows.length, 4, '置顶那首 + 队列三首');
  assert.match(
    rows[0].querySelector('.mv-qtitle').textContent,
    /快点告诉你/,
    '正在看的那首必须出现在列表里',
  );
  assert.equal(rows[0].getAttribute('data-current'), '1', '置顶那行才是当前');
  assert.equal(
    rows[1].getAttribute('data-current'),
    '0',
    '宿主队列第一首（晴天）不能被误标成当前',
  );

  const count = root.querySelector('.mv-queue-count').textContent;
  assert.equal(count, '4 首', '计数要跟列表条数一致');
  assert.doesNotMatch(count, /\//, '不能写成「48/439」那种宿主队列位置');

  // 点置顶那行：回到这首的开头，而不是去队列里找一首不相干的歌
  const before = calls.queue;
  rows[0].click();
  await flush(2);
  assert.equal(calls.queue, before, '置顶行不能切宿主队列');

  if (typeof dispose === 'function') dispose();
  console.log('✓ 搜索进来的歌不在队列里：列表置顶当前这首，计数只报列表条数');
}

/* ------------------------------------------------------------------ *
 * 场景 9：静态合规扫描 —— 审核明确列为「不收」的私有接口，源码里一个都不能有
 * ------------------------------------------------------------------ */
{
  const source = fs.readFileSync(clientPath, 'utf8');
  const forbidden = [
    'window.electron',
    'toggleFullscreenWindow',
    'isWindowFullscreen',
    'onWindowFullscreenChanged',
    'localStorage',
    'requestFullscreen',
  ];
  for (const token of forbidden) {
    assert.ok(
      !source.includes(token),
      `client.mjs 不该再出现「${token}」：宿主 preload 私有通道与整窗全屏已整条移除`,
    );
  }
  assert.ok(source.includes("folium.storage.get(VOL_KEY)"), '音量要从 folium.storage 读');
  assert.ok(source.includes('folium.storage.set(VOL_KEY'), '音量要写回 folium.storage');
  assert.ok(source.includes("addEventListener('fullscreenchange'"), '要用标准的 fullscreenchange 事件跟随窗口');
  assert.ok(source.includes("addEventListener('resize', syncWindowChrome"), '让位逻辑仍要在 resize 时重算');
  console.log('✓ 静态扫描：client.mjs 不含宿主 preload 私有接口 / localStorage / DOM 全屏调用');
}

/* ------------------------------------------------------------------ *
 * 场景 10：上次存过的音量要能从 folium.storage 读回并生效（异步 get）
 * ------------------------------------------------------------------ */
{
  const { window, folium, calls } = makeHost({ stored: { volume: 0.27 } });
  installGlobals(window);

  const { default: activate } = await import(pathToFileURL(clientPath).href);
  const dispose = activate(folium);

  const stage = window.document.createElement('div');
  window.document.body.appendChild(stage);
  for (const layer of calls.registered.layers) layer.mount(stage);

  const bar = window.document.getElementById('bar');
  calls.registered.buttons[0].mount(bar, { getColors: () => ({ text: '#fff' }) });
  bar.querySelector('button').click();
  await flush(4);

  const root = window.document.querySelector('.mv-root');
  assert.ok(calls.storageGet.includes('volume'), '打开时要读 volume');
  assert.equal(root.querySelector('.mv-range').value, '27', '存过的 0.27 要变回滑块上的 27%');

  // 手动调过音量后，异步读回的旧值不能把它盖掉
  const volumeRange = root.querySelector('.mv-range');
  volumeRange.value = '80';
  volumeRange.dispatchEvent(new window.Event('input', { bubbles: true }));
  await flush(4);
  assert.equal(volumeRange.value, '80', '用户手动调过的音量不能被异步读回覆盖');

  if (typeof dispose === 'function') dispose();
  console.log('✓ 音量：从 folium.storage 异步读回生效，且不覆盖用户手动调整');
}

console.log('\n全部通过。');
