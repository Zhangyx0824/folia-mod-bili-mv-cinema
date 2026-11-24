# 上架记录 · MV 影院 bili-mv-cinema

## 当前状态（v1.0.0，首个版本）

| 项 | 状态 |
|---|---|
| 版本 | **1.0.0**（新模组，未提交） |
| 代码 | `bili-mv-cinema/` · `node test/smoke.mjs` 全绿 |
| 预览图 | `bili-mv-cinema/preview.jpg`（真 B 站 MV 帧 + 模组真实 DOM 截图，`node test/build_preview.mjs` 可复现） |
| 仓库 | 待建：`git@github.com:Zhangyx0824/folia-mod-bili-mv-cinema.git` |
| 剩下的事 | 建空仓 → push `main` + tag `v1.0.0` → 提上架 issue |

## 一、模组自述（提交字段可直接用）

- **名称**：MV 影院（MV Cinema）
- **id**：`bili-mv-cinema`
- **一句话**：播放栏的 MV 按钮点开就是全屏 MV，带原声，像 QQ 音乐。
- **权限**：`stageLayers`、`playback.control`、`filesystem.data`
- **网络**：直接请求 `api.bilibili.com` / `passport.bilibili.com`，所有请求在主进程发出（渲染进程不跨域）；视频流经本地 `127.0.0.1` 只读代理补 `Referer`。

## 二、和已有 `bili-mv-window` 的区别（给审核看的）

| | bili-mv-window | bili-mv-cinema |
|---|---|---|
| 形态 | 播放页右下角常驻小窗 | 进度条按钮 → 全屏页，不常驻 |
| 声音 | 只取视频轨，物理上静音 | 播放原声（DASH 双轨同步 / durl 整段 mp4） |
| 触发 | 换歌自动搜 | 点击才搜，一次只服务当前这首歌 |
| 交互 | 拖动、模糊、音画偏移等一堆小控件 | 顶部信息 + 底部控制条，3 秒自动隐藏 |

两个模组可以共存（挂载点不同：那边是 `stageLayers` 小窗 + 背景，这边是 `progressButtons` + `app.overlay`）。

## 三、提交步骤

1. 在 GitHub 手动建空仓 `folia-mod-bili-mv-cinema`（GitHub MCP 无建仓权限）。
2. 本地：

   ```bash
   cd ~/folia-mod-bili-mv-cinema
   git init && git add -A
   git commit -m "feat: MV 影院 v1.0.0 — 播放栏 MV 按钮 + 全屏有声播放"
   git tag v1.0.0
   git branch -M main
   git remote add origin git@github.com:Zhangyx0824/folia-mod-bili-mv-cinema.git
   git push -u origin main --tags
   ```

3. 到 folium-compound 仓库开「新模组收录」issue，字段：

   - `mod-id`: `bili-mv-cinema`
   - `repo`: `Zhangyx0824/folia-mod-bili-mv-cinema`
   - `ref`: `v1.0.0`
   - 简介与截图用上面的自述 + `preview.jpg`

   审核 CI 会给通过的版本打 `signed` 标签，随后出现在模组市场。

## 四、后续可做

- 记住每首歌上次挑的候选已经在做了（`folium.storage` 的 `pinned`）。
- 歌词：MV 页目前不显示歌词；如果上游愿意开一个「悬浮歌词」能力，可以在全屏页叠一行当前歌词。
- 倍速播放（`video.playbackRate`）——需要先确认音频轨同步是否还稳。
