/**
 * 球面距离，与项目内 utils/geo.js 的 haversine 一致。
 * 经度 1 度在北京约 85 km，纬度 1 度约 111 km，不能直接相加，所以用 haversine。
 * 输出保留 1 位小数，端上显示的「动线约 N km」用的就是这个数。
 */

function _num(...args) {
  for (const v of args) if (typeof v === "number" && isFinite(v)) return v;
  return NaN;
}

/** 支持 {lat, lon} 与 {latitude, longitude} 两种入参（端上两套对象混用） */
function haversine(a, b) {
  if (!a || !b) return 0;
  const lat1 = _num(a.lat, a.latitude);
  const lon1 = _num(a.lon, a.longitude);
  const lat2 = _num(b.lat, b.latitude);
  const lon2 = _num(b.lon, b.longitude);
  if (!(isFinite(lat1) && isFinite(lon1) && isFinite(lat2) && isFinite(lon2))) return 0;
  const R = Math.PI / 180;
  const dLat = (lat2 - lat1) * R;
  const dLon = (lon2 - lon1) * R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * R) * Math.cos(lat2 * R) * Math.sin(dLon / 2) ** 2;
  return Math.round(12742 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

module.exports = { haversine };
