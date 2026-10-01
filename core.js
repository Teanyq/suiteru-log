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

// 遅延・雨など平常でない記録につける印。集計（おすすめ・予想・ヒートマップ）からは外す
export const TAGS = { delay: "遅延", rain: "雨", period: "試験・休暇" };

// key "曜日-枠" -> { sum, n }（平常時の記録のみ）
export function aggregate(logs, routeId) {
  const agg = new Map();
  for (const l of logs) {
    if (l.route !== routeId || l.tags?.length) continue;
    const key = `${new Date(l.t).getDay()}-${slotOf(l.t)}`;
    const e = agg.get(key) ?? { sum: 0, n: 0 };
    e.sum += l.level;
    e.n++;
    agg.set(key, e);
  }
  return agg;
}

export const isWeekend = (dow) => dow === 0 || dow === 6;

// 比べるには最低 MIN_TOTAL 件・2 枠いる。その曜日で足りなければ同じ種別（平日/休日）の全曜日で代替する
export const MIN_TOTAL = 3;
const enough = (p) => p.total >= MIN_TOTAL && p.slots >= 2;

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
    const total = all.reduce((t, s) => t + s.n, 0);
    const top = all.sort((a, b) => a.avg - b.avg || b.n - a.n || a.slot - b.slot).slice(0, limit);
    return { top, usual, total, slots: all.length };
  };
  const exact = pick((d) => d === dow);
  if (enough(exact)) return { ...exact, fallback: false };
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
    .map(({ route, t, level, tags }) => {
      const ok = Array.isArray(tags) ? [...new Set(tags)].filter((x) => Object.hasOwn(TAGS, x)) : [];
      return ok.length ? { route, t, level, tags: ok } : { route, t, level };
    });
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const memos = (Array.isArray(raw.memos) ? raw.memos : [])
    .map((m) => ({ route: m?.route, station: str(m?.station, 20), text: str(m?.text, 100) }))
    .filter((m) => ids.has(m.route) && m.station && m.text);
  return { routes, logs, memos, current: ids.has(raw.current) ? raw.current : routes[0].id };
}

// 平日の指定時刻に通知するカレンダー予定（.ics）。PWA単体では定時通知できないので端末のカレンダーに任せる。
// DTSTART は TZ なし（端末のローカル時刻として扱われる）
export function reminderIcs(hhmm, now, url) {
  const [h, m] = hhmm.split(":").map(Number);
  const start = new Date(now);
  start.setHours(h, m, 0, 0);
  if (start <= now) start.setDate(start.getDate() + 1);
  const p = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//suiteru-log//JA",
    "BEGIN:VEVENT",
    `UID:suiteru-reminder-${ymd(start)}@suiteru`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${ymd(start)}T${p(h)}${p(m)}00`,
    "DURATION:PT5M",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    "SUMMARY:今日の電車の混み具合は？（すいてるログ）",
    `URL:${url}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:混み具合を記録", "TRIGGER:PT0M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// 平日の連続記録日数（全路線合算）。今日まだ未記録なら前の平日から数える。
// ponytail: 祝日は平日扱いなので途切れる。祝日データを持つなら isWeekend を差し替え
export function streak(logs, now) {
  const days = new Set(logs.map((l) => l.t.slice(0, 10)));
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  const todayDone = days.has(dayKey(d));
  if (!todayDone) d.setDate(d.getDate() - 1);
  let count = 0;
  for (;; d.setDate(d.getDate() - 1)) {
    if (isWeekend(d.getDay())) continue;
    if (!days.has(dayKey(d))) break;
    count++;
  }
  const last7 = [...Array(7)].map((_, i) => {
    const x = new Date(now);
    x.setHours(12, 0, 0, 0);
    x.setDate(x.getDate() - 6 + i);
    return { dow: x.getDay(), has: days.has(dayKey(x)), weekend: isWeekend(x.getDay()) };
  });
  return { days: count, todayDone, last7 };
}

// 指定曜日・枠の混雑予想。同じ曜日で need 件あればそれ、なければ平日/休日まとめ、それでも足りなければ残り件数
export function forecast(logs, routeId, dow, slot, need = 3) {
  const agg = aggregate(logs, routeId);
  let sum = 0, n = 0;
  for (const [key, e] of agg) {
    const [d, s] = key.split("-").map(Number);
    if (s === slot && isWeekend(d) === isWeekend(dow)) { sum += e.sum; n += e.n; }
  }
  const day = agg.get(`${dow}-${slot}`);
  if (day && day.n >= need) return { avg: day.sum / day.n, n: day.n, scope: "day" };
  if (n >= need) return { avg: sum / n, n, scope: "type" };
  return { avg: null, n, remaining: need - n };
}

// 今の時刻 ±windowMin に最も多く記録している路線（曜日は問わない）。近くに記録が無ければ null
// ponytail: 0時をまたぐ窓は見ない（終電帯の通勤が出てきたら分を mod 1440 で比較）
export function routeForTime(logs, now, windowMin = 60) {
  const mins = now.getHours() * 60 + now.getMinutes();
  const count = new Map();
  for (const l of logs) {
    const d = new Date(l.t);
    if (Math.abs(d.getHours() * 60 + d.getMinutes() - mins) <= windowMin) count.set(l.route, (count.get(l.route) ?? 0) + 1);
  }
  let best = null;
  for (const [route, n] of count) if (!best || n > count.get(best)) best = route;
  return best;
}

// <input type=time> の "HH:MM" を「直近の過去のその時刻」にする。0時過ぎに -15分 で 23:50 を選んだら前日扱い
export function resolveTime(hhmm, now) {
  const [h, m] = String(hhmm).split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d - now > 60000) d.setDate(d.getDate() - 1);
  return d;
}

// 季節・ダイヤ改正で古い記録はずれるので、判断に使うのは直近 days 日だけ（t は固定書式なので文字列比較でよい）
export function recent(logs, now, days = 90) {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  const cutoff = `${dayKey(d)}T00:00:00`;
  return logs.filter((l) => l.t >= cutoff);
}

// ブラウザのデータ消去に備え、記録がたまったのに 30 日以上書き出していなければ促す
export function needsBackup({ logs, lastExport }, now, minLogs = 20, days = 30) {
  if (logs.length < minLogs) return false;
  if (!lastExport) return true;
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return lastExport < dayKey(d);
}
