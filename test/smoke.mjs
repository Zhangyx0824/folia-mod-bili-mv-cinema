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
    queueIndex: null,
    toasts: [],
    fullscreen: 0,
    registered: { settings: [], buttons: [], layers: [], commands: [] },
  };

  // 宿主的 preload 会暴露 window.electron：右上角那个全屏按钮按的就是它。
  let fullscreenOn = false;
  const fullscreenWatchers = [];
  window.electron = {
    toggleFullscreenWindow: async () => {
      calls.fullscreen += 1;
      fullscreenOn = !fullscreenOn;
      for (const fn of fullscreenWatchers) fn(fullscreenOn);
      return fullscreenOn;
    },
    isWindowFullscreen: async () => fullscreenOn,
    onWindowFullscreenChanged: (fn) => {
      fullscreenWatchers.push(fn);
      return () => {
        const index = fullscreenWatchers.indexOf(fn);
        if (index >= 0) fullscreenWatchers.splice(index, 1);
      };
    },
  };

  const listeners = new Map();
  const settingsValues = {
    quality: 'auto',
    pauseMusic: true,
    autoNext: true,
    volume: 90,
  };

  const folium = {
    env: { context: 'main' },
    host: { folium: { major: 1, minor } },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    storage: {
      get: async () => null,
      set: async () => {},
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
        calls.queueIndex = index;
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
 * 场景 1：点按钮 → 找到 MV → 全屏播放 → 播放列表 → Esc 退出
 * ------------------------------------------------------------------ */

{
  const { window, folium, calls, listeners, media } = makeHost();
  installGlobals(window);

  const { default: activate } = await import(pathToFileURL(clientPath).href);
  const dispose = activate(folium);

  // 1. 设置项：暂停 / 连播 / 画质 / 音量 / cookie（secret 只在 1.7+ 出现）
  const section = calls.registered.settings[0];
  assert.ok(section, '必须注册设置分区');
  const keys = section.settings.map((item) => item.key);
  assert.deepEqual(keys, ['pauseMusic', 'autoNext', 'quality', 'volume', 'cookie']);
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

  // 全屏按钮：走宿主的整窗全屏（就是应用右上角那个按钮），进去之后立刻收起标题与控制条
  const expandBtn = root.querySelector('.mv-btn[title="整窗全屏"]');
  assert.ok(expandBtn, '控制条上要有整窗全屏按钮');
  root.removeAttribute('data-idle');
  expandBtn.click();
  await flush(3);
  assert.equal(calls.fullscreen, 1, '全屏要交给宿主窗口，不是 DOM requestFullscreen');
  assert.equal(root.getAttribute('data-fs'), '1');
  assert.equal(root.getAttribute('data-idle'), '1', '进全屏后标题与控制条要收起来');

  // 第一次 Esc 只退全屏，影院还在
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(3);
  assert.equal(calls.fullscreen, 2, 'Esc 先退全屏');
  assert.equal(root.getAttribute('data-fs'), '0');
  assert.equal(root.getAttribute('data-shown'), '1', '退全屏不该把 MV 关掉');

  // 7. 空格暂停 / Esc 退出
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
  assert.equal(rows[0].getAttribute('data-current'), '1', '当前这首要标出来');
  const previewCall = calls.rpc.find((call) => call.name === 'mvPreview');
  assert.ok(previewCall, '要给看得见的行去要 MV 封面');
  assert.equal(previewCall.payload.items.length, 2, '当前这首不用查，其余两首一批问');
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
    ['pauseMusic', 'autoNext', 'quality', 'volume'],
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

console.log('\n全部通过。');
