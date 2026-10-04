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
// 祝日（内閣府「国民の祝日」CSV より。振替休日・国民の休日を含む）
// ponytail: 2027 年まで。内閣府は毎年 2 月ごろ翌年分を公開するので、そのたびに足す
const HOLIDAYS = new Set(["2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06",
  "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
  "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05",
  "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23"]);
export const HOLIDAYS_UNTIL = Math.max(...[...HOLIDAYS].map((k) => Number(k.slice(0, 4))));
// 休みの日（土日祝）。号車の予想・みんなの報告の平日/休日・連続記録はこれで分ける。
// 4 時より前は前日のダイヤ（金曜の終電は平日、日曜の終電は休日）として扱う
export function isOffDay(d) {
  const day = new Date(d);
  if (day.getHours() < 4) day.setDate(day.getDate() - 1);
  return isWeekend(day.getDay()) || HOLIDAYS.has(dayKey(day));
}

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
    .map((r) => {
      const route = { id: r.id, name: r.name.trim().slice(0, 40) };
      // 路線一覧から選んだ路線は会社名・路線名を持つ（乗換メモの駅選択に使う）
      if (typeof r.line?.c === "string" && typeof r.line?.l === "string") route.line = { c: r.line.c.slice(0, 40), l: r.line.l.slice(0, 40) };
      if (Number.isInteger(r.cars) && r.cars >= 1 && r.cars <= 20) route.cars = r.cars; // 乗換メモの編成両数
      if (Number.isInteger(r.lastCar) && r.lastCar >= 1 && r.lastCar <= 20) route.lastCar = r.lastCar; // v2: 前回乗った号車
      if (typeof r.dir === "string" && r.dir.trim()) route.dir = r.dir.trim().slice(0, 40); // v2: 方面（終点）
      return route;
    });
  if (!routes.length) throw new Error("路線データがありません");
  const ids = new Set(routes.map((r) => r.id));
  const logs = (Array.isArray(raw.logs) ? raw.logs : [])
    .filter((l) => ids.has(l?.route) && T_RE.test(l?.t) && Number.isInteger(l?.level) && l.level >= 1 && l.level <= 5)
    .map(({ route, t, level, tags, car, guess, pred, mood }) => {
      const ok = Array.isArray(tags) ? [...new Set(tags)].filter((x) => Object.hasOwn(TAGS, x)) : [];
      const log = ok.length ? { route, t, level, tags: ok } : { route, t, level };
      if (Number.isInteger(car) && car >= 1 && car <= 20) log.car = car; // v2: 号車つきの報告
      if (guess === "low" || guess === "high") log.guess = guess; // 以前の手動の号車予想
      if (Number.isInteger(pred) && pred >= 1 && pred <= 5) log.pred = pred; // アプリの予想（自動の答え合わせ）
      if (Object.hasOwn(MOODS, mood)) log.mood = mood; // 気分スタンプ
      return log;
    });
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const int = (v, max) => (Number.isInteger(v) && v >= 1 && v <= max ? v : undefined);
  const memos = (Array.isArray(raw.memos) ? raw.memos : [])
    .map((m) => {
      const memo = { route: m?.route, station: str(m?.station, 20) };
      const car = int(m?.car, 20), door = int(m?.door, 6), text = str(m?.text, 100);
      const tags = Array.isArray(m?.tags) ? [...new Set(m.tags)].filter((t) => Object.hasOwn(MEMO_TAGS, t)) : [];
      if (car) memo.car = car;
      if (car && door) memo.door = door;
      if (tags.length) memo.tags = tags;
      if (text) memo.text = text;
      return memo;
    })
    // 駅と、号車・目的・文字のどれか 1 つは必要（中身のないメモは捨てる）
    .filter((m) => ids.has(m.route) && m.station && (m.car || m.tags || m.text));
  const out = { routes, logs, memos, current: ids.has(raw.current) ? raw.current : routes[0].id };
  // 共有番号も引き継ぐ（機種変更してもランキング・「役に立った人数」・削除依頼の番号が続く）
  if (typeof raw.device === "string" && raw.device.length > 0 && raw.device.length <= 64) out.device = raw.device;
  return out;
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
export function streak(logs, now) {
  const days = new Set(logs.map((l) => l.t.slice(0, 10)));
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  const todayDone = days.has(dayKey(d));
  if (!todayDone) d.setDate(d.getDate() - 1);
  let count = 0;
  for (;; d.setDate(d.getDate() - 1)) {
    if (isOffDay(d)) continue;
    if (!days.has(dayKey(d))) break;
    count++;
  }
  const last7 = [...Array(7)].map((_, i) => {
    const x = new Date(now);
    x.setHours(12, 0, 0, 0);
    x.setDate(x.getDate() - 6 + i);
    return { dow: x.getDay(), has: days.has(dayKey(x)), weekend: isOffDay(x) };
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

// ホーム画面ショートカット等の ./?rec=N で開いた時の即記録。リンクは誰でも作れるので厳密に 1〜5 の整数 1 個だけ受け付ける
export function recParam(search) {
  const all = new URLSearchParams(search).getAll("rec");
  return all.length === 1 && /^[1-5]$/.test(all[0]) ? Number(all[0]) : null;
}

// アプリ版のリマインド（@capacitor/local-notifications 用）。平日の指定時刻に毎週くり返す。
// Capacitor の weekday は 1=日曜 … 7=土曜なので月〜金は 2〜6
// 101〜130。日付ごとに入れるので最大 4 週間分の平日（＋以前の毎週くり返しの 101〜105 も同じ範囲で消せる）
export const REMINDER_IDS = Array.from({ length: 30 }, (_, i) => 101 + i);
// 通知のボタンから直接記録する（Android は最大 3 つ）。id の数字が混雑度
export const REPORT_ACTIONS = { id: "REPORT", actions: [{ id: "l2", title: "座れる" }, { id: "l3", title: "立つけど余裕" }, { id: "l4", title: "混んでる" }] };

// 平日の朝の通知。毎週くり返しだと祝日にも鳴るので、次の 4 週間の「休みでない日」を日付で入れる
// （起動のたび・記録のたびに入れ直すので、使っていれば途切れない）。
// textFor(日時) で { title, body }（例: 見出しに今日のおすすめ号車）。null ならいつもの文面
export function reminderNotifications(hhmm, now, textFor = () => null) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const out = [];
  for (let i = 0; i <= 28 && out.length < REMINDER_IDS.length; i++) {
    const at = new Date(now);
    at.setDate(at.getDate() + i);
    at.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (at <= now || at - now > 28 * 86400000 || isOffDay(at)) continue;
    const text = textFor(at);
    out.push({
      id: REMINDER_IDS[out.length],
      title: text?.title ?? "今日の電車の混み具合は？",
      body: text?.body ?? "すいてるログでワンタップ記録",
      schedule: { at, allowWhileIdle: true },
      // 正確アラーム権限は使わない（Play の制限対象）。true のままだと設定画面へ飛ばされる
      isExactNotification: false,
      actionTypeId: REPORT_ACTIONS.id,
    });
  }
  return out;
}

// 路線選択（www/lines.json）。エリア → 会社 → 路線 → 方面 とタップで絞り込む
export const REGIONS = ["北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州・沖縄"];

// その地域を走る会社。JR・公営など区分の小さい順（新幹線/JR → 公営 → 民営 → 第三セクター）に、同区分は路線数の多い順
export function companiesIn(lines, region) {
  const by = new Map();
  for (const l of lines) {
    if (!l.r.includes(region)) continue;
    const e = by.get(l.c) ?? { k: l.k, n: 0 };
    e.k = Math.min(e.k, l.k);
    e.n++;
    by.set(l.c, e);
  }
  return [...by].sort((a, b) => a[1].k - b[1].k || b[1].n - a[1].n || a[0].localeCompare(b[0], "ja")).map(([c]) => c);
}

export const linesOf = (lines, region, company) => lines.filter((l) => l.c === company && l.r.includes(region));

// 両端の駅で方面を作る（上り/下りより分かりやすい）
export const directionsOf = (line) => {
  const name = lineLabel(line);
  return line.s.length < 2 ? [name] : [`${name} ${line.s.at(-1)}方面`, `${name} ${line.s[0]}方面`];
};

// 地下鉄などの正式名「11号線半蔵門線」「1号線(御堂筋線)」→ ふだんの名前。名前のない「N号線」はそのまま
const LINE_LABELS = { "横浜市|1号線": "ブルーライン（1号線）", "横浜市|3号線": "ブルーライン（3号線）", "横浜市|4号線": "グリーンライン" };
export function lineLabel({ c, l }) {
  return LINE_LABELS[`${c}|${l}`] ?? l.replace(/^\d+号線\(?(.+?)\)?$/, "$1");
}

// 正式名称 → ふだん呼ぶ名前（表示だけ。保存する路線情報は正式名称のまま）
const COMPANY_LABELS = {
  北海道旅客鉄道: "JR北海道", 東日本旅客鉄道: "JR東日本", 東海旅客鉄道: "JR東海",
  西日本旅客鉄道: "JR西日本", 四国旅客鉄道: "JR四国", 九州旅客鉄道: "JR九州",
  東京地下鉄: "東京メトロ", 東京都: "都営（東京都交通局）", 大阪市高速電気軌道: "Osaka Metro",
  横浜市: "横浜市営地下鉄・バス", 名古屋市: "名古屋市営地下鉄", 京都市: "京都市営地下鉄",
  神戸市: "神戸市営地下鉄", 札幌市: "札幌市営地下鉄・市電", 仙台市: "仙台市地下鉄", 福岡市: "福岡市地下鉄",
};
export const companyLabel = (c) => COMPANY_LABELS[c] ?? c;

// 乗換メモの目的（タップで選ぶ）
export const MEMO_TAGS = { stairs: "階段", escalator: "エスカレーター", elevator: "エレベーター", transfer: "乗換", gate: "改札", exit: "出口", toilet: "トイレ" };

// 「5号車3ドア・階段・乗換」。文字だけの旧メモはそのまま出す
export function memoLabel(m) {
  const pos = m.car ? `${m.car}号車${m.door ? `${m.door}ドア` : ""}` : "";
  return [pos, ...(m.tags ?? []).map((t) => MEMO_TAGS[t]), m.text].filter(Boolean).join("・");
}

// ── v2: 号車ごとの混雑推定（docs/SPEC-v2.md）────────────────────────────
// 事前推定: 端ほど空いている U 字型。中央 +0.4、端 -0.8（両数で補間）を base に足す
export function carPrior(cars, base = 3) {
  return Array.from({ length: cars }, (_, i) => {
    const x = cars === 1 ? 0 : (i + 0.5) / cars - 0.5; // -0.5（先頭）〜 +0.5（最後尾）
    const offset = cars === 1 ? 0.4 : 0.4 - 1.2 * ((x / (0.5 - 0.5 / cars)) ** 2);
    return Math.min(5, Math.max(1, base + offset));
  });
}

const PRIOR_WEIGHT = 3; // 事前推定を「報告 3 件分」とみなす
const HALF_LIFE_DAYS = 30; // 報告の重みが半分になる日数

// その路線・曜日の種類・15分枠（前後 1 枠は半分の重み）の、号車つき報告から号車ごとの混雑を推定する
export function carEstimates({ route, cars, dow, slot, now, logs, stairsCars = [], shared = [], off = isWeekend(dow) }) {
  const mine = logs.filter((l) => l.route === route && !l.tags?.length);
  const weightOf = (l) => {
    const d = new Date(l.t);
    if (isOffDay(d) !== off) return 0; // 休みの日（土日祝）と平日は分けて数える
    const ds = Math.abs(slotOf(l.t) - slot);
    if (ds > 1) return 0;
    const ageDays = (now - d) / 86400000;
    return (ds === 0 ? 1 : 0.5) * 0.5 ** (Math.max(0, ageDays) / HALF_LIFE_DAYS);
  };
  // その時間帯の混み具合（自分の記録＝号車なしも含む＋みんなの報告）を事前推定の土台にする（なければ 3）。
  // みんなの報告も入れるので、報告のない号車も「深夜は空いている」などに一緒に寄る
  let bw = 0, bs = 0;
  for (const l of mine) { const w = weightOf(l); bw += w; bs += w * l.level; }
  for (const sh of shared) { bw += sh.w; bs += sh.w * sh.mean; }
  // 記録が少ないうちは土台を真ん中（3）に寄せる（1 件の極端な記録で全体が端に張りついて同点だらけにならないように）
  const prior = carPrior(cars, (PRIOR_WEIGHT * 3 + bs) / (PRIOR_WEIGHT + bw)).map((p, i) => Math.min(5, p + (stairsCars.includes(i + 1) ? 0.5 : 0)));
  return prior.map((p, i) => {
    let w = 0, s = 0, n = 0;
    for (const l of mine) {
      if (l.car !== i + 1) continue;
      const lw = weightOf(l);
      if (lw > 0) { w += lw; s += lw * l.level; n++; }
    }
    // みんなの報告（サーバーの集計: 重み w と平均 mean）も同じ重みの観測として足す
    const sh = shared.find((x) => x.car === i + 1);
    if (sh) { w += sh.w; s += sh.w * sh.mean; }
    return { car: i + 1, value: (PRIOR_WEIGHT * p + s) / (PRIOR_WEIGHT + w), prior: p, n, shared: sh?.n ?? 0, stars: w < 0.5 ? 1 : w < 3 ? 2 : 3 };
  });
}

// ── v2: ポイントと称号（記録から毎回計算し直す。取り消せばポイントも戻る）──
export function pointsOf(logs) {
  let pts = 0;
  // 号車つき +5、ぎゅうぎゅう側（4〜5）は「戦士ボーナス」+10（つらい日ほど報われる）
  for (const l of logs) pts += 10 + (l.car ? 5 : 0) + (l.level >= 4 ? 10 : 0) + (predHit(l) ? 5 : 0);
  // 平日の連続記録 5 日ごとに +50（土日はまたいでも途切れない）
  const days = [...new Set(logs.map((l) => l.t.slice(0, 10)))]
    .filter((k) => !isOffDay(new Date(`${k}T12:00:00`))).sort();
  let run = 0, prev = null;
  for (const k of days) {
    const d = new Date(`${k}T12:00:00`);
    if (prev) {
      const gap = new Date(prev);
      do gap.setDate(gap.getDate() + 1); while (isOffDay(gap));
      run = dayKey(gap) === k ? run + 1 : 1;
    } else run = 1;
    if (run % 5 === 0) pts += 50;
    prev = d;
  }
  return pts;
}

const TITLES = [[0, "見習い乗客"], [100, "通勤ルーキー"], [300, "号車ハンター"], [700, "ベテラン車掌"], [1500, "路線マイスター"], [3000, "伝説の運転士"]];
// 気分スタンプ（任意 1 タップ）。報告に添え、当日 3 人以上そろった号車にあだ名をつける（集計は server/api.mjs）
export const MOODS = { sleepy: ["😪", "眠い", "おねむ号"], fight: ["💪", "がんばる", "がんばり号"], tired: ["🫠", "だるい", "ぐったり号"], happy: ["😊", "ごきげん", "ごきげん号"] };
export const nicknameOf = (mood) => MOODS[mood]?.[2];

// 予想の答え合わせ。いまはアプリの予想（pred: 記録した号車の推定混雑度）と自動で比べる。
// 以前の手動予想（guess: 空いてる 1〜2／混んでる 4〜5）も数える。予想なしは null
export const guessHit = (guess, level) => (guess === "low" ? level <= 2 : guess === "high" ? level >= 4 : null);
export const predHit = (l) => (l.guess ? guessHit(l.guess, l.level) : l.pred ? l.pred === l.level : null);
export function guessStats(logs) {
  const g = logs.filter((l) => predHit(l) !== null);
  return { n: g.length, hit: g.filter(predHit).length };
}

// 今月の目標（毎月リセット）＝ その月の平日（土日祝を除く）の数。片道だけ記録する人も毎日続ければ届き、往復なら余裕。
// 達成した月はその季節のバッジ。称号のように打ち止めにならない
export function monthGoal(ym) {
  const [y, m] = ym.split("-").map(Number);
  let n = 0;
  for (const d = new Date(y, m - 1, 1, 12); d.getMonth() === m - 1; d.setDate(d.getDate() + 1)) if (!isOffDay(d)) n++;
  return n;
}
const SEASON = ["🎍", "⛄", "🌸", "🌷", "🎏", "☔", "🎐", "🌻", "🎑", "🍁", "🍂", "🎄"];
export function badgesOf(logs) {
  const count = {};
  for (const l of logs) { const ym = l.t.slice(0, 7); count[ym] = (count[ym] ?? 0) + 1; }
  return Object.keys(count).filter((ym) => count[ym] >= monthGoal(ym)).sort().map((ym) => ({ ym, emoji: SEASON[Number(ym.slice(5)) - 1] }));
}

// 今月のふりかえり（端末内の記録だけで出す）
export function monthRecap(logs, now) {
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const m = logs.filter((l) => l.t.startsWith(ym));
  const g = guessStats(m);
  const moods = {};
  for (const l of m) if (l.mood) moods[l.mood] = (moods[l.mood] ?? 0) + 1;
  const mood = Object.entries(moods).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { month: now.getMonth() + 1, rides: m.length, empty: m.filter((l) => l.level <= 2).length, crowded: m.filter((l) => l.level >= 4).length, guessN: g.n, guessHit: g.hit, mood };
}

// 記録したときの労いの一言。混雑 > 連続記録の節目 > 曜日 > 空いていた > 早朝・夜 > 季節（3 回に 1 回）> ふつう、の順で 1 つ。
// 同じ言葉が続かないよう、記録回数 n で順に回す（ふつうの日は 1 日 2 回でも 2 週間ほど重ならない）
const WARRIOR = ["ぎゅうぎゅうの中おつかれさま。戦士ボーナス +10pt", "よく耐えた！戦士ボーナス +10pt", "満員電車をのりきった戦士に +10pt", "今日いちばんの戦い、おつかれさま。戦士ボーナス +10pt"];
const MONDAY = ["月曜の朝をのりきった。今週もえらい", "月曜おつかれさま。ここを越えれば楽になる", "月曜から記録してえらい"];
const FRIDAY = ["金曜！あと少しで週末", "金曜の朝。今週もよくがんばった", "金曜です。週末まであとひと息"];
const EMPTY = ["空いててラッキー。いい一日になりそう", "空いてる電車はそれだけで得した気分", "空いててよかった。ゆっくりしてね", "いい号車を選んだね。空いてて何より"];
const EARLY = ["早起きおつかれさま。えらすぎる", "早い時間からおつかれさま", "朝早くの記録ありがとう。空いてる時間を見つけた？"];
const NIGHT = ["遅くまでおつかれさま。気をつけて帰ってね", "今日も一日おつかれさま", "夜の電車、ゆっくり帰ろう"];
const SEASON_CHEERS = {
  1: ["新しい年も、空いてる号車で", "寒い朝おつかれさま。あたたかくしてね"], 2: ["寒さに負けずえらい", "もうすぐ春。あと少し"],
  3: ["春の気配。年度末おつかれさま", "花粉の季節、おつかれさま"], 4: ["新生活の電車、慣れてきた？", "春の電車は混みがち。記録ありがとう"],
  5: ["連休明けもえらい", "風が気持ちいい季節"], 6: ["梅雨の電車はむしむし。おつかれさま", "雨の日も記録ありがとう"],
  7: ["暑い中おつかれさま。水分とってね", "夏の電車、冷房に感謝"], 8: ["猛暑の中えらい", "夏休みで少し空いてるかも"],
  9: ["暑さもあと少し", "秋の始まり、おつかれさま"], 10: ["過ごしやすい季節。いい一日を", "秋の朝、おつかれさま"],
  11: ["朝晩冷えてきたね。あたたかくして", "もうすぐ年末。おつかれさま"], 12: ["年末の電車おつかれさま", "今年もあと少し。よくがんばった"],
};
const CHEERS = ["今日もえらい", "乗れただけで100点", "おつかれさま、いってらっしゃい", "記録ありがとう。誰かの号車選びに役立ちます", "深呼吸ひとつ、いい一日を",
  "今日の一歩、えらい", "ちゃんと乗れた。それで十分", "電車の中くらい、ぼーっとしよう", "あなたの1タップが予想を育てます", "肩の力をぬいていこう",
  "通勤おつかれさま。いい日になりますように", "今日も記録してえらい", "好きな音楽でも聴いていこう", "あと少しで着くよ", "毎日のことだから、ゆるくいこう",
  "記録がまたひとつ増えた", "その号車、だんだん分かってきたね", "今日も無事に乗れたね", "小さな記録の積み重ね、えらい", "窓の外、ちょっと見てみて",
  "乗ってるだけでえらい", "今日のあなたに +1 えらい", "いってらっしゃい、気をつけて", "電車の時間は自分の時間", "ゆっくり行っても大丈夫"];
// ↑ 25 個（3 の倍数にしない）。季節の言葉が 3 回に 1 回入るので、3 の倍数だと出ない言葉ができる
export function cheerOf({ level, streakDays, dow, n, hour = 12, month = 0 }) {
  const pick = (list) => list[n % list.length];
  if (level >= 4) return pick(WARRIOR);
  if (streakDays > 0 && streakDays % 5 === 0) return `平日${streakDays}日連続！続けてるのがすごい`;
  if (dow === 1) return pick(MONDAY);
  if (dow === 5) return pick(FRIDAY);
  if (level <= 2) return pick(EMPTY);
  if (hour < 7) return pick(EARLY);
  if (hour >= 20) return pick(NIGHT);
  if (SEASON_CHEERS[month] && n % 3 === 0) return SEASON_CHEERS[month][Math.floor(n / 3) % SEASON_CHEERS[month].length];
  return pick(CHEERS);
}

export function titleOf(points) {
  const i = TITLES.findLastIndex(([min]) => points >= min);
  const next = TITLES[i + 1];
  return { title: TITLES[i][1], next: next ? next[1] : null, toNext: next ? next[0] - points : 0 };
}

// 路線の方面（終点の駅名）。一覧から選んだ路線は dir を持つ。古い路線は名前の「〜方面」から読む
export const dirOf = (route) => route.dir ?? route.name.match(/ (.+)方面$/)?.[1] ?? null;

// サーバーに送る匿名の報告。一覧から選んだ路線・方面・号車がそろい、遅延などの印がない記録だけ
export function reportPayload(device, route, log) {
  const dir = dirOf(route);
  if (!route.line || !dir || !log.car || log.tags?.length) return null;
  const d = new Date(log.t);
  return { device, line: route.line, dir, daytype: isOffDay(d) ? "we" : "wd", slot: slotOf(log.t), car: log.car, level: log.level, ...(log.mood ? { mood: log.mood } : {}) };
}
