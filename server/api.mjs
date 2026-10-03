// 純粋なロジック（Worker から使い、node --test でテストする）。DB には触らない

export const HALF_LIFE_DAYS = 30;   // アプリの推定と同じ: 30 日で重み半分
export const WINDOW_DAYS = 120;     // これより古い報告は集計しない
export const RATE_LIMIT_MS = 5 * 60 * 1000; // 同じ端末・路線・方面・号車は 5 分に 1 回

const str = (v, max) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);

// 報告を検証して正規化。不正なら null（理由は返さない: いたずらに手がかりを与えない）
export function parseReport(body) {
  const device = str(body?.device, 64);
  const c = str(body?.line?.c, 40), l = str(body?.line?.l, 40);
  const dir = str(body?.dir, 40);
  const daytype = body?.daytype === "wd" || body?.daytype === "we" ? body.daytype : null;
  const slot = int(body?.slot, 0, 95), car = int(body?.car, 1, 20), level = int(body?.level, 1, 5);
  if (!device || !c || !l || !dir || !daytype || slot === null || !car || !level) return null;
  if (c.includes("|") || l.includes("|")) return null;
  return { device, line: `${c}|${l}`, dir, daytype, slot, car, level };
}

// 号車ごとの集計。同じ枠は重み 1、前後 1 枠は 0.5、さらに時間で半減
export function aggregate(rows, slot, now) {
  const cars = new Map();
  for (const r of rows) {
    const ds = Math.abs(r.slot - slot);
    if (ds > 1) continue;
    const ageDays = Math.max(0, (now - r.created_at) / 86400000);
    if (ageDays > WINDOW_DAYS) continue;
    const w = (ds === 0 ? 1 : 0.5) * 0.5 ** (ageDays / HALF_LIFE_DAYS);
    const e = cars.get(r.car) ?? { car: r.car, w: 0, sum: 0, n: 0 };
    e.w += w; e.sum += w * r.level; e.n++;
    cars.set(r.car, e);
  }
  return [...cars.values()].sort((a, b) => a.car - b.car)
    .map(({ car, w, sum, n }) => ({ car, w: Math.round(w * 1000) / 1000, mean: Math.round((sum / w) * 100) / 100, n }));
}
