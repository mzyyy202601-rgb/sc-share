#!/usr/bin/env node
/**
 * 路线模块自测 —— 直接跑：node tests/test_route.js
 * 断言运行行为：里程是否变短、景点是否遗漏或重复、起点是否固定、远郊是否混进市区日、
 * 想玩清单是否排入、估算坐标是否被拒绝计分。失败时退出码为 1。
 */

const fs = require("fs");
const path = require("path");
const { haversine } = require("../src/lib/geo.js");
const { orderRoute, pathKm } = require("../src/lib/tsp.js");
const { planDays } = require("../src/lib/day-plan.js");
const { routeScore, dayLoad } = require("../src/lib/route-score.js");

const SPOTS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "data", "beijing-spots.json"), "utf8"));
const CITY_ANCHOR = { lat: 39.9, lon: 116.4 };
const HOTEL = { lat: 39.909, lon: 116.412 };
const byName = (n) => SPOTS.find((s) => s.name === n);
const coordOf = (n) => {
  const s = byName(n);
  return s ? { lat: s.lat, lon: s.lon, approx: s.approx } : null;
};

let pass = 0;
let fail = 0;
const ck = (name, cond, extra) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? "  → " + extra : ""}`);
  }
};

/* ---------- 1. 球面距离 ---------- */
console.log("\n[1] haversine");
ck("同一个点距离为 0", haversine(HOTEL, HOTEL) === 0);
ck("对称：A→B 与 B→A 相等", haversine(HOTEL, CITY_ANCHOR) === haversine(CITY_ANCHOR, HOTEL));
const gugongTiantan = haversine(byName("故宫博物院"), byName("天坛公园"));
ck("故宫↔天坛 落在 3~5 km（真实值约 3.9 km）", gugongTiantan > 3 && gugongTiantan < 5, String(gugongTiantan));
const bada = haversine(byName("八达岭长城"), byName("天安门广场"));
ck("八达岭↔天安门 落在 55~70 km（真实值约 60 km）", bada > 55 && bada < 70, String(bada));
ck("缺坐标时返回 0（不抛异常）", haversine(null, HOTEL) === 0 && haversine({ lat: NaN, lon: 1 }, HOTEL) === 0);
ck("兼容 {latitude, longitude} 入参", haversine({ latitude: 39.909, longitude: 116.397 }, HOTEL) > 0);

/* ---------- 2. 顺序优化 ---------- */
console.log("\n[2] orderRoute（最近邻 + 2-opt）");
const naiveKm = pathKm([HOTEL, ...SPOTS]);
const route = orderRoute(SPOTS, HOTEL);
ck("优化后总里程短于原始顺序", route.km < naiveKm, `${route.km} vs ${naiveKm.toFixed(1)}`);
ck("2-opt 不劣于纯贪心", route.km <= route.greedyKm + 0.1, `${route.km} vs ${route.greedyKm}`);
ck("起点固定在住宿地（2-opt 不重排第一个点）", route.path[0] === HOTEL);
const names = route.path.filter((p) => p !== HOTEL).map((p) => p.name);
ck("景点数量没丢", names.length === SPOTS.length, `${names.length}/${SPOTS.length}`);
ck("没有重复访问", new Set(names).size === names.length);
ck("访问集合与原集合一致", SPOTS.every((s) => names.includes(s.name)));

/* ---------- 3. 分日排程 ---------- */
console.log("\n[3] planDays（带权游标最近邻）");
const HALF = SPOTS.filter((s) => !(s.periods.length === 1 && s.periods[0] === "全天"));
const plan = planDays({
  spots: HALF,
  anchor: CITY_ANCHOR,
  hotel: HOTEL,
  days: 6,
  periods: ["上午", "下午", "傍晚", "晚上"],
  profile: { walk: 0 },
  wished: ["八达岭长城", "故宫博物院"],
});
const all = plan.flatMap((d) => d.items.map((i) => i.name));
ck("6 天把 16 个半天型景点全部排入", all.length === HALF.length, `${all.length}/${HALF.length}`);
ck("同一天不重复出现同一景点", plan.every((d) => new Set(d.items.map((i) => i.name)).size === d.items.length));
ck("想玩清单里的景点必须被排入", ["故宫博物院"].every((n) => all.includes(n)));
const farDays = plan.filter((d) => d.items.some((i) => i.far));
ck("远郊点不会与多个市区点同日（十三陵单独成半日）", farDays.every((d) => d.items.filter((i) => !i.far).length <= 1));
const farItem = plan.flatMap((d) => d.items).find((i) => i.name === "明十三陵");
ck("十三陵被标记为远郊", !!farItem && farItem.far === true);
ck("每天第一段从住宿地出发（首段距离 > 0）", plan.every((d) => d.items.length === 0 || d.items[0].legKm > 0));
ck("当天景点时长合计不超过 12 小时", plan.every((d) => dayLoad(d.items).over === 0));

/* ---------- 4. 顺路度评分 ---------- */
console.log("\n[4] routeScore / dayLoad");
const near = ["故宫博物院", "景山公园", "北海公园", "什刹海"].map((n) => ({ name: n }));
const rNear = routeScore(near, coordOf);
ck("同片区 4 点评为「很顺路」", rNear.ok && rNear.score >= 88, JSON.stringify(rNear));
const withFar = ["故宫博物院", "景山公园", "北海公园", "明十三陵"].map((n) => ({ name: n }));
const rFar = routeScore(withFar, coordOf);
ck("塞入远郊点后分数下降", rFar.score < rNear.score, `${rFar.score} vs ${rNear.score}`);
ck("长转场被标记 long", rFar.long === true);
ck("文案点名拖累动线的点", rFar.txt.includes("明十三陵"), rFar.txt);
ck("分数落在色档区间（good/mid/low）", ["rb-good", "rb-mid", "rb-low"].includes(rFar.scoreCls));
ck("点数不足 2 个不评分", routeScore([{ name: "故宫博物院" }], coordOf).ok === false);
ck("估算坐标（approx !== false）不计分", routeScore([{ name: "故宫博物院" }, { name: "香山公园" }], (n) => {
  const c = coordOf(n);
  return c ? { ...c, approx: true } : null;
}).ok === false);
ck("无坐标景点被跳过而不是给 (0,0) 距离", routeScore([{ name: "故宫博物院" }, { name: "不存在的点" }], coordOf).ok === false);
const load = dayLoad([{ hours: 4 }, { hours: 3 }]);
ck("7 小时负荷判定为健康", load.over === 0 && load.hours === 7);
ck("14 小时负荷判定为超时 2 小时", dayLoad([{ hours: 8 }, { hours: 6 }]).over === 2);

/* ---------- 5. 数据完整性 ---------- */
console.log("\n[5] 数据集");
ck("全部景点带真实坐标（approx=false）", SPOTS.every((s) => s.approx === false && isFinite(s.lat) && isFinite(s.lon)));
ck("全部景点带可接受时段数组", SPOTS.every((s) => Array.isArray(s.periods) && s.periods.length > 0));
ck("坐标落在北京经纬度范围内", SPOTS.every((s) => s.lat > 39.4 && s.lat < 41 && s.lon > 115.4 && s.lon < 117.6));
ck("没有同名景点", new Set(SPOTS.map((s) => s.name)).size === SPOTS.length);

/* ---------- 汇总 ---------- */
console.log(`\n${fail === 0 ? "全部通过" : "有失败项"}：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
