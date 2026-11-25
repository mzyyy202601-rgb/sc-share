#!/usr/bin/env node
/**
 * 路线排序模块演示 —— 直接跑：node src/route_demo.js
 * 算法与项目内实现一致，去掉了 WXML、云函数和地图 SDK 依赖。
 * 依次演示：顺序优化、分日排程、顺路度评分、评分的饱和区间。
 */

const fs = require("fs");
const path = require("path");
const { haversine } = require("./lib/geo.js");
const { orderRoute, pathKm } = require("./lib/tsp.js");
const { planDays, WEIGHTS } = require("./lib/day-plan.js");
const { routeScore, dayLoad } = require("./lib/route-score.js");

/* ---------- 数据与画像 ---------- */
const SPOTS = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "beijing-spots.json"), "utf8"));
const CITY_ANCHOR = { lat: 39.9, lon: 116.4 }; // 北京城心（项目真实坐标库）
const HOTEL = { lat: 39.909, lon: 116.412 }; // 住宿地：王府井，每天从这里出门
const WISHED = ["八达岭长城", "故宫博物院"]; // 用户收藏的想玩清单
const PROFILE = { walk: 0 }; // 体力画像：怕累 → 费力景点加价
const PERIODS = ["上午", "下午", "傍晚", "晚上"];

const byName = (name) => SPOTS.find((x) => x.name === name);
const coordOf = (name) => {
  const s = byName(name);
  return s ? { lat: s.lat, lon: s.lon, approx: s.approx } : null;
};
/** 中日韩全角字符按 2 列宽计算，否则终端表格会歪 */
const width = (s) => String(s).replace(/[^\x00-\xff]/g, "xx").length;
const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - width(s)));
const hr = (t) => console.log("\n" + "─".repeat(74) + "\n" + t + "\n" + "─".repeat(74));

/* ---------- 1. 顺序优化：贪心 vs 2-opt ---------- */
hr("1. 顺序优化：把 17 个景点串成一条不折返的参观顺序");
console.log("   （算法演示，不是「一天走完 17 个」，只比较顺序好坏带来的里程差）\n");
const naiveKm = pathKm([HOTEL, ...SPOTS]); // 数据原始顺序 ≈「按名单顺序走」
const route = orderRoute(SPOTS, HOTEL);
const saveGreedy = ((naiveKm - route.greedyKm) / naiveKm) * 100;
const save2opt = ((route.greedyKm - route.km) / route.greedyKm) * 100;
console.log(`  按数据原始顺序       ${naiveKm.toFixed(1)} km`);
console.log(`  最近邻贪心           ${route.greedyKm.toFixed(1)} km   （较原始顺序 -${saveGreedy.toFixed(1)}%）`);
console.log(`  + 2-opt 局部搜索     ${route.km.toFixed(1)} km   （再 -${save2opt.toFixed(1)}%，${route.rounds} 轮收敛）`);
console.log(`\n  访问顺序：`);
console.log(`  ${route.path.map((p) => (p === HOTEL ? "【王府井·出发】" : p.name)).join(" → ")}`);

/* ---------- 2. 分日排程 ---------- */
// 全天型景点（八达岭这类远郊大点）本就占掉一整天，先单独拎出来各成一日，
// 再让剩下的半天型景点按时段排 —— 这是线上 BIG_SPOT_DAYS 的思路。
const isFullDay = (s) => Array.isArray(s.periods) && s.periods.length === 1 && s.periods[0] === "全天";
const FULL_DAY = SPOTS.filter(isFullDay);
const HALF_DAY = SPOTS.filter((s) => !isFullDay(s));
// 天数按「总点数 ÷ 每天时段数」起步；若某些只在特定时段开放的点被挤掉，
// 就自动加一天再排 —— 线上同样不允许静默丢景点。
const baseDays = Math.ceil(HALF_DAY.length / PERIODS.length);
let daysNeeded = baseDays;
let plan = [];
for (; daysNeeded <= 8; daysNeeded++) {
  plan = planDays({
    spots: HALF_DAY,
    anchor: CITY_ANCHOR,
    hotel: HOTEL,
    days: daysNeeded,
    periods: PERIODS,
    profile: PROFILE,
    wished: WISHED,
  });
  const placed = new Set(plan.flatMap((d) => d.items.map((i) => i.name)));
  if (placed.size === HALF_DAY.length) break;
}

