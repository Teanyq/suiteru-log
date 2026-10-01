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
    return [...slots]
      .map(([slot, { sum, n }]) => ({ slot, label: slotLabel(slot), avg: sum / n, n }))
      .sort((a, b) => a.avg - b.avg || b.n - a.n || a.slot - b.slot)
      .slice(0, limit);
  };
  const top = pick((d) => d === dow);
  if (top.length) return { top, fallback: false };
  return { top: pick((d) => isWeekend(d) === isWeekend(dow)), fallback: true };
}
