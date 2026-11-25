/**
 * 路线排序：最近邻贪心 + 2-opt 局部搜索。
 * 移植自项目内 planner.js 的省内多城排序段，只把排序对象从城市换成景点，算法未改。
 *
 * 不用精确 TSP：景点量级是几十个，精确解耗时或需要第三方库。最近邻保证不折返，
 * 2-opt 再把交叉路段拉直。起点固定为住宿地，2-opt 的内层循环从下标 1 开始，
 * 不改 path[0]，否则会得到「先绕到中间再回来」的顺序。
 */

const { haversine } = require("./geo.js");

/** 最近邻贪心：每次取离「当前点」最近的下一个点 */
function nearestNeighbor(points, start) {
  if (!points.length) return [];
  const ordered = [start];
  const rest = points.slice();
  let cursor = start;
  while (rest.length) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < rest.length; i++) {
      const d = haversine(rest[i], cursor);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    ordered.push(rest[bestIdx]);
    cursor = rest[bestIdx];
    rest.splice(bestIdx, 1);
  }
  return ordered;
}

/** 路径总里程（不含回到起点，行程是单向的） */
function pathKm(path) {
  let sum = 0;
  for (let i = 1; i < path.length; i++) sum += haversine(path[i - 1], path[i]);
  return sum;
}

/**
 * 2-opt：反转子路径，里程下降就保留。
 * 判定加 0.5 km 死区，避免 0.1 km 的坐标取整抖动让循环一直重复。
 */
function twoOpt(path, maxRounds = 60) {
  if (path.length < 4) return { path, km: pathKm(path), rounds: 0 };
  let bestRoute = path.slice();
  let bestKm = pathKm(bestRoute);
  let improved = true;
  let rounds = 0;
  while (improved && rounds < maxRounds) {
    improved = false;
    rounds++;
    for (let i = 1; i < bestRoute.length - 1; i++) {
      for (let j = i + 1; j < bestRoute.length; j++) {
        const cand = bestRoute.slice(0, i).concat(bestRoute.slice(i, j + 1).reverse(), bestRoute.slice(j + 1));
        const km = pathKm(cand);
        if (km + 0.5 < bestKm) {
          bestRoute = cand;
          bestKm = km;
          improved = true;
        }
      }
    }
  }
  return { path: bestRoute, km: bestKm, rounds };
}

/** 从 start 出发，返回不折返的顺序，同时给出贪心解和 2-opt 后的里程 */
function orderRoute(points, start) {
  const greedy = nearestNeighbor(points, start);
  const beforeKm = pathKm(greedy);
  const opt = twoOpt(greedy);
  return {
    start,
    path: opt.path,
    greedyKm: Math.round(beforeKm * 10) / 10,
    km: Math.round(opt.km * 10) / 10,
    rounds: opt.rounds,
  };
}

module.exports = { nearestNeighbor, pathKm, twoOpt, orderRoute };
