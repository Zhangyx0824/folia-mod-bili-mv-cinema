/**
 * bili-mv-cinema — 客户端入口（渲染进程，ESM）
 *
 * 一个入口 + 一个全屏层。设计原则是「不占地方」：
 *
 *   · 播放栏进度条右侧一个 26px 的 MV 按钮，是全部常驻 UI；
 *   · 点了才去找 MV、才建播放器，退出就把视频源卸掉（不留后台流量）；
 *   · 全屏层挂在宿主公开的 app.overlay 槽位上，不碰容器外任何宿主 DOM；
 *   · 打开时暂停 Folia 的音乐、播 MV 原声，退出把音乐接着放下去。
 *
 * 音画同步：DASH 模式下画面和声音是两条独立流，用 video + audio 双元素，
 * 每 800ms 校一次漂移；muxed 模式（720P 单文件）只有一个元素，天生同步。
 */

import qrcode from './vendor/qrcode.mjs';

// 二维码内容是 ASCII，但用 UTF-8 字节表更保险。
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

const VOL_KEY = 'bili-mv-cinema:volume';

const label = (zh, en) => ({ 'zh-CN': zh, en });

/* ------------------------------------------------------------------ *
 * 图标
 * ------------------------------------------------------------------ */

const ICON_MV = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M10 10.2v3.6l3.4-1.8z" fill="currentColor" stroke="none"/></svg>`;

const ICON_BACK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`;

const ICON_CLOSE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

const ICON_PLAY = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.4v13.2c0 .7.8 1.1 1.4.7l10-6.6c.5-.4.5-1.1 0-1.4l-10-6.6C8.8 4.3 8 4.7 8 5.4z"/></svg>`;

const ICON_PAUSE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.4"/><rect x="13.5" y="5" width="4" height="14" rx="1.4"/></svg>`;

const ICON_VOLUME = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4z"/><path d="M15.6 9.2a4 4 0 010 5.6"/><path d="M18 6.6a7.6 7.6 0 010 10.8"/></svg>`;

const ICON_MUTED = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4z"/><path d="M16.5 9.5l4.5 5M21 9.5l-4.5 5"/></svg>`;

const ICON_EXPAND = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5"/></svg>`;

const ICON_LINK = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 13.5a4 4 0 006 .5l2.2-2.2a4 4 0 00-5.7-5.7l-1.2 1.2"/><path d="M13.5 10.5a4 4 0 00-6-.5L5.3 12.2a4 4 0 005.7 5.7l1.2-1.2"/></svg>`;

const ICON_REPLAY = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a8 8 0 111.8 7.4"/><path d="M4 5v5h5"/></svg>`;

/* ------------------------------------------------------------------ *
 * 样式（全部作用在自己这棵树上，shadow root 里也不会串出去）
 * ------------------------------------------------------------------ */

const CSS = `
.mv-root{position:absolute;inset:0;box-sizing:border-box;background:#000;color:#fff;
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif;
  pointer-events:auto;display:none;opacity:0;transition:opacity .2s ease;overflow:hidden}
.mv-root[data-open="1"]{display:block}
.mv-root[data-shown="1"]{opacity:1}
.mv-root *{box-sizing:border-box}

.mv-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:block}

/* 顶部信息条 */
.mv-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:flex-start;gap:13px;
  padding:20px 24px 44px;background:linear-gradient(to bottom,rgba(0,0,0,.66),rgba(0,0,0,.28) 62%,rgba(0,0,0,0));
  transition:opacity .26s ease;pointer-events:none}
.mv-top>*{pointer-events:auto}
.mv-meta{min-width:0;flex:1;padding-top:2px}
.mv-title{font-size:16px;font-weight:600;line-height:1.35;letter-spacing:.01em;
  text-shadow:0 1px 10px rgba(0,0,0,.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mv-sub{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:rgba(255,255,255,.64);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mv-sub .mv-dot{width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.34);flex:none}
.mv-chip{flex:none;font-size:10px;font-weight:700;letter-spacing:.07em;padding:2px 6px;border-radius:5px;
  background:rgba(251,114,153,.2);color:#ffa8c0;border:1px solid rgba(251,114,153,.28)}

/* 按钮 */
.mv-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.12);
  background:rgba(255,255,255,.09);color:#fff;border-radius:9px;padding:0;cursor:pointer;
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:background .16s,transform .12s,border-color .16s;
  font:inherit;font-size:12px}
.mv-btn:hover{background:rgba(255,255,255,.19);border-color:rgba(255,255,255,.24)}
.mv-btn:active{transform:scale(.95)}
.mv-btn[disabled]{opacity:.4;cursor:default}
.mv-btn.round{width:36px;height:36px;border-radius:50%;flex:none}
.mv-btn.ghost{background:rgba(0,0,0,.34);border-color:rgba(255,255,255,.14)}
.mv-btn.tall{padding:0 11px;height:30px;border-radius:8px}

/* 底部控制条 */
.mv-bottom{position:absolute;left:0;right:0;bottom:0;padding:46px 24px 18px;
  background:linear-gradient(to top,rgba(0,0,0,.78),rgba(0,0,0,.34) 58%,rgba(0,0,0,0));
  transition:opacity .26s ease;pointer-events:none}
.mv-bottom>*{pointer-events:auto}
.mv-progress-row{display:flex;align-items:center;gap:12px}
.mv-time{font-size:11.5px;font-variant-numeric:tabular-nums;color:rgba(255,255,255,.72);min-width:42px;
  text-align:center;font-feature-settings:"tnum"}
.mv-track{position:relative;flex:1;height:18px;display:flex;align-items:center;cursor:pointer;touch-action:none}
.mv-track::before{content:"";position:absolute;left:0;right:0;height:4px;border-radius:3px;background:rgba(255,255,255,.22)}
.mv-fill{position:absolute;left:0;height:4px;border-radius:3px;background:#fff;width:0;pointer-events:none}
.mv-knob{position:absolute;left:0;width:11px;height:11px;border-radius:50%;background:#fff;
  transform:translateX(-50%);box-shadow:0 1px 7px rgba(0,0,0,.55);pointer-events:none;transition:transform .12s}
.mv-track:hover .mv-knob{transform:translateX(-50%) scale(1.18)}
.mv-controls{display:flex;align-items:center;gap:14px;margin-top:6px}
.mv-volume{display:flex;align-items:center;gap:8px}
.mv-range{-webkit-appearance:none;appearance:none;width:86px;height:16px;background:transparent;cursor:pointer}
.mv-range::-webkit-slider-runnable-track{height:4px;border-radius:3px;background:rgba(255,255,255,.26)}
.mv-range::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:11px;border-radius:50%;background:#fff;
  margin-top:-3.5px;box-shadow:0 1px 5px rgba(0,0,0,.5)}
.mv-spacer{flex:1}

/* 画质菜单 */
.mv-menu{position:absolute;right:0;bottom:calc(100% + 10px);min-width:156px;padding:6px;
  background:rgba(26,26,29,.97);border:1px solid rgba(255,255,255,.1);border-radius:12px;
  box-shadow:0 18px 44px rgba(0,0,0,.55);backdrop-filter:blur(20px);display:none;z-index:5}
.mv-menu[data-open="1"]{display:block}
.mv-menu-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px;border-radius:8px;
  font-size:12.5px;color:rgba(255,255,255,.88);cursor:pointer;white-space:nowrap}
.mv-menu-item:hover{background:rgba(255,255,255,.1)}
.mv-menu-item[data-active="1"]{color:#ffa8c0;font-weight:600}
.mv-menu-note{padding:6px 10px 3px;font-size:10.5px;color:rgba(255,255,255,.4);line-height:1.5;white-space:normal}
.mv-wrap-menu{position:relative;display:flex}

/* 中间层：加载 / 错误 / 点击播放 */
.mv-center{position:absolute;inset:0;display:none;align-items:center;justify-content:center;pointer-events:none}
.mv-center[data-open="1"]{display:flex}
.mv-card{pointer-events:auto;width:min(540px,88vw);max-height:78vh;overflow:auto;
  background:rgba(20,20,22,.94);border:1px solid rgba(255,255,255,.09);border-radius:18px;
  padding:24px 24px 18px;box-shadow:0 30px 90px rgba(0,0,0,.66);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)}
.mv-card::-webkit-scrollbar{width:8px}
.mv-card::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px}
.mv-card-title{font-size:15px;font-weight:600;line-height:1.4}
.mv-card-text{margin-top:8px;font-size:12.5px;line-height:1.65;color:rgba(255,255,255,.58)}
.mv-card-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.mv-load{padding:6px 2px}
.mv-load-row{display:flex;align-items:center;gap:13px}
.mv-spin{width:26px;height:26px;border-radius:50%;flex:none;
  border:2px solid rgba(255,255,255,.18);border-top-color:#fff;animation:mvspin .85s linear infinite}
@keyframes mvspin{to{transform:rotate(360deg)}}
.mv-search{display:flex;gap:8px;margin-top:14px}
.mv-input{flex:1;min-width:0;height:34px;padding:0 11px;border-radius:9px;color:#fff;font:inherit;font-size:12.5px;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);outline:none}
.mv-input:focus{border-color:rgba(251,114,153,.55);background:rgba(255,255,255,.1)}
.mv-cands{margin-top:14px;display:flex;flex-direction:column;gap:2px}
.mv-cand{display:flex;gap:11px;padding:8px;border-radius:10px;cursor:pointer;text-align:left;border:0;background:transparent;
  color:inherit;font:inherit;align-items:center}
.mv-cand:hover{background:rgba(255,255,255,.07)}
.mv-cand-thumb{width:88px;height:50px;border-radius:7px;object-fit:cover;flex:none;background:rgba(255,255,255,.06)}
.mv-cand-body{min-width:0;flex:1}
.mv-cand-title{font-size:12.5px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mv-cand-meta{margin-top:3px;font-size:10.5px;color:rgba(255,255,255,.44);display:flex;gap:6px;align-items:center}
.mv-bigplay{pointer-events:auto;width:74px;height:74px;border-radius:50%;border:0;cursor:pointer;
  background:rgba(255,255,255,.14);color:#fff;display:flex;align-items:center;justify-content:center;
  backdrop-filter:blur(14px);transition:background .18s,transform .18s}
.mv-bigplay:hover{background:rgba(255,255,255,.24);transform:scale(1.04)}
.mv-bigplay svg{width:30px;height:30px;margin-left:3px}

/* 控件自动隐藏 */
.mv-root[data-idle="1"] .mv-top,.mv-root[data-idle="1"] .mv-bottom{opacity:0;pointer-events:none}
.mv-root[data-idle="1"] .mv-top>*,.mv-root[data-idle="1"] .mv-bottom>*{pointer-events:none}
.mv-root[data-idle="1"]{cursor:none}
.mv-root[data-idle="1"] .mv-top,.mv-root[data-idle="1"] .mv-bottom{cursor:default}
`;

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function fmtTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function songTitleOf(song) {
  if (!song) return '';
  return String(song.title ?? song.name ?? '').trim();
}

