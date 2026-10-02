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

// 駅の並び: 路線の広がりが大きい方向（東西 or 南北）で並べる。直線的な路線ではほぼ沿線順になる
function ordered(stations) {
  const pts = [...stations];
  const span = (i) => Math.max(...pts.map((s) => s[1][i])) - Math.min(...pts.map((s) => s[1][i]));
  const axis = span(1) >= span(0) ? 1 : 0;
  return pts.sort((a, b) => a[1][axis] - b[1][axis]).map(([name]) => name);
}

const out = [...lines.values()]
  .map((l) => ({
    c: l.company,
    l: l.line,
    k: Number(l.kind), // 1 新幹線 2 JR在来線 3 公営 4 民営 5 第三セクター
    r: [...new Set([...l.stations.values()].map(([lat, lon]) => regionOf(lat, lon)))],
    s: ordered(l.stations),
  }))
  .sort((a, b) => a.k - b.k || a.c.localeCompare(b.c, "ja") || a.l.localeCompare(b.l, "ja"));

writeFileSync(new URL("../www/lines.json", import.meta.url), JSON.stringify({ source: "国土数値情報（鉄道データ）N02-25（国土交通省）を加工して作成", lines: out }));
console.log(`${out.length} lines, ${out.reduce((n, l) => n + l.s.length, 0)} stations`);
