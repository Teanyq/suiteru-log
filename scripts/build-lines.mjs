// 国土数値情報（鉄道データ N02）の駅 GeoJSON から、アプリで使う路線・駅の一覧 www/lines.json を作る。
// 使い方: node scripts/build-lines.mjs <N02-xx_Station.geojson>
// 出典表示が必要（CC BY 4.0）: 「国土数値情報（鉄道データ）（国土交通省）」を加工して作成
import { readFileSync, writeFileSync } from "node:fs";
import { regionOf } from "./region.mjs";

const src = process.argv[2];
if (!src) { console.error("usage: node scripts/build-lines.mjs <N02-xx_Station.geojson>"); process.exit(1); }
const { features } = JSON.parse(readFileSync(src, "utf8"));


const mid = (coords) => coords[Math.floor(coords.length / 2)];
const lines = new Map(); // key: 会社|路線
for (const { properties: p, geometry: g } of features) {
  const key = `${p.N02_004}|${p.N02_003}`;
  const [lon, lat] = mid(g.coordinates);
  let l = lines.get(key);
  if (!l) lines.set(key, (l = { company: p.N02_004, line: p.N02_003, kind: p.N02_002, stations: new Map() }));
  if (!l.stations.has(p.N02_005)) l.stations.set(p.N02_005, [lat, lon]);
}

// 駅の並び: 線路の形の情報はないので、駅を「全体の道のりがいちばん短くなる一本道」でつなぐ
// （どの駅から始めるかを全部試し、近い駅へ順に進んだあと 2-opt で交差をほどく）。
// 東西・南北に並べるだけだと、大江戸線のように曲がった・輪になった路線で隣り合わない駅が並ぶため
function ordered(stations) {
  const pts = [...stations];
  if (pts.length < 3) return pts;
  const d = (a, b) => Math.hypot(a[1][0] - b[1][0], (a[1][1] - b[1][1]) * Math.cos((a[1][0] * Math.PI) / 180));
  const length = (path) => path.reduce((sum, p, i) => sum + (i ? d(path[i - 1], p) : 0), 0);
  const twoOpt = (path) => {
    for (let improved = true; improved; ) {
      improved = false;
      for (let i = 0; i < path.length - 1; i++)
        for (let j = i + 2; j < path.length; j++) {
          // 区間 [i+1, j] を逆向きにして短くなるなら入れ替える（端は開いたまま）
          const before = d(path[i], path[i + 1]) + (j + 1 < path.length ? d(path[j], path[j + 1]) : 0);
          const after = d(path[i], path[j]) + (j + 1 < path.length ? d(path[i + 1], path[j + 1]) : 0);
          if (after < before - 1e-12) { path.splice(i + 1, j - i, ...path.slice(i + 1, j + 1).reverse()); improved = true; }
        }
    }
    return path;
  };
  let best = null;
  for (const start of pts) {
    const path = [start], rest = new Set(pts.filter((p) => p !== start));
    while (rest.size) {
      const last = path.at(-1);
      let near = null;
      for (const p of rest) if (!near || d(last, p) < d(last, near)) near = p;
      path.push(near); rest.delete(near);
    }
    twoOpt(path);
    if (!best || length(path) < length(best)) best = path;
  }
  // 向きをそろえる（西→東 or 南→北）。方面の名前（終点）は両端なので向きには影響しない
  const axis = Math.abs(best.at(-1)[1][1] - best[0][1][1]) >= Math.abs(best.at(-1)[1][0] - best[0][1][0]) ? 1 : 0;
  if (best[0][1][axis] > best.at(-1)[1][axis]) best.reverse();
  return best;
}

const out = [...lines.values()]
  .map((l) => ({
    c: l.company,
    l: l.line,
    k: Number(l.kind), // 1 新幹線 2 JR在来線 3 公営 4 民営 5 第三セクター
    r: [...new Set([...l.stations.values()].map(([lat, lon]) => regionOf(lat, lon)))],
    ...(() => {
      // s: 駅名（沿線順）、p: その駅の緯度・経度（小数 4 桁 ≒ 10m。位置情報から近くの駅を探すため）
      const o = ordered(l.stations);
      return { s: o.map(([name]) => name), p: o.map(([, [lat, lon]]) => [Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4]) };
    })(),
  }))
  .sort((a, b) => a.k - b.k || a.c.localeCompare(b.c, "ja") || a.l.localeCompare(b.l, "ja"));

writeFileSync(new URL("../www/lines.json", import.meta.url), JSON.stringify({ source: "国土数値情報（鉄道データ）N02-25（国土交通省）を加工して作成", lines: out }));
console.log(`${out.length} lines, ${out.reduce((n, l) => n + l.s.length, 0)} stations`);
