// 純粋なロジック（Worker から使い、node --test でテストする）。DB には触らない

export const HALF_LIFE_DAYS = 30;   // アプリの推定と同じ: 30 日で重み半分
export const WINDOW_DAYS = 120;     // これより古い報告は集計しない
export const HELPED_DAYS = 30;     // 「役に立った人数」は直近 30 日。閲覧の記録もこの日数で消す
export const RATE_LIMIT_MS = 5 * 60 * 1000; // 同じ端末・路線・方面・号車は 5 分に 1 回
export const MOODS = ["sleepy", "fight", "tired", "happy"]; // 号車の気分スタンプ（任意）
export const MOOD_MIN_PEOPLE = 3; // これ未満の号車はあだ名を出さない（少人数を特定させない）

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
  const mood = body.mood === undefined ? null : MOODS.includes(body.mood) ? body.mood : undefined;
  if (mood === undefined) return null;
  if (c.includes("|") || l.includes("|")) return null;
  return { device, line: `${c}|${l}`, dir, daytype, slot, car, level, mood };
}

// いたずら対策（docs/SPEC-v2.md）
export const DEVICE_CAP = 2;   // 1 台の端末が 1 号車に与えられる重みの上限（大量投稿で押し切れない）
export const DAILY_CAP = 30;   // 1 台の端末が 1 日に送れる報告の数

// ほかの 2 台以上の端末と大きく食い違い（中央値から 2 段階以上）、誰にも裏付けられていない（±1 以内の報告がない）報告は保留
function isHeld(r, group) {
  const others = group.filter((o) => o.device !== r.device);
  if (new Set(others.map((o) => o.device)).size < 2) return false;
  if (others.some((o) => Math.abs(o.level - r.level) <= 1)) return false;
  const lv = others.map((o) => o.level).sort((a, b) => a - b);
  const median = (lv[(lv.length - 1) >> 1] + lv[lv.length >> 1]) / 2;
  return Math.abs(r.level - median) >= 2;
}

// 号車ごとの集計。同じ枠は重み 1、前後 1 枠は 0.5、さらに時間で半減。保留の報告は除き、端末ごとの重みは DEVICE_CAP まで
export function aggregate(rows, slot, now) {
  const groups = new Map();
  for (const r of rows) {
    const ds = Math.abs(r.slot - slot);
    if (ds > 1) continue;
    const ageDays = Math.max(0, (now - r.created_at) / 86400000);
    if (ageDays > WINDOW_DAYS) continue;
    const g = groups.get(r.car) ?? [];
    g.push({ ...r, w: (ds === 0 ? 1 : 0.5) * 0.5 ** (ageDays / HALF_LIFE_DAYS) });
    groups.set(r.car, g);
  }
  const out = [];
  for (const [car, g] of groups) {
    const kept = g.filter((r) => !isHeld(r, g));
    const perDevice = new Map();
    for (const r of kept) perDevice.set(r.device, (perDevice.get(r.device) ?? 0) + r.w);
    let w = 0, sum = 0;
    for (const r of kept) {
      const rw = r.w * Math.min(1, DEVICE_CAP / perDevice.get(r.device));
      w += rw; sum += rw * r.level;
    }
    if (kept.length) out.push({ car, w: Math.round(w * 1000) / 1000, mean: Math.round((sum / w) * 100) / 100, n: kept.length });
  }
  return out.sort((a, b) => a.car - b.car);
}

// 日本時間の今日 0 時（Unix ms）。気分スタンプは当日限り
export const dayStartJst = (now) => Math.floor((now + 9 * 3600000) / 86400000) * 86400000 - 9 * 3600000;

// 号車ごとの気分: 端末ごとに最新の 1 票、MOOD_MIN_PEOPLE 人以上の号車だけ、いちばん多い気分を返す
export function moodsOf(rows) {
  const latest = new Map();
  for (const r of rows) {
    const k = `${r.car}|${r.device}`;
    if (!latest.has(k) || latest.get(k).created_at < r.created_at) latest.set(k, r);
  }
  const cars = new Map();
  for (const r of latest.values()) {
    const c = cars.get(r.car) ?? new Map();
    c.set(r.mood, (c.get(r.mood) ?? 0) + 1);
    cars.set(r.car, c);
  }
  return [...cars].map(([car, c]) => {
    const n = [...c.values()].reduce((a, b) => a + b, 0);
    const [mood] = [...c].sort((a, b) => b[1] - a[1] || MOODS.indexOf(a[0]) - MOODS.indexOf(b[0]))[0];
    return { car, mood, n };
  }).filter((m) => m.n >= MOOD_MIN_PEOPLE).sort((a, b) => a.car - b.car);
}

// 自動のニックネーム（入力なし）。端末 ID から決まり、ID そのものは出さない
const ADJ = ["まったり", "きびきび", "ねむねむ", "のんびり", "しゃきっと", "ぽかぽか", "すいすい", "わくわく", "こつこつ", "ほっこり", "てきぱき", "ふわふわ"];
const ANIMAL = ["パンダ", "ペンギン", "カワウソ", "タヌキ", "キツネ", "コアラ", "ハリネズミ", "アルパカ", "ラッコ", "シマエナガ", "カピバラ", "フクロウ"];
export function nickOf(device) {
  let h = 2166136261;
  for (const ch of device) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return ADJ[h % ADJ.length] + ANIMAL[Math.floor(h / ADJ.length) % ANIMAL.length];
}

// 路線ごとの報告数ランキング。rows は件数の多い順でなくてもよい。同数は同じ順位
export function rankingOf(rows, me) {
  const sorted = [...rows].sort((a, b) => b.n - a.n);
  const ranked = sorted.map((r) => ({ ...r, rank: sorted.findIndex((x) => x.n === r.n) + 1 }));
  const mine = ranked.find((r) => r.device === me);
  return {
    top: ranked.slice(0, 3).map(({ device, n, rank }) => ({ rank, n, name: nickOf(device) })),
    me: mine ? { rank: mine.rank, n: mine.n, name: nickOf(me), of: ranked.length } : null,
  };
}
