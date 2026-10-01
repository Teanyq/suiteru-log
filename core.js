// 純粋関数のみ（DOM・localStorage に触らない）。node --test core.test.mjs で検証。
export const SLOT_MIN = 15;

// t はタイムゾーンなしのローカル時刻文字列 "YYYY-MM-DDTHH:MM:SS"
export const slotOf = (t) => {
  const d = new Date(t);
  return Math.floor((d.getHours() * 60 + d.getMinutes()) / SLOT_MIN);
};

export const slotLabel = (slot) => {
  const m = slot * SLOT_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// key "曜日-枠" -> { sum, n }
export function aggregate(logs, routeId) {
  const agg = new Map();
  for (const l of logs) {
    if (l.route !== routeId) continue;
    const key = `${new Date(l.t).getDay()}-${slotOf(l.t)}`;
    const e = agg.get(key) ?? { sum: 0, n: 0 };
    e.sum += l.level;
    e.n++;
    agg.set(key, e);
  }
  return agg;
}

const isWeekend = (dow) => dow === 0 || dow === 6;

// その曜日にデータが無ければ、同じ種別（平日/休日）の全曜日で代替する
export function recommend(logs, routeId, dow, limit = 3) {
  const agg = aggregate(logs, routeId);
  const pick = (match) => {
    const slots = new Map();
    for (const [key, { sum, n }] of agg) {
      const [d, slot] = key.split("-").map(Number);
      if (!match(d)) continue;
      const e = slots.get(slot) ?? { sum: 0, n: 0 };
      e.sum += sum;
      e.n += n;
      slots.set(slot, e);
    }
    const all = [...slots].map(([slot, { sum, n }]) => ({ slot, label: slotLabel(slot), avg: sum / n, n }));
    // いつもの枠 = いちばん多く記録した枠（同数なら早い方）
    const usual = all.reduce((u, s) => (!u || s.n > u.n || (s.n === u.n && s.slot < u.slot) ? s : u), null);
    const top = all.sort((a, b) => a.avg - b.avg || b.n - a.n || a.slot - b.slot).slice(0, limit);
    return { top, usual };
  };
  const exact = pick((d) => d === dow);
  if (exact.top.length) return { ...exact, fallback: false };
  return { ...pick((d) => isWeekend(d) === isWeekend(dow)), fallback: true };
}

const T_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

// 外部ファイル（バックアップ）を信用しない: 形の合わない行は捨て、路線が1つも無ければ拒否
export function parseBackup(text) {
  const raw = JSON.parse(text);
  const routes = (Array.isArray(raw?.routes) ? raw.routes : [])
    .filter((r) => typeof r?.id === "string" && typeof r?.name === "string" && r.name.trim())
    .map((r) => ({ id: r.id, name: r.name.trim().slice(0, 40) }));
  if (!routes.length) throw new Error("路線データがありません");
  const ids = new Set(routes.map((r) => r.id));
  const logs = (Array.isArray(raw.logs) ? raw.logs : [])
    .filter((l) => ids.has(l?.route) && T_RE.test(l?.t) && Number.isInteger(l?.level) && l.level >= 1 && l.level <= 5)
    .map(({ route, t, level }) => ({ route, t, level }));
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const memos = (Array.isArray(raw.memos) ? raw.memos : [])
    .map((m) => ({ route: m?.route, station: str(m?.station, 20), text: str(m?.text, 100) }))
    .filter((m) => ids.has(m.route) && m.station && m.text);
  return { routes, logs, memos, current: ids.has(raw.current) ? raw.current : routes[0].id };
}