hr(`2. 分日排程：${daysNeeded} 天常规日 + ${FULL_DAY.length} 天一日游`);
console.log(`   画像：体力=怕累（费力景点 +${WEIGHTS.effortPenalty} km 权重）`);
console.log(`   想玩清单：${WISHED.join("、")}（-${-WEIGHTS.wishedBoost} km 权重，绕路也要排进去）`);
console.log(`   市区判定：距城心 ≤ ${WEIGHTS.urbanRadiusKm} km；远郊点不混进市区日`);
if (daysNeeded > baseDays) console.log(`   （${baseDays} 天排不下全部时段受限的景点，自动加到 ${daysNeeded} 天）`);
console.log("");

let totalKm = 0;
const dayKm = (items) => pathKm([HOTEL, ...items.map((i) => coordOf(i.name)).filter(Boolean)]);
plan.forEach((d) => {
  const km = dayKm(d.items);
  totalKm += km;
  console.log(`  D${d.day}（常规日 · 动线 ${km.toFixed(1)} km）`);
  d.items.forEach((i) => {
    console.log(
      `    ${pad(i.period, 6)}${pad(i.name, 14)}${pad(i.hours.toFixed(1) + " h", 8)}体力 ${i.effort}` +
        `   本段 ${pad(i.legKm.toFixed(1) + " km", 9)}${i.far ? "【远郊】" : ""}`
    );
  });
  console.log(`    ${pad("", 6)}${dayLoad(d.items).txt}\n`);
});
FULL_DAY.forEach((s, k) => {
  const km = haversine(HOTEL, s) * 2; // 往返，一日游当天不再回市区逛
  totalKm += km;
  console.log(`  D${plan.length + k + 1}（一日游）${pad(s.name, 14)}${pad(s.hours.toFixed(1) + " h", 8)}往返约 ${km.toFixed(1)} km`);
});
const planned = new Set([...plan.flatMap((d) => d.items.map((i) => i.name)), ...FULL_DAY.map((s) => s.name)]);
const dropped = SPOTS.filter((s) => !planned.has(s.name)).map((s) => s.name);
console.log(
  dropped.length
    ? `\n  ⚠ 未排入（时段槽位不足）：${dropped.join("、")}`
    : `\n  ✓ ${SPOTS.length} 个景点全部排入，无遗漏`
);
console.log("");

/* ---------- 3. 顺路度评分 ---------- */
hr("3. 每天动线顺路度评分（routeScore：只评分，不改序）");
plan.forEach((d) => {
  const r = routeScore(d.items, coordOf);
  if (!r.ok) {
    console.log(`  D${d.day}  ${pad("真实坐标不足 2 个，不评分（不用估算坐标给假里程）", 52)}   —`);
    return;
  }
  console.log(`  D${d.day}  ${pad(r.txt, 52)}${pad(r.score + " 分", 8)}${r.feel}`);
});
FULL_DAY.forEach((s, k) => {
  console.log(`  D${plan.length + k + 1}  单点一日游，不参与顺路度评分（相邻点不足 2 个）`);
});

/* ---------- 4. 评分的能力边界 ---------- */
hr("4. 评分的能力边界：什么时候饱和、什么时候掉分");
const nearFour = ["故宫博物院", "景山公园", "北海公园", "什刹海"];
const withMing = ["故宫博物院", "景山公园", "北海公园", "明十三陵"];
const r1 = routeScore(nearFour.map((n) => ({ name: n })), coordOf);
const r2 = routeScore(withMing.map((n) => ({ name: n })), coordOf);
console.log(`  同片区 4 点：${nearFour.join(" ")}`);
console.log(`     ${pad(r1.txt, 52)}${pad(r1.score + " 分", 8)}${r1.feel}`);
console.log(`  把明十三陵硬塞进市区那一串：`);
console.log(`     ${pad(r2.txt, 52)}${pad(r2.score + " 分", 8)}${r2.feel}`);
console.log(`\n  → 同城近点之间分数会饱和在 95：这些点本来就在 5 km 内。`);
if (r2.long) {
  console.log(`    跨片区硬塞才会真掉分（${r1.score} → ${r2.score}），而且文案会点名拖累动线的那个点。`);
}
console.log(`    所以线上只把这个分数当「当天动线提示」展示，从不拿它做跨天排名。`);

/* ---------- 汇总 ---------- */
hr("汇总");
console.log(`  数据集             ${SPOTS.length} 个北京景点（真实坐标，approx=false）`);
console.log(`  顺序优化           ${naiveKm.toFixed(1)} km → ${route.km} km（-${(((naiveKm - route.km) / naiveKm) * 100).toFixed(1)}%）`);
console.log(`  排程结果           ${plan.length + FULL_DAY.length} 天，合计约 ${totalKm.toFixed(1)} km（每天从住宿地出发独立计算）`);
console.log(`  运行环境           Node ${process.version}`);
console.log("");