function songArtistOf(song) {
  if (!song) return '';
  const list = Array.isArray(song.artists)
    ? song.artists
    : typeof song.artists === 'string'
      ? [song.artists]
      : song.artist
        ? [song.artist]
        : [];
  return list
    .map((entry) => (typeof entry === 'string' ? entry : String((entry && entry.name) || '')))
    .filter(Boolean)
    .join(' ');
}

/** 时长归一化成秒：song.duration 是秒，song.durationMs 是毫秒，旧字段还可能混着来。 */
function songDurationSec(song) {
  const raw = Number((song && (song.durationMs ?? song.duration)) ?? 0) || 0;
  if (!raw) return 0;
  return raw > 7200 ? raw / 1000 : raw;
}

function songKey(song) {
  return `${songTitleOf(song)}\u241F${songArtistOf(song)}`.toLowerCase();
}

/* ------------------------------------------------------------------ *
 * activate
 * ------------------------------------------------------------------ */

export default function activate(folium) {
  if (folium.env.context !== 'main') return;

  const log = folium.log;
  const hostMinor = (folium.host && folium.host.folium && folium.host.folium.minor) || 0;
  const supportsSecret = hostMinor >= 7;

  /* ---------------------------------------------------------------- *
   * 设置
   * ---------------------------------------------------------------- */

  const schema = [
    {
      key: 'quality',
      type: 'select',
      defaultValue: 'auto',
      label: label('画质上限', 'Quality cap'),
      description: label(
        '「自动」：登录了就要 1080P，没登录要 720P（未登录时 B 站多数视频只到 720P，个别能给 1080P）。大会员再把上限调到 1080P60 或 4K。',
        'Auto asks for 1080p when signed in, 720p otherwise. Premium accounts can raise the cap to 1080p60 / 4K.',
      ),
      options: [
        { value: 'auto', label: label('自动', 'Auto') },
        { value: '1080p60', label: label('1080P60', '1080p60') },
        { value: '1080p', label: label('1080P', '1080p') },
        { value: '720p', label: label('720P', '720p') },
        { value: '480p', label: label('480P', '480p') },
      ],
    },
    {
      key: 'pauseMusic',
      type: 'boolean',
      defaultValue: true,
      label: label('看 MV 时暂停音乐', 'Pause the music while the MV plays'),
      description: label(
        '关掉的话两路声音会一起响 —— 除非你只是想看看画面。',
        'Turn it off and both soundtracks play at once.',
      ),
    },
    {
      key: 'volume',
      type: 'number',
      defaultValue: 90,
      min: 0,
      max: 100,
      step: 5,
      label: label('MV 音量（%）', 'MV volume (%)'),
      description: label('和 Folia 的音乐音量分开，只作用于 MV。', 'Separate from the music volume.'),
    },
  ];

  if (supportsSecret) {
    schema.push({
      key: 'cookie',
      type: 'secret',
      label: label('B 站 Cookie（登录用）', 'bilibili cookie (sign-in)'),
      description: label(
        '不填也能看，最高 720P。填了（或扫码登录）才有 1080P / 1080P60 / 4K。值由系统凭证库加密保存，不进设置值、不进日志、不进导出。',
        'Optional. Without it you still get 720p; SESSDATA unlocks 1080p and above. Encrypted by the OS credential store.',
      ),
    });
  }

  const section = folium.registries.settingsSections.register({
    id: 'cinema',
    label: label('MV 影院', 'MV cinema'),
    description: label(
      '播放栏的 MV 按钮点开就是全屏 MV，带原声。搜索、候选、画质都在全屏页里处理，不占主界面。',
      'The MV button in the player bar opens a full-screen MV player with its own audio.',
    ),
    settings: schema,
  });

  function rawSettings() {
    try {
      const holder = section && (section.params || section.settings);
      const value = holder && typeof holder.get === 'function' ? holder.get() : null;
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  /** 白名单归一化：手改配置、旧配置都不会把播放器带沟里。 */
  function settings() {
    const raw = rawSettings();
    const qualityList = ['auto', '1080p60', '1080p', '720p', '480p'];
    const volume = Number(raw.volume);
    return {
      quality: qualityList.includes(raw.quality) ? raw.quality : 'auto',
      pauseMusic: raw.pauseMusic !== false,
      volume: Number.isFinite(volume) ? clamp(volume, 0, 100) : 90,
    };
  }

  /* ---------------------------------------------------------------- *
   * 状态
   * ---------------------------------------------------------------- */

  const state = {
    open: false,
    phase: 'idle', // idle | loading | playing | error | blocked
    song: null,
    info: null,
    candidates: [],
    keyword: '',
    sourceIndex: 0,
    pausedHost: false,
    volume: 0.9,
    muted: false,
    qualityOverride: '',
    lastError: '',
    dragging: false,
    generation: 0,
  };

  const resolvedCache = new Map(); // songKey → info（同一个视频不重复取流）
  const pinned = new Map(); // songKey → bvid（用户手动挑过的）

  let pinnedLoaded = false;
  function loadPinned() {
    if (pinnedLoaded) return;
    pinnedLoaded = true;
    Promise.resolve(folium.storage.get('pinned'))
      .then((saved) => {
        if (saved && typeof saved === 'object') {
          for (const [key, bvid] of Object.entries(saved)) pinned.set(key, String(bvid));
        }
      })
      .catch(() => {});
  }

  let pinnedSaveTimer = 0;
  function persistPinned() {
    if (pinnedSaveTimer) clearTimeout(pinnedSaveTimer);
    pinnedSaveTimer = setTimeout(() => {
      pinnedSaveTimer = 0;
      Promise.resolve(folium.storage.set('pinned', Object.fromEntries(pinned))).catch(() => {});
    }, 400);
  }

  function loadVolume() {
    const fallback = settings().volume / 100;
    try {
      const saved = Number(window.localStorage.getItem(VOL_KEY));
      if (Number.isFinite(saved) && saved >= 0 && saved <= 1) return saved;
    } catch {
      /* 隐私模式拿不到 localStorage */
    }
    return fallback;
  }

  function saveVolume() {
    try {
      window.localStorage.setItem(VOL_KEY, String(state.volume));
    } catch {
      /* 同上 */
    }
  }

  /* ---------------------------------------------------------------- *
   * 宿主播放状态
   * ---------------------------------------------------------------- */

  function playbackState() {
    try {
      const playback = folium.playback;
      if (!playback || typeof playback.getState !== 'function') return null;
      const value = playback.getState();
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  function currentSong() {
    const value = playbackState();
    return (value && value.song) || null;
  }

  function pauseHost() {
    const value = playbackState();
    if (!value) return;
    if (String(value.state) !== 'playing') {
      state.pausedHost = false;
      return;
    }
    try {
      folium.playback.pause();
      state.pausedHost = true;
    } catch {
      state.pausedHost = false;
    }
  }

  function resumeHost() {
    if (!state.pausedHost) return;
    state.pausedHost = false;
    try {
      folium.playback.play();
    } catch {
      /* 恢复不了就算了，用户按一下播放键一样 */
    }
  }

  /* ---------------------------------------------------------------- *
   * DOM
   * ---------------------------------------------------------------- */

  const root = document.createElement('div');
  root.className = 'mv-root';
  root.setAttribute('data-open', '0');

  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  const video = document.createElement('video');
  video.className = 'mv-video';
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.setAttribute('playsinline', '');
  root.appendChild(video);

  /** DASH 模式下的伴音轨。muxed 模式下不用它。 */
  const audio = document.createElement('audio');
  audio.preload = 'auto';
  audio.crossOrigin = 'anonymous';

  /* --- 顶部 --- */
  const top = document.createElement('div');
  top.className = 'mv-top';

  const btnBack = document.createElement('button');
  btnBack.type = 'button';
  btnBack.className = 'mv-btn ghost round';
  btnBack.title = '退出 MV（Esc）';
  btnBack.innerHTML = ICON_BACK;
  top.appendChild(btnBack);

  const meta = document.createElement('div');
  meta.className = 'mv-meta';
  const titleEl = document.createElement('div');
  titleEl.className = 'mv-title';
  titleEl.textContent = '';
  const subEl = document.createElement('div');
  subEl.className = 'mv-sub';
  meta.appendChild(titleEl);
  meta.appendChild(subEl);
  top.appendChild(meta);

  const btnLink = document.createElement('button');
  btnLink.type = 'button';
  btnLink.className = 'mv-btn ghost round';
  btnLink.title = '复制 B 站原视频链接';
  btnLink.innerHTML = ICON_LINK;
  top.appendChild(btnLink);

  const btnClose = document.createElement('button');
  btnClose.type = 'button';
  btnClose.className = 'mv-btn ghost round';
  btnClose.title = '关闭（Esc）';
  btnClose.innerHTML = ICON_CLOSE;
  top.appendChild(btnClose);

  root.appendChild(top);

  /* --- 中间层 --- */
  const center = document.createElement('div');
  center.className = 'mv-center';
  center.setAttribute('data-open', '0');
  root.appendChild(center);

  /** 加载态 */
  const loadBox = document.createElement('div');
  loadBox.className = 'mv-card';
  loadBox.style.display = 'none';
  loadBox.innerHTML = `
    <div class="mv-load">
      <div class="mv-load-row">
        <div class="mv-spin"></div>
        <div>
          <div class="mv-card-title">正在 B 站找这首歌的 MV…</div>
          <div class="mv-card-text" data-role="load-hint"></div>
        </div>
      </div>
    </div>`;
  center.appendChild(loadBox);

  /** 错误态 */
  const errorBox = document.createElement('div');
  errorBox.className = 'mv-card';
  errorBox.style.display = 'none';
  const errTitle = document.createElement('div');
  errTitle.className = 'mv-card-title';
  const errText = document.createElement('div');
  errText.className = 'mv-card-text';
  const searchRow = document.createElement('div');
  searchRow.className = 'mv-search';
  const searchInput = document.createElement('input');
  searchInput.className = 'mv-input';
  searchInput.type = 'text';
  searchInput.placeholder = '换个关键词试试，比如「歌名 歌手 MV」';
  const btnSearch = document.createElement('button');
  btnSearch.type = 'button';
  btnSearch.className = 'mv-btn tall';
  btnSearch.textContent = '重新搜索';
  searchRow.appendChild(searchInput);
  searchRow.appendChild(btnSearch);

  const candList = document.createElement('div');
  candList.className = 'mv-cands';

  const errActions = document.createElement('div');
  errActions.className = 'mv-card-actions';
  const btnExitErr = document.createElement('button');
  btnExitErr.type = 'button';
  btnExitErr.className = 'mv-btn tall';
  btnExitErr.textContent = '退出';
  errActions.appendChild(btnExitErr);

  errorBox.appendChild(errTitle);
  errorBox.appendChild(errText);
  errorBox.appendChild(searchRow);
  errorBox.appendChild(candList);
  errorBox.appendChild(errActions);
  center.appendChild(errorBox);

  /** 自动播放被拦时的大按钮 */
  const bigPlay = document.createElement('button');
  bigPlay.type = 'button';
  bigPlay.className = 'mv-bigplay';
  bigPlay.title = '开始播放';
  bigPlay.innerHTML = ICON_PLAY;
  bigPlay.style.display = 'none';
  center.appendChild(bigPlay);

  /* --- 底部 --- */
  const bottom = document.createElement('div');
  bottom.className = 'mv-bottom';

  const progressRow = document.createElement('div');
  progressRow.className = 'mv-progress-row';

  const timeNow = document.createElement('div');
  timeNow.className = 'mv-time';
  timeNow.textContent = '0:00';

  const track = document.createElement('div');
  track.className = 'mv-track';
  const fill = document.createElement('div');
  fill.className = 'mv-fill';
  const knob = document.createElement('div');
  knob.className = 'mv-knob';
  track.appendChild(fill);
  track.appendChild(knob);

  const timeTotal = document.createElement('div');
  timeTotal.className = 'mv-time';
  timeTotal.textContent = '0:00';

  progressRow.appendChild(timeNow);
  progressRow.appendChild(track);
  progressRow.appendChild(timeTotal);
  bottom.appendChild(progressRow);

  const controls = document.createElement('div');
  controls.className = 'mv-controls';

  const btnPlay = document.createElement('button');
  btnPlay.type = 'button';
  btnPlay.className = 'mv-btn round';
  btnPlay.title = '播放 / 暂停（空格）';
  btnPlay.innerHTML = ICON_PAUSE;
  controls.appendChild(btnPlay);

  const volumeWrap = document.createElement('div');
  volumeWrap.className = 'mv-volume';
  const btnMute = document.createElement('button');
  btnMute.type = 'button';
  btnMute.className = 'mv-btn round';
  btnMute.style.width = '30px';
  btnMute.style.height = '30px';
  btnMute.title = '静音';
  btnMute.innerHTML = ICON_VOLUME;
  const volumeRange = document.createElement('input');
  volumeRange.className = 'mv-range';
  volumeRange.type = 'range';
  volumeRange.min = '0';
  volumeRange.max = '100';
  volumeRange.step = '1';
  volumeRange.value = '90';
  volumeWrap.appendChild(btnMute);
  volumeWrap.appendChild(volumeRange);
  controls.appendChild(volumeWrap);

  const spacer = document.createElement('div');
  spacer.className = 'mv-spacer';
  controls.appendChild(spacer);

  const qualityWrap = document.createElement('div');
  qualityWrap.className = 'mv-wrap-menu';
  const btnQuality = document.createElement('button');
  btnQuality.type = 'button';
  btnQuality.className = 'mv-btn tall';
  btnQuality.textContent = '画质';
  qualityWrap.appendChild(btnQuality);

  const qualityMenu = document.createElement('div');
  qualityMenu.className = 'mv-menu';
  qualityMenu.setAttribute('data-open', '0');
  const QUALITY_OPTIONS = [
    ['auto', '自动'],
    ['1080p60', '1080P60'],
    ['1080p', '1080P'],
    ['720p', '720P'],
    ['480p', '480P'],
  ];
  for (const [value, text] of QUALITY_OPTIONS) {
    const item = document.createElement('div');
    item.className = 'mv-menu-item';
    item.setAttribute('data-role', 'quality');
    item.setAttribute('data-value', value);
    item.textContent = text;
    qualityMenu.appendChild(item);
  }
  const menuNote = document.createElement('div');
  menuNote.className = 'mv-menu-note';
  menuNote.textContent = '换画质会重新取流；未登录一般只有 720P。';
  qualityMenu.appendChild(menuNote);
  qualityWrap.appendChild(qualityMenu);
  controls.appendChild(qualityWrap);

  const btnExpand = document.createElement('button');
  btnExpand.type = 'button';
  btnExpand.className = 'mv-btn round';
  btnExpand.title = '整窗全屏';
  btnExpand.innerHTML = ICON_EXPAND;
  controls.appendChild(btnExpand);

  bottom.appendChild(controls);
  root.appendChild(bottom);

  /* ---------------------------------------------------------------- *
   * 播放器：源切换、同步、控件
   * ---------------------------------------------------------------- */

  let syncTimer = 0;
  let hideTimer = 0;
  let resumeTimer = 0;

  function stopSync() {
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = 0;
    }
  }

  function usingAudioTrack() {
    return Boolean(audio.src);
  }

  /** DASH 双元素：每 800ms 校一次漂移，超过 0.3 秒才纠正（免得一直听到小跳）。 */
  function startSync() {
    stopSync();
    if (!usingAudioTrack()) return;
    syncTimer = setInterval(() => {
      if (!state.open || video.paused || video.seeking) return;
      const drift = audio.currentTime - video.currentTime;
      if (Math.abs(drift) > 0.3) {
        try {
          audio.currentTime = video.currentTime;
        } catch {
          /* 还没 seekable，下次再来 */
        }
      }
      if (audio.paused) {
        const promise = audio.play();
        if (promise && typeof promise.catch === 'function') promise.catch(() => {});
      }
    }, 800);
  }

  function applyVolume() {
    const value = state.muted ? 0 : state.volume;
    if (usingAudioTrack()) {
      video.muted = true;
      audio.volume = value;
      audio.muted = state.muted;
    } else {
      video.muted = state.muted;
      video.volume = value;
    }
    volumeRange.value = String(Math.round(state.volume * 100));
    btnMute.innerHTML = state.muted || state.volume === 0 ? ICON_MUTED : ICON_VOLUME;
  }

  function seekTo(seconds) {
    const target = clamp(seconds, 0, Number.isFinite(video.duration) ? video.duration : seconds);
    try {
      video.currentTime = target;
    } catch {
      return;
    }
    if (usingAudioTrack()) {
      try {
        audio.currentTime = target;
      } catch {
        /* 音轨还没 ready */
      }
    }
    updateProgress();
  }

  function toggle() {
    if (!state.open) return;
    if (video.paused) {
      const promise = video.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => showBlocked(true));
      }
      if (usingAudioTrack()) {
        const ap = audio.play();
        if (ap && typeof ap.catch === 'function') ap.catch(() => {});
      }
    } else {
      video.pause();
      audio.pause();
    }
    syncPlayIcon();
    poke();
  }

  function syncPlayIcon() {
    btnPlay.innerHTML = video.paused ? ICON_PLAY : ICON_PAUSE;
  }

  function updateProgress() {
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const current = video.currentTime || 0;
    const ratio = duration ? clamp(current / duration, 0, 1) : 0;
    fill.style.width = `${ratio * 100}%`;
    knob.style.left = `${ratio * 100}%`;
    timeNow.textContent = fmtTime(current);
    timeTotal.textContent = duration ? fmtTime(duration) : '0:00';
  }

  /* ---- 进度条拖动 ---- */

  function ratioFromEvent(event) {
    const rect = track.getBoundingClientRect();
    if (!rect.width) return 0;
    return clamp((event.clientX - rect.left) / rect.width, 0, 1);
  }

  track.addEventListener('pointerdown', (event) => {
    state.dragging = true;
    track.setPointerCapture(event.pointerId);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration) seekTo(ratioFromEvent(event) * duration);
    poke();
  });

  track.addEventListener('pointermove', (event) => {
    if (!state.dragging) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration) seekTo(ratioFromEvent(event) * duration);
  });

  const endDrag = (event) => {
    if (!state.dragging) return;
    state.dragging = false;
    try {
      track.releasePointerCapture(event.pointerId);
    } catch {
      /* 已经释放了 */
    }
    poke();
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);

  /* ---- 视频事件 ---- */

  video.addEventListener('timeupdate', updateProgress);
  video.addEventListener('durationchange', updateProgress);
  video.addEventListener('loadedmetadata', () => {
    updateProgress();
    startSync();
    syncPlayIcon();
  });
  video.addEventListener('play', () => {
    syncPlayIcon();
    poke();
    if (usingAudioTrack() && audio.paused) {
      const promise = audio.play();
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    }
  });
  video.addEventListener('pause', () => {
    audio.pause();
    syncPlayIcon();
    poke(true);
  });
  video.addEventListener('waiting', () => {
    if (state.phase === 'playing') showLoadingCard('缓冲中…', '网络慢的时候会这样，等一下就好。');
  });
  video.addEventListener('playing', () => {
    hideCenter();
    state.phase = 'playing';
    syncPlayIcon();
  });
  video.addEventListener('ended', () => {
    state.phase = 'playing';
    syncPlayIcon();
    poke(true);
  });
  video.addEventListener('error', () => {
    if (!state.open) return;
    tryNextSource('视频源出错');
  });

  audio.addEventListener('error', () => {
    // 伴音轨挂了：退回画面自有音轨（muxed 时本来就有），至少别静音。
    log.info('MV 影院：伴音轨加载失败，改由视频自带音轨发声');
    audio.removeAttribute('src');
    video.muted = state.muted;
  });

  /* ---- 加载 / 错误 / 拦截 三种中间态 ---- */

  function showCenter(kind) {
    center.setAttribute('data-open', kind ? '1' : '0');
    loadBox.style.display = kind === 'loading' ? 'block' : 'none';
    errorBox.style.display = kind === 'error' ? 'block' : 'none';
    bigPlay.style.display = kind === 'blocked' ? 'flex' : 'none';
    if (kind) root.removeAttribute('data-idle');
  }

  function showLoadingCard(title, hint) {
    showCenter('loading');
    const titleNode = loadBox.querySelector('.mv-card-title');
    const hintNode = loadBox.querySelector('[data-role="load-hint"]');
    if (titleNode) titleNode.textContent = title;
    if (hintNode) hintNode.textContent = hint || '';
  }

  function hideCenter() {
    showCenter('');
  }

  function showBlocked(flag) {
    if (flag) showCenter('blocked');
    else hideCenter();
  }

  function errorText(code) {
    const raw = String(code || '');
    if (/search-empty/.test(raw)) return 'B 站没搜到相关的视频。可以换个说法，或者干脆输「歌名 + MV」。';
    if (/no-candidate|no-playable-url/.test(raw)) return '搜到了，但没有能播的源（可能被版权或地区限制）。试试换一个候选。';
    if (/search--412/.test(raw)) return '被 B 站的风控拦了一下。过一会儿再点，或者在设置里扫码登录（登录态下风控更宽松）。';
    if (/bad-json|http-|bili-timeout|ECONN|ENOTFOUND|socket/i.test(raw)) {
      return `网络没能连上 B 站（${raw}）。检查一下网络，或者稍后重试。`;
    }
    if (/view-|playurl/.test(raw)) return `B 站返回了异常（${raw}）。换一个候选通常就好了。`;
    return raw || '未知原因';
  }

  function renderCandidates(list) {
    candList.innerHTML = '';
    if (!list || !list.length) return;
    for (const item of list) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'mv-cand';

      const thumb = document.createElement('img');
      thumb.className = 'mv-cand-thumb';
      thumb.loading = 'lazy';
      if (item.cover) thumb.src = item.cover;
      row.appendChild(thumb);

      const body = document.createElement('div');
      body.className = 'mv-cand-body';
      const name = document.createElement('div');
      name.className = 'mv-cand-title';
      name.textContent = item.title || item.bvid;
      const metaLine = document.createElement('div');
      metaLine.className = 'mv-cand-meta';
      const parts = [item.author || '', item.duration ? String(item.duration) : ''];
      if (Number.isFinite(item.score)) parts.push(`匹配 ${item.score}`);
      metaLine.textContent = parts.filter(Boolean).join(' · ');
      body.appendChild(name);
      body.appendChild(metaLine);
      row.appendChild(body);

      row.addEventListener('click', () => {
        if (state.song) {
          pinned.set(songKey(state.song), item.bvid);
          persistPinned();
        }
        void resolve({ bvid: item.bvid, keyword: '' });
      });
      candList.appendChild(row);
    }
  }

  function showError(code, candidates) {
    state.phase = 'error';
    state.lastError = String(code || '');
    errTitle.textContent = '这次没看成';
    errText.textContent = errorText(code);
    searchInput.value = state.keyword || '';
    renderCandidates(candidates || []);
    showCenter('error');
    syncPlayIcon();
  }

  /* ---- 取流 ---- */

  function clearMedia() {
    stopSync();
    try {
      video.pause();
    } catch {
      /* ignore */
    }
    video.removeAttribute('src');
    video.load();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    state.info = null;
    state.sourceIndex = 0;
    timeNow.textContent = '0:00';
    timeTotal.textContent = '0:00';
    fill.style.width = '0%';
    knob.style.left = '0%';
  }

  function playSource(info, index) {
    const source = info.sources && info.sources[index];
    if (!source) {
      showError('no-playable-url', info.candidates);
      return;
    }
    state.sourceIndex = index;
    state.info = info;
    state.phase = 'loading';
    showLoadingCard('正在载入 MV…', '');

    video.src = source.video;
    if (source.audio) {
      audio.src = source.audio;
      video.muted = true;
    } else {
      audio.removeAttribute('src');
      video.muted = state.muted;
    }
    applyVolume();

    const promise = video.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {
        if (!state.open) return;
        state.phase = 'playing';
        showBlocked(true);
        syncPlayIcon();
      });
    }
    if (source.audio) {
      const ap = audio.play();
      if (ap && typeof ap.catch === 'function') ap.catch(() => {});
    }
    startSync();
  }

  function tryNextSource(reason) {
    const info = state.info;
    if (info && info.sources && state.sourceIndex + 1 < info.sources.length) {
      log.info(`MV 影院：${reason}，换下一个源（${info.sources[state.sourceIndex + 1].kind}）`);
      playSource(info, state.sourceIndex + 1);
      return;
    }
    if (info) {
      clearMedia();
      showError('no-playable-url', info.candidates);
    }
  }

  async function resolve(options = {}) {
    const song = state.song;
    if (!song && !options.bvid && !options.keyword) {
      showError('no-song-title');
      return;
    }

    const generation = ++state.generation;
    state.phase = 'loading';
    showLoadingCard(
      options.keyword ? `按「${options.keyword}」重新搜…` : '正在 B 站找这首歌的 MV…',
      options.bvid ? '' : '拿歌名和歌手名去搜，按标题、UP 主、时长挑最像官方的那个。',
    );

    const quality = state.qualityOverride || settings().quality;
    const payload = {
      title: songTitleOf(song),
      artist: songArtistOf(song),
      durationMs: songDurationSec(song) * 1000,
      quality,
      bvid: options.bvid || '',
      query: options.keyword || '',
    };

    let result;
    try {
      result = await folium.rpc.call('resolveMv', payload);
    } catch (err) {
      if (generation !== state.generation) return;
      showError(String((err && err.message) || err));
      return;
    }

    if (generation !== state.generation || !state.open) return;

    if (!result || !result.ok) {
      state.keyword = (result && result.keyword) || payload.query || '';
      showError((result && result.error) || 'unknown', (result && result.candidates) || []);
      return;
    }

    state.keyword = result.keyword || '';
    if (song) resolvedCache.set(songKey(song), result);
    applyInfo(result);
    playSource(result, 0);
  }

  /** 把头部信息画出来。 */
  function applyInfo(info) {
    const song = state.song;
    const title = songTitleOf(song) || info.title || 'MV';
    titleEl.textContent = title;

    subEl.innerHTML = '';
    const chip = document.createElement('span');
    chip.className = 'mv-chip';
    chip.textContent = 'MV';
    subEl.appendChild(chip);

    const artist = songArtistOf(song);
    if (artist) {
      subEl.appendChild(document.createTextNode(artist));
    }

    const qualityLabel = info.quality && info.quality.label ? info.quality.label : '';
    if (qualityLabel) {
      const dot = document.createElement('span');
      dot.className = 'mv-dot';
      subEl.appendChild(dot);
      subEl.appendChild(document.createTextNode(qualityLabel));
    }
    if (info.mode === 'silent') {
      const dot = document.createElement('span');
      dot.className = 'mv-dot';
      subEl.appendChild(dot);
      const warn = document.createElement('span');
      warn.textContent = '这条没有音轨';
      subEl.appendChild(warn);
    }

    btnQuality.textContent = qualityLabel || '画质';
    for (const item of qualityMenu.querySelectorAll('[data-role="quality"]')) {
      const active = item.getAttribute('data-value') === (state.qualityOverride || settings().quality);
      item.setAttribute('data-active', active ? '1' : '0');
    }
  }

  /* ---- 打开 / 关闭 ---- */

  function kickoff() {
    poke(true);
    root.setAttribute('data-open', '1');
    requestAnimationFrame(() => root.setAttribute('data-shown', '1'));
    document.addEventListener('keydown', onKey, true);
  }

  function open() {
    if (state.open) return;
    const song = currentSong();
    if (!song) {
      folium.ui.toast('现在没有正在播放的歌', { durationMs: 1600 });
      return;
    }

    state.open = true;
    state.song = song;
    state.volume = loadVolume();
    state.muted = false;
    state.qualityOverride = '';
    state.candidates = [];
    state.keyword = '';

    kickoff();
    if (settings().pauseMusic) pauseHost();
    applyVolume();

    const cached = resolvedCache.get(songKey(song));
    if (cached) {
      state.keyword = cached.keyword || '';
      applyInfo(cached);
      playSource(cached, 0);
      return;
    }

    const mine = pinned.get(songKey(song));
    void resolve(mine ? { bvid: mine } : {});
  }

  function close(resume = true) {
    if (!state.open) return;
    state.open = false;
    state.generation += 1;
    state.phase = 'idle';
    document.removeEventListener('keydown', onKey, true);
    hideCenter();
    clearMedia();
    root.setAttribute('data-shown', '0');
    root.setAttribute('data-idle', '0');
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = 0;
    }
    resumeTimer = window.setTimeout(() => {
      resumeTimer = 0;
      if (!state.open) root.setAttribute('data-open', '0');
    }, 220);

    if (resume) resumeHost();
    else state.pausedHost = false;

    try {
      if (document.fullscreenElement) document.exitFullscreen();
    } catch {
      /* 浏览器不给退就算了 */
    }
  }

  /* ---- 控件自动隐藏 ---- */

  function poke(force) {
    root.removeAttribute('data-idle');
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
    const shouldHide = state.open && state.phase === 'playing' && !video.paused && !force;
    if (!shouldHide) return;
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      if (state.open && !video.paused) root.setAttribute('data-idle', '1');
    }, 2800);
  }

  root.addEventListener('mousemove', () => poke());
  root.addEventListener('pointerdown', () => poke());

  /* ---- 键盘 ---- */

  function onKey(event) {
    if (!state.open) return;
    if (event.key === 'Escape') {
      if (document.fullscreenElement) return; // 先让浏览器退全屏
      close();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.code === 'Space' || event.key === ' ') {
      toggle();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'ArrowLeft') {
      seekTo((video.currentTime || 0) - 5);
      poke();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'ArrowRight') {
      seekTo((video.currentTime || 0) + 5);
      poke();
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /* ---- 按钮 ---- */

  btnBack.addEventListener('click', () => close());
  btnClose.addEventListener('click', () => close());
  btnPlay.addEventListener('click', () => toggle());
  bigPlay.addEventListener('click', () => {
    showBlocked(false);
    toggle();
  });

  btnMute.addEventListener('click', () => {
    state.muted = !state.muted;
    applyVolume();
  });

  volumeRange.addEventListener('input', () => {
    const value = clamp(Number(volumeRange.value) / 100, 0, 1);
    state.volume = value;
    state.muted = value === 0;
    applyVolume();
    saveVolume();
  });

  btnQuality.addEventListener('click', (event) => {
    event.stopPropagation();
    const openNow = qualityMenu.getAttribute('data-open') === '1';
    qualityMenu.setAttribute('data-open', openNow ? '0' : '1');
  });

  qualityMenu.addEventListener('click', (event) => {
    const item = event.target instanceof Element ? event.target.closest('[data-role="quality"]') : null;
    if (!item) return;
    const value = item.getAttribute('data-value') || 'auto';
    qualityMenu.setAttribute('data-open', '0');
    state.qualityOverride = value;
    if (state.info) {
      const labelText = item.textContent || '';
      btnQuality.textContent = labelText;
    }
    void resolve({ bvid: state.info ? state.info.bvid : '', keyword: state.keyword });
  });

  function onDocumentClick(event) {
    if (qualityMenu.getAttribute('data-open') !== '1') return;
    if (event.composedPath && event.composedPath().includes(qualityWrap)) return;
    qualityMenu.setAttribute('data-open', '0');
  }
  document.addEventListener('click', onDocumentClick);

  btnExpand.addEventListener('click', () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else root.requestFullscreen();
    } catch {
      folium.ui.toast('这个窗口不支持整窗全屏', { durationMs: 1600 });
    }
  });

  btnLink.addEventListener('click', () => {
    const url = (state.info && state.info.url) || '';
    if (!url) return;
    const copy = navigator.clipboard && navigator.clipboard.writeText(url);
    if (copy && typeof copy.then === 'function') {
      copy
        .then(() => folium.ui.toast('B 站链接已复制', { type: 'success', durationMs: 1600 }))
        .catch(() => folium.ui.toast(url, { durationMs: 3000 }));
    } else {
      folium.ui.toast(url, { durationMs: 3000 });
    }
  });

  btnSearch.addEventListener('click', () => {
    const keyword = searchInput.value.trim();
    if (!keyword) {
      searchInput.focus();
      return;
    }
    void resolve({ keyword });
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    btnSearch.click();
  });

  btnExitErr.addEventListener('click', () => close());

  /* ---------------------------------------------------------------- *
   * 注册
   * ---------------------------------------------------------------- */

  // 进度条右侧的 MV 按钮 —— 全模组唯一的常驻 UI。
  const disposeButton = folium.registries.progressButtons.register({
    id: 'open-cinema',
    slot: 'progress.trailing',
    order: 380,
    hideWhenCollapsed: true,
    mount(container, ctx) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = '看这首歌的 MV';
      btn.setAttribute('aria-label', '看这首歌的 MV');

      let color = 'inherit';
      try {
        const colors = ctx && typeof ctx.getColors === 'function' ? ctx.getColors() : null;
        if (colors && colors.text) color = colors.text;
      } catch {
        /* 老宿主没有 getColors */
      }

      btn.style.cssText =
        'display:flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;' +
        'background:transparent;border-radius:7px;padding:0;cursor:pointer;flex:none;' +
        `color:${color};transition:background .15s,opacity .15s;`;
      btn.innerHTML = ICON_MV;

      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(127,127,127,.16)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'transparent';
      });

      let disposed = false;
      const sync = () => {
        if (disposed) return;
        const song = currentSong();
        btn.style.opacity = song ? '1' : '.35';
        btn.style.cursor = song ? 'pointer' : 'default';
      };

      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        open();
      });

      const unsubscribers = [];
      try {
        if (folium.events && typeof folium.events.on === 'function') {
          unsubscribers.push(folium.events.on('playback.songChanged', sync));
        }
      } catch {
        /* 没有事件总线就算了，按钮照样能点 */
      }

      sync();
      container.appendChild(btn);

      return () => {
        disposed = true;
        for (const off of unsubscribers) {
          try {
            if (typeof off === 'function') off();
            else if (off && typeof off.unsubscribe === 'function') off.unsubscribe();
          } catch {
            /* ignore */
          }
        }
        btn.remove();
      };
    },
  });

  // 全屏层。interactive 留 false：宿主那层 pointer-events:none，
  // 由我们自己的 .mv-root 打开 auto，关掉时整棵树 display:none，绝不吃点击。
  const disposeLayer = folium.registries.stageLayers.register({
    id: 'cinema',
    slot: 'app.overlay',
    order: 940,
    interactive: false,
    mount(container) {
      container.appendChild(root);
      return () => {
        close(false);
        root.remove();
      };
    },
  });

  // 换歌就收场：用户点的是「这首歌的 MV」，换歌继续放上一首的 MV 是 bug 不是功能。
  const unsubscribers = [];
  function subscribe(name, handler) {
    try {
      if (!folium.events || typeof folium.events.on !== 'function') return;
      const off = folium.events.on(name, handler);
      unsubscribers.push(off);
    } catch {
      /* ignore */
    }
  }

  subscribe('playback.songChanged', ({ song }) => {
    if (!state.open) return;
    if (!song || songKey(song) !== songKey(state.song)) close(false);
  });

  subscribe('playback.stateChanged', ({ state: next }) => {
    // 用户在后台把音乐又按了播放（媒体键 / 遥控窗口）：MV 开着时压回去。
    if (!state.open || !settings().pauseMusic) return;
    if (!next || String(next) !== 'playing') return;
    if (!state.pausedHost) return;
    try {
      folium.playback.pause();
    } catch {
      /* ignore */
    }
  });

  subscribe('account.changed', () => {
    resolvedCache.clear();
  });

  /* ---- 命令面板 ---- */

  const disposeCommands = [
    folium.registries.commands.register({
      id: 'open-cinema',
      label: label('看这首歌的 MV', 'Watch this song’s MV'),
      keywords: ['mv', 'bilibili', 'b站', '视频', '全屏', 'cinema'],
      run() {
        const song = currentSong();
        if (!song) return '现在没有正在播放的歌';
        open();
        return `正在找《${songTitleOf(song)}》的 MV`;
      },
    }),
    folium.registries.commands.register({
      id: 'login',
      label: label('B站账号：扫码登录（解锁 1080P）', 'bilibili: sign in by QR'),
      keywords: ['b站', 'bilibili', '扫码', '登录', 'cookie', '1080p'],
      run() {
        openLogin();
        return '正在打开扫码登录';
      },
    }),
    folium.registries.commands.register({
      id: 'status',
      label: label('B站账号：检查登录状态', 'bilibili: check sign-in'),
      keywords: ['b站', 'bilibili', '登录', '状态', 'cookie'],
      async run() {
        let status;
        try {
          status = await folium.rpc.call('biliStatus');
        } catch (err) {
          return `检查失败：${String((err && err.message) || err)}`;
        }
        if (!status || !status.ok) return `检查失败：${(status && status.error) || 'unknown'}`;
        if (!status.loggedIn) {
          return status.hasCookie
            ? 'Cookie 读到了，但 B 站说没登录 —— SESSDATA 大概过期了，重新扫一次'
            : '还没登录：命令面板「B站账号：扫码登录」，或设置里粘 Cookie';
        }
        const plan = status.vip ? '大会员：1080P60 / 4K 可用' : '普通账号：最高 1080P';
        folium.ui.toast(`已登录：${status.uname}（${plan}）`, { type: 'success', durationMs: 3000 });
        return `已登录：${status.uname} · ${plan}`;
      },
    }),
  ];

  /* ---------------------------------------------------------------- *
   * 扫码登录
   *
   * 画二维码要 qrcode 那个库；不用它也行 —— 退化成「把链接贴到浏览器」。
   * ---------------------------------------------------------------- */

  let loginUi = null;

  function openLogin() {
    if (!supportsSecret) {
      folium.ui.toast('当前 Folium 版本没有 secret 字段，扫码登录用不了（需要 1.7+）', {
        type: 'error',
        durationMs: 4200,
      });
      return;
    }
    if (loginUi) {
      loginUi.show();
      return;
    }

    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,.62);backdrop-filter:blur(6px);pointer-events:auto;';

    const card = document.createElement('div');
    card.style.cssText =
      'width:320px;padding:22px;border-radius:16px;background:#1c1c1f;color:#fff;' +
      'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;' +
      'box-shadow:0 26px 72px rgba(0,0,0,.62);border:1px solid rgba(255,255,255,.08);text-align:center;';
    wrap.appendChild(card);

    const heading = document.createElement('div');
    heading.textContent = '扫码登录 B 站';
    heading.style.cssText = 'font-size:15px;font-weight:600;';
    card.appendChild(heading);

    const hint = document.createElement('div');
    hint.textContent = '登录后 MV 能拿到 1080P / 1080P60 / 4K';
    hint.style.cssText = 'margin-top:6px;font-size:11.5px;color:rgba(255,255,255,.55);line-height:1.6;';
    card.appendChild(hint);

    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    canvas.style.cssText = 'margin:16px auto 0;display:block;border-radius:10px;background:#fff;padding:8px;';
    card.appendChild(canvas);

    const stateText = document.createElement('div');
    stateText.textContent = '正在向 B 站要二维码…';
    stateText.style.cssText = 'margin-top:12px;font-size:12px;color:rgba(255,255,255,.62);min-height:18px;';
    card.appendChild(stateText);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:14px;';
    const btnRefresh = document.createElement('button');
    btnRefresh.type = 'button';
    btnRefresh.textContent = '换一张';
    const btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.textContent = '关闭';
    for (const btn of [btnRefresh, btnClose]) {
      btn.style.cssText =
        'height:30px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.14);' +
        'background:rgba(255,255,255,.08);color:#fff;font-size:12px;cursor:pointer;';
      actions.appendChild(btn);
    }
    card.appendChild(actions);

    document.body.appendChild(wrap);

    let key = '';
    let timer = 0;
    let stopped = false;

    const stopPoll = () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
    };

    const paint = (text) => {
      if (text) stateText.textContent = text;
    };

    const poll = async () => {
      if (stopped || !key) return;
      let result;
      try {
        result = await folium.rpc.call('qrPoll', key);
      } catch {
        timer = window.setTimeout(poll, 2500);
        return;
      }
      if (stopped) return;

      if (result && result.state === 'confirmed' && result.cookie) {
        try {
          await folium.secrets.set('cookie', result.cookie);
          folium.ui.toast('B 站登录成功，MV 画质已解锁', { type: 'success', durationMs: 3000 });
        } catch (err) {
          paint(`登录成功，但写进凭证库失败：${String((err && err.message) || err)}`);
          return;
        }
        resolvedCache.clear();
        hide();
        return;
      }

      if (result && result.state === 'expired') {
        paint(result.message || '二维码过期了，点「换一张」');
        return;
      }

      paint((result && result.message) || '等待扫码…');
      timer = window.setTimeout(poll, 2000);
    };

    const draw = (text) => {
      try {
        const qr = qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        const count = qr.getModuleCount();
        const ctx = canvas.getContext('2d');
        const size = canvas.width;
        const cell = size / (count + 8);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#111';
        for (let row = 0; row < count; row += 1) {
          for (let col = 0; col < count; col += 1) {
            if (qr.isDark(row, col)) {
              ctx.fillRect(cell * (col + 4), cell * (row + 4), Math.ceil(cell), Math.ceil(cell));
            }
          }
        }
      } catch (err) {
        log.error('二维码生成失败', String((err && err.message) || err));
        paint('二维码画不出来，点「换一张」试试');
      }
    };

    const refresh = async () => {
      stopped = false;
      paint('正在向 B 站要二维码…');
      let result;
      try {
        result = await folium.rpc.call('qrGenerate');
      } catch (err) {
        paint(`要二维码失败：${String((err && err.message) || err)}`);
        return;
      }
      if (!result || !result.ok) {
        paint(`要二维码失败：${(result && result.error) || 'unknown'}`);
        return;
      }
      key = result.key;
      draw(result.url);
      paint('用 B 站 App 扫一下');
      stopPoll();
      stopped = false;
      timer = window.setTimeout(poll, 1800);
    };

    const show = () => {
      wrap.style.display = 'flex';
      void refresh();
    };

    const hide = () => {
      stopPoll();
      wrap.style.display = 'none';
    };

    btnRefresh.addEventListener('click', () => void refresh());
    btnClose.addEventListener('click', () => hide());
    wrap.addEventListener('click', (event) => {
      if (event.target === wrap) hide();
    });

    loginUi = { show, hide, dispose: () => { stopPoll(); wrap.remove(); loginUi = null; } };
    show();
  }

  /* ---------------------------------------------------------------- *
   * 退出
   * ---------------------------------------------------------------- */

  return () => {
    close(false);
    document.removeEventListener('click', onDocumentClick);
    for (const off of unsubscribers) {
      try {
        if (typeof off === 'function') off();
        else if (off && typeof off.unsubscribe === 'function') off.unsubscribe();
      } catch {
        /* ignore */
      }
    }
    for (const handle of disposeCommands) {
      try {
        if (typeof handle === 'function') handle();
        else if (handle && typeof handle.unregister === 'function') handle.unregister();
      } catch {
        /* ignore */
      }
    }
    try {
      if (typeof disposeLayer === 'function') disposeLayer();
      else if (disposeLayer && disposeLayer.unregister) disposeLayer.unregister();
      if (typeof disposeButton === 'function') disposeButton();
      else if (disposeButton && disposeButton.unregister) disposeButton.unregister();
    } catch {
      /* ignore */
    }
    if (loginUi) loginUi.dispose();
    if (pinnedSaveTimer) clearTimeout(pinnedSaveTimer);
    stopSync();
    resolvedCache.clear();
  };
}
