/**
 * index.cjs 里几个纯函数的单元测试（不联网）。
 *
 *   node test/unit.mjs
 *
 * 这里守的是两个容易悄悄坏掉的约定：
 *   · 分P投稿要取「正片」那一 P，而不是接口里默认指向的 P1；
 *   · 十几秒的片段不能排到候选第一位。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const mod = require(path.join(here, '..', 'bili-mv-cinema', 'index.cjs'));
const { pickPage, thumbCover, rankCandidates, MIN_MV_SECONDS } = mod.__internal;

/* ---- 1. 分P：取时长最长的那一 P ---- */
{
  const single = pickPage({ cid: 111, duration: 240 });
  assert.equal(single.cid, 111, '没分P时还是用 data.cid');
  assert.equal(single.durationSec, 240);

  const multi = pickPage({
    cid: 111,
    duration: 268,
    pages: [
      { cid: 111, page: 1, part: '预告', duration: 15 },
      { cid: 222, page: 2, part: '完整版 MV', duration: 253 },
    ],
  });
  assert.equal(multi.cid, 222, 'P1 只有十几秒时，要取正片那一 P');
  assert.equal(multi.durationSec, 253);
  assert.equal(multi.page, 2);
  assert.equal(multi.part, '完整版 MV');

  // 乱序的 pages（接口偶尔不是升序）也取最长的一 P
  const shuffled = pickPage({
    pages: [
      { cid: 3, duration: 180 },
      { cid: 1, duration: 62 },
      { cid: 2, duration: 240 },
    ],
  });
  assert.equal(shuffled.cid, 2);

  // 没有 cid 的坏数据跳过，别挑出一条放不出来的
  const broken = pickPage({ cid: 9, pages: [{ cid: 0, duration: 999 }, { cid: 9, duration: 30 }] });
  assert.equal(broken.cid, 9);
}

/* ---- 2. 十几秒的片段排到最后 ---- */
{
  assert.equal(MIN_MV_SECONDS, 20);

  const want = { title: '晴天', artist: '周杰伦', durationMs: 270000 };
  const base = { author: '周杰伦', mid: '1', typename: 'MV', play: 500000, like: 2000, pic: '' };
  const ranked = rankCandidates(
    [
      { ...base, bvid: 'BVshort00001', title: '周杰伦 晴天 MV 15秒切片', duration: '0:15' },
      { ...base, bvid: 'BVnormal001', title: '周杰伦 晴天 官方 MV', duration: '4:30' },
      { ...base, bvid: 'BVunknown01', title: '周杰伦 晴天 现场版', duration: '' },
    ],
    want,
  );

  const order = ranked.map((entry) => entry.item.bvid);
  assert.equal(order[0], 'BVnormal001', '正常长度的正片要排第一');
  assert.equal(order.at(-1), 'BVshort00001', '十几秒的片段整批沉底');
  assert.equal(ranked.at(-1).score.short, true, '片段要打上 short 标记，界面上好提示');
}

/* ---- 3. 封面缩略图：只动 B 站图床，别家原样返回 ---- */
{
  assert.equal(
    thumbCover('//i0.hdslb.com/bfs/archive/abc.jpg'),
    'https://i0.hdslb.com/bfs/archive/abc.jpg@176w_100h_1c.webp',
  );
  assert.equal(
    thumbCover('http://i1.hdslb.com/bfs/archive/abc.jpg@672w_378h_1c.webp'),
    'https://i1.hdslb.com/bfs/archive/abc.jpg@176w_100h_1c.webp',
    '已经带过参数的老地址要换成小图，别叠加两层',
  );
  assert.equal(
    thumbCover('https://p1.music.126.net/qing.jpg'),
    'https://p1.music.126.net/qing.jpg',
    '网易云封面不归我们处理，原样返回',
  );
  assert.equal(thumbCover(''), '');
}

console.log('✓ 单元测试：分P取正片 / 片段沉底 / 封面缩略图');
