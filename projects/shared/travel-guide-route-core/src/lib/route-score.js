/**
 * 顺路度评分与当天负荷，移植自项目内 utils/travel.js。
 *
 * routeScore 是纯函数，只评分不改序。排序在生成阶段完成，评分只用来展示。
 * 只统计 approx === false 的真实坐标，避免估算坐标得出假里程。
 * 主指标是相邻点的平均间距，不用总里程；总里程随点数增长，无法横向比较。
 * 若某一段超过 20 km 且大于平均间距的 2.2 倍，扣 12 分并在文案中点名该点。
 */

const { haversine } = require("./geo.js");

const SCORE_TIERS = [
  { maxAvg: 6, score: 95 },
  { maxAvg: 12, score: 89 },
  { maxAvg: 25, score: 81 },
  { maxAvg: 45, score: 71 },
  { maxAvg: Infinity, score: 58 },
];

function feelOf(score) {
  if (score >= 88) return "很顺路";
  if (score >= 76) return "较顺路";
  if (score >= 62) return "一般，有绕路";
  return "偏赶，建议挪点";
}

function scoreClsOf(score) {
  if (score >= 88) return "rb-good";
  if (score >= 62) return "rb-mid";
  return "rb-low";
}

/**
 * @param {Array} items 当天行程项 [{ name }]，顺序即真实动线顺序
 * @param {function} coordOf (name) => {lat, lon, approx} | null
 */
function routeScore(items, coordOf) {
  const pts = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((it) => {
    const n = it && it.name;
    if (!n || seen.has(n)) return;
    seen.add(n);
    const c = coordOf(n);
    if (c && c.lat && c.lon && c.approx === false) pts.push({ lat: c.lat, lon: c.lon, name: n });
  });
  if (pts.length < 2) return { ok: false, n: pts.length };

  let km = 0;
  let mx = 0;
  let mxIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversine(pts[i - 1], pts[i]);
    km += d;
    if (d > mx) {
      mx = d;
      mxIdx = i;
    }
  }
  const avg = km / (pts.length - 1);
  let score;
  if (pts.length === 2) {
    score = avg <= 15 ? 93 : avg <= 40 ? 82 : 66;
  } else {
    score = SCORE_TIERS.find((t) => avg <= t.maxAvg).score;
  }
  let long = false;
  if (mx > 20 && mx > avg * 2.2) {
    long = true;
    score = Math.max(48, score - 12);
  }
  const txt =
    pts.length + " 个点 · 动线约 " + Math.round(km) + " km" + (long ? " · 有跨片区长转场（" + pts[mxIdx].name + "）" : "");
  return {
    ok: true,
    n: pts.length,
    km: Math.round(km),
    score,
    txt,
    feel: feelOf(score),
    long,
    scoreCls: scoreClsOf(score),
  };
}

/** 当天负荷：景点合计时长 vs 12 小时可用时长 */
function dayLoad(items) {
  const list = (Array.isArray(items) ? items : []).filter((it) => it && typeof it.hours === "number");
  const total = list.reduce((a, x) => a + x.hours, 0);
  const over = Math.max(0, total - 12);
  const round1 = (v) => Math.round(v * 10) / 10;
  return {
    n: list.length,
    hours: round1(total),
    over: round1(over),
    txt: "景点合计约 " + round1(total) + " 小时" + (over > 0 ? "，超出 12 小时可用时长 " + round1(over) + " 小时，建议减负" : "，节奏健康"),
  };
}

module.exports = { routeScore, dayLoad, feelOf, scoreClsOf };
