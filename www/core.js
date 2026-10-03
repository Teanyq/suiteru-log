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
    .map(({ route, t, level, tags, car }) => {
      const ok = Array.isArray(tags) ? [...new Set(tags)].filter((x) => Object.hasOwn(TAGS, x)) : [];
      const log = ok.length ? { route, t, level, tags: ok } : { route, t, level };
      if (Number.isInteger(car) && car >= 1 && car <= 20) log.car = car; // v2: 号車つきの報告
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

// ホーム画面ショートカット等の ./?rec=N で開いた時の即記録。リンクは誰でも作れるので厳密に 1〜5 の整数 1 個だけ受け付ける
export function recParam(search) {
  const all = new URLSearchParams(search).getAll("rec");
  return all.length === 1 && /^[1-5]$/.test(all[0]) ? Number(all[0]) : null;
}

// アプリ版のリマインド（@capacitor/local-notifications 用）。平日の指定時刻に毎週くり返す。
// Capacitor の weekday は 1=日曜 … 7=土曜なので月〜金は 2〜6
export const REMINDER_IDS = [101, 102, 103, 104, 105];
export function reminderNotifications(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const [hour, minute] = [Number(m[1]), Number(m[2])];
  return REMINDER_IDS.map((id, i) => ({
    id,
    title: "今日の電車の混み具合は？",
    body: "すいてるログでワンタップ記録",
    schedule: { on: { weekday: i + 2, hour, minute }, allowWhileIdle: true },
    // 正確アラーム権限は使わない（Play の制限対象）。true のままだと設定画面へ飛ばされる
    isExactNotification: false,
  }));
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
export function carEstimates({ route, cars, dow, slot, now, logs, stairsCars = [], shared = [] }) {
  const mine = logs.filter((l) => l.route === route && !l.tags?.length);
  const weightOf = (l) => {
    const d = new Date(l.t);
    if (isWeekend(d.getDay()) !== isWeekend(dow)) return 0;
    const ds = Math.abs(slotOf(l.t) - slot);
    if (ds > 1) return 0;
    const ageDays = (now - d) / 86400000;
    return (ds === 0 ? 1 : 0.5) * 0.5 ** (Math.max(0, ageDays) / HALF_LIFE_DAYS);
  };
  // 号車なしの記録も含めた、その時間帯の自分の平均を事前推定の土台にする（なければ 3）
  let bw = 0, bs = 0;
  for (const l of mine) { const w = weightOf(l); bw += w; bs += w * l.level; }
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
  for (const l of logs) pts += 10 + (l.car ? 5 : 0);
  // 平日の連続記録 5 日ごとに +50（土日はまたいでも途切れない）
  const days = [...new Set(logs.map((l) => l.t.slice(0, 10)))]
    .filter((k) => !isWeekend(new Date(`${k}T12:00:00`).getDay())).sort();
  let run = 0, prev = null;
  for (const k of days) {
    const d = new Date(`${k}T12:00:00`);
    if (prev) {
      const gap = new Date(prev);
      do gap.setDate(gap.getDate() + 1); while (isWeekend(gap.getDay()));
      run = dayKey(gap) === k ? run + 1 : 1;
    } else run = 1;
    if (run % 5 === 0) pts += 50;
    prev = d;
  }
  return pts;
}

const TITLES = [[0, "見習い乗客"], [100, "通勤ルーキー"], [300, "号車ハンター"], [700, "ベテラン車掌"], [1500, "路線マイスター"], [3000, "伝説の運転士"]];
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
  return { device, line: route.line, dir, daytype: isWeekend(d.getDay()) ? "we" : "wd", slot: slotOf(log.t), car: log.car, level: log.level };
}
