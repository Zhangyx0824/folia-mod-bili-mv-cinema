# 上架记录 · MV 影院 bili-mv-cinema

## 当前状态（v1.3.0）

| 项 | 状态 |
|---|---|
| 版本 | **1.3.0**（未提交） |
| 代码 | `bili-mv-cinema/` · `node test/smoke.mjs` 全绿 |
| 预览图 | `bili-mv-cinema/preview.jpg`（真 B 站 MV 帧 + 模组真实 DOM 截图，`node test/build_preview.mjs` 可复现） |
| 仓库 | 待建：`git@github.com:Zhangyx0824/folia-mod-bili-mv-cinema.git` |
| 剩下的事 | 建空仓 → push `main` + tag `v1.3.0` → 提上架 issue |

### v1.3.0 改了什么

- **删掉歌词与弹幕**：全屏页不再叠歌词行、不再拉 B 站弹幕、也没有发弹幕的入口和设置项；控制条与设置面板只留「看 MV 本身」需要的东西。主进程里对应的接口（弹幕 XML、发弹幕）一并删除，模组回到纯只读。
- **点播放列表不再跳走**：宿主的 `playQueueItem` / `playSong` 会顺手打开它自己的播放页，把 MV 页顶掉 —— 这就是「点了列表里的某一支 MV，却跳去歌曲播放界面」的原因。现在点一行**就地取流播放**（用这一行已搜到的 bvid，不重搜、不动宿主）；退出影院时才把宿主队列补到那一首，音乐从那首接着放。

### v1.1.0 改了什么

- **官方权重**：投稿分区 `MV` +30、UP 主名带官方/厂牌、UP 主认证（机构认证 +22 / 认证名带歌手名 +12 / 歌手本人号 +16）三层加码；头部不够像 MV 时补搜一次「歌名 歌手 MV」并合并去重。8 首歌实测全部落到 `MV` 分区。
- **播放列表**：右侧抽屉按 Folia 队列列出接下来要看的 MV（封面先专辑图、再换成 B 站 MV 封面），点一行切过去，放完自动连播下一首。
- 换歌不再是「关掉 MV」，而是跟着换片。

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
   git commit -m "feat: MV 影院 v1.3.0 — 列表就地播放，去掉歌词与弹幕"
   git tag v1.3.0
   git branch -M main
   git remote add origin git@github.com:Zhangyx0824/folia-mod-bili-mv-cinema.git
   git push -u origin main --tags
   ```

3. 到 folium-compound 仓库开「新模组收录」issue，字段：

   - `mod-id`: `bili-mv-cinema`
   - `repo`: `Zhangyx0824/folia-mod-bili-mv-cinema`
   - `ref`: `v1.3.0`
   - 简介与截图用上面的自述 + `preview.jpg`

   审核 CI 会给通过的版本打 `signed` 标签，随后出现在模组市场。

## 四、后续可做

- 记住每首歌上次挑的候选已经在做了（`folium.storage` 的 `pinned`）。
- 倍速播放（`video.playbackRate`）——需要先确认音频轨同步是否还稳。
