/**
 * 分日排程：带权游标最近邻。移植自项目内 planner.js 的 nearest()。
 *
 * 按最近邻直接排会把远郊景点混进市区日。这里把距离、时段、体力、想玩清单
 * 都折算成公里数，放在同一次比较里：
 *   1. 距城心 ≤ 25 km 算市区。市区和远郊各取候选，只有游标已在远郊、
 *      或市区快排完时才从远郊起手，长城和十三陵会自然排到同一天。
 *   2. 想玩清单减 400 km，体力画像给费力景点加 260 km。
 *   3. 游标每天重置到住宿地。
 */

const { haversine } = require("./geo.js");

const WEIGHTS = {
  urbanRadiusKm: 25, // 距城心超过这个距离算「远郊」
  effortPenalty: 260, // 体力画像=怕累(walk:0) 时，费力景点(level 2)的加价
  wishedBoost: -400, // 想玩清单里的景点优先（负值=更容易被选中）
  noCoordPenalty: 9999, // 没有真实坐标的点最后兜底，绝不能靠「猜的距离」排在前面
};

/**
 * @param {object}   opts
 * @param {Array}    opts.spots    候选景点（含 name/period/lat/lon/effort）
 * @param {object}   opts.anchor   城心坐标 {lat, lon}
 * @param {object}   opts.hotel    住宿地坐标，作为每天的出发游标
 * @param {number}   opts.days     天数
 * @param {string[]} opts.periods  每天要填的时段，如 ["上午","下午","傍晚"]
 * @param {object}   [opts.profile] 出行画像 { walk: 0|1 }  walk=0 表示怕累
 * @param {string[]} [opts.wished]  想玩清单
 * @param {function} [opts.modeEff]  出行模式偏好，返回 km 加成
 * @param {function} [opts.biasEff]  攻略风格偏好，返回 km 加成
 */
function planDays(opts) {
  const spots = (opts.spots || []).map((s) => ({ ...s }));
  const anchor = opts.anchor || null;
  const hotel = opts.hotel || anchor;
  const days = Math.max(1, opts.days || 1);
  const periods = opts.periods && opts.periods.length ? opts.periods : ["上午", "下午", "傍晚"];
  const profile = opts.profile || null;
  const wished = new Set(opts.wished || []);
  const modeEff = typeof opts.modeEff === "function" ? opts.modeEff : () => 0;
  const biasEff = typeof opts.biasEff === "function" ? opts.biasEff : () => 0;

  const isFar = (s) => (anchor ? haversine(s, anchor) > WEIGHTS.urbanRadiusKm : false);
  // 项目内数据是单个 period，这里允许景点带多个可接受时段，避免时段受限的景点被丢弃。
  const periodsOf = (s) => (Array.isArray(s.periods) && s.periods.length ? s.periods : [s.period]);
  const fits = (s, wanted) => periodsOf(s).some((p) => wanted.includes(p));
  let urbanLeft = spots.filter((s) => !isFar(s)).length;
  let farLeft = spots.length - urbanLeft;

  const takeOne = (wanted, cursor) => {
    let bestIdx = -1;
    let bestDist = Infinity;
    let farIdx = -1;
    let farDist = Infinity;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      if (!fits(s, wanted)) continue;
      let d = s.lat != null && s.lon != null && cursor ? haversine(s, cursor) : WEIGHTS.noCoordPenalty;
      d += modeEff(s.name) + biasEff(s.name);
      if (profile && profile.walk === 0 && s.effort >= 2) d += WEIGHTS.effortPenalty;
      if (wished.has(s.name)) d += WEIGHTS.wishedBoost;
      if (isFar(s)) {
        if (d < farDist) {
          farDist = d;
          farIdx = i;
        }
      } else if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const cursorFar = cursor && anchor ? haversine(cursor, anchor) > WEIGHTS.urbanRadiusKm : false;
    const startFar = urbanLeft <= 1 && farLeft >= 2;
    const idx = cursorFar || startFar ? (farIdx >= 0 ? farIdx : bestIdx) : bestIdx >= 0 ? bestIdx : farIdx;
    if (idx < 0) return null;
    const s = spots.splice(idx, 1)[0];
    if (isFar(s)) farLeft--;
    else urbanLeft--;
    return s;
  };

  const out = [];
  for (let d = 0; d < days; d++) {
    let cursor = hotel ? { lat: hotel.lat, lon: hotel.lon } : null;
    const items = [];
    for (const p of periods) {
      // 当前时段没有候选时，用「全天」景点填空。
      const s = takeOne([p], cursor) || takeOne(["全天"], cursor);
      if (!s) continue;
      const from = cursor;
      const legKm = from ? haversine(s, from) : 0;
      if (s.lat != null && s.lon != null) cursor = { lat: s.lat, lon: s.lon };
      items.push({ name: s.name, period: p, effort: s.effort, hours: s.hours, legKm, far: isFar(s) });
    }
    out.push({ day: d + 1, items });
  }
  return out;
}

module.exports = { planDays, WEIGHTS };
