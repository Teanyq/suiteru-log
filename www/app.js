import { aggregate, recommend, slotLabel, parseBackup, reminderIcs, streak, forecast, routeForTime, resolveTime, slotOf, isWeekend, TAGS, recent, needsBackup, MIN_TOTAL, recParam, reminderNotifications, REMINDER_IDS, REGIONS, companiesIn, linesOf, directionsOf, companyLabel, MEMO_TAGS, memoLabel, lineLabel, carEstimates, pointsOf, titleOf, reportPayload, dirOf, cheerOf, guessHit, guessStats, MOODS, nicknameOf, monthRecap } from "./core.js";
import { createStore } from "./store.js";

const KEY = "suiteru.v1";
const LEVELS = [
  [1, "ガラガラ"], [2, "座れる"], [3, "立つけど余裕"], [4, "混んでる"], [5, "ぎゅうぎゅう"],
];
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const color = (avg) => `var(--l${Math.min(5, Math.max(1, Math.round(avg)))})`;
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

// アプリ版は OS に消されにくい Preferences に保存（store.js）。Web 版は localStorage
const isNativeApp = !!window.Capacitor?.isNativePlatform?.();
const store = createStore({
  key: KEY,
  prefs: isNativeApp ? window.Capacitor.Plugins.Preferences : null,
  local: (() => { try { return localStorage; } catch { return null; } })(),
});

async function load() {
  try {
    const d = JSON.parse(await store.load());
    if (d && Array.isArray(d.routes) && Array.isArray(d.logs)) return d;
  } catch {}
  return { routes: [{ id: "r1", name: "いつもの路線" }], logs: [], current: "r1" };
}
const data = await load();
data.memos ??= []; // 乗換メモ追加前のデータ
// 保存失敗はトーストだと直後の「記録しました」等で上書きされて見えないので、成功するまで上部に出し続ける
let saveFailed = false;
// 呼んだ時点の内容で書く（JSON 化は同期）。結果は非同期で上部の警告に反映
// ponytail: アプリ版の連続保存はネイティブ側の受付順に書かれる前提。順序が崩れる報告が出たら直列キューにする
function save() {
  store.save(JSON.stringify(data)).then((ok) => {
    saveFailed = !ok;
    renderBackup();
  });
}

const pad = (n) => String(n).padStart(2, "0");
const localIso = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

function setTime(shiftMin = 0) {
  const d = new Date(Date.now() + shiftMin * 60000);
  $("time").value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  renderForecast();
}

// おすすめ・予想・ヒートマップは直近90日の記録だけで判断する
const recentLogs = () => recent(data.logs, new Date());
const timeInput = () => resolveTime($("time").value, new Date());
const dayType = (dow) => (isWeekend(dow) ? "休日" : "平日");

function renderForecast() {
  const d = timeInput();
  const box = $("forecast");
  if (!d) return box.replaceChildren();
  const slot = slotOf(localIso(d));
  const dow = d.getDay();
  const f = forecast(recentLogs(), data.current, dow, slot);
  if (f.avg === null) {
    box.replaceChildren(`${slotLabel(slot)}台の予想: あと${f.remaining}回記録すると出ます`);
    return;
  }
  const scope = f.scope === "day" ? `${DOW[dow]}曜` : dayType(dow);
  box.replaceChildren(
    el("span", { className: "dot", style: `background:${color(f.avg)}` }),
    `${slotLabel(slot)}台の予想: `,
    el("strong", { textContent: `${LEVELS[Math.round(f.avg) - 1][1]}（${f.avg.toFixed(1)}）` }),
    el("span", { className: "fc-meta", textContent: ` ${scope}${f.n}回` }));
}

let toastTimer;
function toast(msg, undo) {
  const kids = [el("span", { textContent: msg })];
  if (undo) kids.push(el("button", { type: "button", textContent: "取り消す", onclick: () => { undo(); toast("取り消しました"); } }));
  $("toast").replaceChildren(...kids);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").replaceChildren(), undo ? 8000 : 4000);
}

function removeLog(log) {
  data.logs = data.logs.filter((l) => l !== log);
  save();
  render();
}

const fmt = (t) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function renderHistory() {
  const latest = data.logs.filter((l) => l.route === data.current)
    .sort((a, b) => b.t.localeCompare(a.t)).slice(0, 10);
  $("history-list").replaceChildren(...(latest.length ? latest.map((l) => el("li", {},
    el("span", { className: "dot", style: `background:var(--l${l.level})` }),
    `${fmt(l.t)}  ${LEVELS[l.level - 1][1]}${(l.tags ?? []).map((x) => `・${TAGS[x]}`).join("")}`,
    el("button", { type: "button", textContent: "削除", ariaLabel: `${fmt(l.t)}の記録を削除`, onclick: () => removeLog(l) })))
    : [el("li", { className: "empty", textContent: "まだ記録がありません" })]));
}

function renderRoutes() {
  const sel = $("route");
  sel.replaceChildren(...data.routes.map((r) => el("option", { value: r.id, textContent: r.name })));
  if (!data.routes.some((r) => r.id === data.current)) data.current = data.routes[0]?.id;
  sel.value = data.current;
  $("del-route").disabled = data.routes.length <= 1;
}

function renderRecommend() {
  const box = $("recommend");
  const today = new Date().getDay();
  const { top, fallback, usual, total, slots } = recommend(recentLogs(), data.current, today);
  const mine = (logs) => logs.filter((l) => l.route === data.current).length;
  const old = mine(data.logs) - mine(recentLogs());
  const oldLine = old ? [el("p", { className: "note", textContent: `90日より前の記録${old}件は、季節やダイヤ改正でずれるので使っていません。` })] : [];
  if (total < MIN_TOTAL || slots < 2) {
    const msg = total < MIN_TOTAL
      ? `あと${MIN_TOTAL - total}回記録すると、空いている時間帯をここに出します。`
      : "いつもと違う時間に乗った日も記録すると、どの時間が空いているか比べて出します。";
    box.replaceChildren(el("p", { className: "empty", textContent: msg }), ...oldLine);
    return;
  }
  const list = el("ol", { className: "rec" }, ...top.map((s) =>
    el("li", {},
      el("span", { className: "dot", style: `background:${color(s.avg)}` }),
      el("span", { className: "time", textContent: `${s.label}台` }),
      el("span", { className: "meta" },
        `平均 ${s.avg.toFixed(1)} ・ ${s.n}回`,
        ...(s.slot === usual.slot ? [el("br"), el("span", { className: "tag", textContent: "いつもの" })]
          : usual.avg - s.avg >= 0.5 ? [el("br"), el("span", { className: "better", textContent: `いつもより ${(usual.avg - s.avg).toFixed(1)} 空き` })]
          : [])))));
  const note = fallback
    ? `${DOW[today]}曜のデータがまだ無いので、${dayType(today)}全体から出しています。`
    : `${DOW[today]}曜の記録から、混雑が少ない順に表示しています。`;
  if (!$("remind-time").value) $("remind-time").value = usual.label;
  const usualLine = el("p", { className: "note", textContent: `いつもの時刻: ${usual.label}台（平均 ${usual.avg.toFixed(1)}・${usual.n}回）` });
  box.replaceChildren(list, usualLine, el("p", { className: "note", textContent: note }), ...oldLine);
}

function renderHeat() {
  const agg = aggregate(recentLogs(), data.current);
  const slots = [...new Set([...agg.keys()].map((k) => Number(k.split("-")[1])))].sort((a, b) => a - b);
  const table = $("heat");
  if (!slots.length) {
    table.replaceChildren(el("caption", { className: "empty", textContent: "1回記録すると、ここに曜日×時間の混み具合が出ます" }));
    return;
  }
  const head = el("tr", {}, el("th"), ...DOW_ORDER.map((d) => el("th", { scope: "col", textContent: DOW[d] })));
  const rows = slots.map((slot) => el("tr", {},
    el("th", { scope: "row", textContent: slotLabel(slot) }),
    ...DOW_ORDER.map((d) => {
      const e = agg.get(`${d}-${slot}`);
      if (!e) return el("td", { className: "none", textContent: "-" });
      const avg = e.sum / e.n;
      return el("td", { textContent: avg.toFixed(1), title: `${e.n}回`, style: `background:${color(avg)}` });
    })));
  table.replaceChildren(el("thead", {}, head), el("tbody", {}, ...rows));
}

function renderMemos() {
  const memos = data.memos.filter((m) => m.route === data.current);
  $("memo-list").replaceChildren(...(memos.length ? memos.map((m) => el("li", {},
    el("strong", { textContent: m.station }),
    el("span", { textContent: memoLabel(m) }),
    el("button", { type: "button", textContent: "削除", ariaLabel: `${m.station}のメモを削除`, onclick: () => {
      data.memos = data.memos.filter((x) => x !== m);
      save();
      renderMemos();
    } })))
    : [el("li", { className: "empty", textContent: "例: 渋谷 → 5号車3ドア・階段・乗換" })]));
}

function renderStreak() {
  const { days, todayDone, last7 } = streak(data.logs, new Date());
  const msg = days ? `平日連続 ${days}日${todayDone ? "" : "（今日はまだ）"}` : "今日の1回目を記録しよう";
  $("streak").replaceChildren(
    el("span", { className: "streak-n", textContent: msg }),
    el("span", { className: "streak-dots", role: "group", ariaLabel: "直近7日の記録" }, ...last7.map((d) => {
      // 記録の有無は色だけでは読み上げで伝わらないのでラベルで言う
      const label = `${DOW[d.dow]}曜 ${d.has ? "記録あり" : "記録なし"}`;
      return el("span", { className: `sd${d.has ? " on" : ""}${d.weekend ? " we" : ""}`, role: "img", ariaLabel: label, title: label, textContent: DOW[d.dow] });
    })));
}

const todayKey = () => localIso(new Date()).slice(0, 10);

function exportBackup() {
  data.lastExport = todayKey();
  save();
  download(JSON.stringify(data), "application/json", `suiteru-${data.lastExport.replaceAll("-", "")}.json`);
  render();
}

function renderBackup() {
  $("last-export").textContent = data.lastExport ? `最後の書き出し: ${data.lastExport}` : "まだ書き出していません。";
  const nudge = $("backup-nudge");
  nudge.role = saveFailed ? "alert" : null;
  if (saveFailed) {
    nudge.hidden = false;
    nudge.replaceChildren(el("span", { textContent: "保存できませんでした。この画面を閉じると直近の記録が消えます（プライベートモードや空き容量不足が原因のことがあります）。「書き出す」で控えを取れます。" }),
      el("button", { type: "button", textContent: "いま書き出す", onclick: exportBackup }));
    return;
  }
  nudge.hidden = !needsBackup(data, new Date());
  if (nudge.hidden) return;
  nudge.replaceChildren(
    el("span", { textContent: `記録が${data.logs.length}件たまりました。ブラウザのデータ削除や機種変更に備えて、書き出しておきましょう。` }),
    el("button", { type: "button", textContent: "いま書き出す", onclick: exportBackup }));
}

// renderRoutes が無効な data.current を直すので最初に呼ぶ（以降の表示はその路線で描く）
// ── v2: みんなと共有（docs/SPEC-v2.md 段階 B）──
const API = "https://suiteru-api.suiteru-server.workers.dev";
data.device ??= crypto.randomUUID(); // 匿名のランダム ID（個人とは結びつかない）
data.outbox ??= [];                   // 電波がない時に送れなかった報告

async function flushOutbox() {
  if (!data.share || !data.outbox.length || !navigator.onLine) return;
  const pending = data.outbox.splice(0);
  for (const p of pending) {
    try {
      const res = await fetch(`${API}/v1/reports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
      if (res.status >= 500) data.outbox.push(p); // サーバー側の一時的な不調は後で送り直す（400/429 は捨てる）
    } catch { data.outbox.push(p); }
  }
  data.outbox = data.outbox.slice(-50); // ためすぎない
  save();
}

// みんなの集計（60 秒キャッシュ）。取れなければ自分の記録と推定だけで表示する
const sharedCache = new Map();
async function loadShared(route, daytype, slot) {
  const dir = dirOf(route);
  if (!data.share || !route.line || !dir) return null;
  const key = new URLSearchParams({ c: route.line.c, l: route.line.l, dir, daytype, slot: String(slot) }).toString(), hit = sharedCache.get(key);
  // 自分の報告はサーバー側で除いてもらう（手元の記録として数えるので二重にしない）
  const q = `${key}&${new URLSearchParams({ device: data.device })}`;
  if (hit && Date.now() - hit.at < 60000) return hit;
  try {
    const res = await fetch(`${API}/v1/cars?${q}`);
    const body = res.ok ? await res.json() : {};
    const entry = { at: Date.now(), cars: body.cars ?? [], moods: body.moods ?? [] };
    sharedCache.set(key, entry);
    return entry;
  } catch { return null; }
}

// 今月のふりかえり。共有オンなら「あなたの報告が◯人の号車選びに使われた」も（サーバーに 1 日 1 回だけ聞く）
async function loadHelped() {
  if (!data.share || !navigator.onLine || data.helped?.day === todayKey()) return;
  try {
    const res = await fetch(`${API}/v1/me?${new URLSearchParams({ device: data.device })}`);
    if (!res.ok) return;
    data.helped = { day: todayKey(), n: (await res.json()).helped };
    save();
    renderRecap();
  } catch {}
}
function renderRecap() {
  const r = monthRecap(data.logs, new Date());
  $("recap-sec").hidden = !r.rides;
  if (!r.rides) return;
  $("h-recap").textContent = `${r.month}月のふりかえり`;
  const items = [
    `記録 ${r.rides} 回${r.empty ? `（空いてた ${r.empty} 回）` : ""}`,
    r.crowded ? `ぎゅうぎゅうに耐えた ${r.crowded} 回。おつかれさま` : "",
    r.guessN ? `号車予想 ${r.guessHit}/${r.guessN} 的中` : "",
    r.mood ? `いちばん多かった気分: ${MOODS[r.mood][0]}${MOODS[r.mood][1]}` : "",
    data.share && data.helped?.n ? `あなたの報告が、この30日で ${data.helped.n} 人の号車選びに使われました` : "",
  ].filter(Boolean);
  $("recap").replaceChildren(...items.map((t) => el("li", { textContent: t })));
  loadHelped();
}

function renderShare() {
  $("share").checked = !!data.share;
  $("device-id").textContent = data.device.slice(0, 8);
  $("share-ask").hidden = data.share !== undefined; // まだ聞いていない時だけ出す
}
function setShare(on) {
  data.share = on;
  save();
  sharedCache.clear();
  renderShare();
  renderCars();
  if (on) flushOutbox();
}
$("share-yes").addEventListener("click", () => { setShare(true); toast("共有をオンにしました。ありがとうございます"); });
$("share-no").addEventListener("click", () => { setShare(false); toast("共有はオフです（データ欄からいつでも変えられます）"); });
$("share").addEventListener("change", (e) => setShare(e.target.checked));

// ── v2: 空いてる号車 ──
const currentRoute = () => data.routes.find((r) => r.id === data.current);
// 乗換メモで階段・エスカレーターがある号車（どの駅かは問わず、その路線で混みやすい号車とみなす）
const stairsCarsOf = (routeId) => [...new Set(data.memos.filter((m) => m.route === routeId && m.car && m.tags?.some((t) => t === "stairs" || t === "escalator")).map((m) => m.car))];

function renderCars() {
  const route = currentRoute();
  if (!route) return;
  const cars = route.cars ?? 10;
  const d = timeInput() ?? new Date();
  const slot = slotOf(localIso(d)), daytype = isWeekend(d.getDay()) ? "we" : "wd";
  const hit = sharedCache.get(new URLSearchParams({ c: route.line?.c ?? "", l: route.line?.l ?? "", dir: dirOf(route) ?? "", daytype, slot: String(slot) }).toString());
  const shared = hit?.cars ?? [], moods = hit?.moods ?? [];
  if (data.share && route.line && !renderCars.loading) {
    renderCars.loading = true;
    loadShared(route, daytype, slot).then((r) => { renderCars.loading = false; if (r && r !== hit && (r.cars.length || r.moods.length)) renderCars(); });
  }
  const est = carEstimates({ route: route.id, cars, dow: d.getDay(), slot, now: new Date(), logs: recentLogs(), stairsCars: stairsCarsOf(route.id), shared });
  const min = Math.min(...est.map((c) => c.value));
  const bests = est.filter((c) => c.value - min < 0.05); // 同点（両端など）はまとめて出す
  const best = bests[0];
  const reports = est.reduce((n, c) => n + c.n, 0), sharedN = est.reduce((n, c) => n + c.shared, 0);
  const parts = [sharedN ? `みんなの報告 ${sharedN} 件` : "", reports ? `あなたの記録 ${reports} 件` : ""].filter(Boolean);
  const basis = parts.length
    ? `${slotLabel(slot)}台・${parts.join("と")}と一般的な傾向から推定`
    : "まだ号車つきの記録がないので、一般的な傾向（端の号車ほど空きやすい）から推定しています";
  $("car-reco").replaceChildren(
    el("p", { className: "reco-head" }, "おすすめは ", el("strong", { textContent: bests.map((c) => `${c.car}号車`).join("・") }), best.stars === 1 ? el("span", { className: "badge", textContent: "推定" }) : ""),
    el("div", { className: "train mini", role: "img", ariaLabel: est.map((c) => `${c.car}号車 ${LEVELS[Math.round(c.value) - 1][1]}`).join("、") },
      ...est.map((c) => el("div", { className: `car-cell${c.stars === 1 ? " guess" : ""}${bests.includes(c) ? " best" : ""}`, style: `background:${color(c.value)}` },
        el("b", { textContent: c.car }), el("small", { textContent: "★".repeat(c.stars) })))),
    el("p", { className: "note", textContent: basis }),
    moods.length ? el("p", { className: "nicknames", textContent: `今日の号車: ${moods.map((m) => `${m.car}号車＝${MOODS[m.mood][0]}${nicknameOf(m.mood)}（${m.n}人）`).join("、")}` }) : "",
  );
}

// 1タップ記録用: 乗っている号車（路線ごとに前回の号車を覚えておく）
function renderCarPick() {
  const route = currentRoute();
  if (!route) return;
  const cars = route.cars ?? 10;
  const pick = (n) => { route.lastCar = route.lastCar === n ? undefined : n; save(); renderCarPick(); };
  $("car-pick").replaceChildren(...Array.from({ length: cars }, (_, i) =>
    el("button", { type: "button", className: "chip", textContent: i + 1, ariaLabel: `${i + 1}号車`, ariaPressed: String(route.lastCar === i + 1), onclick: () => pick(i + 1) })));
}

function renderPoints() {
  const pts = pointsOf(data.logs);
  const { title, next, toNext } = titleOf(pts);
  const g = guessStats(data.logs);
  $("points").replaceChildren(el("strong", { textContent: title }), ` ${pts}pt`, next ? el("small", { textContent: `（${next}まであと${toNext}pt）` }) : "",
    g.n ? el("small", { textContent: ` 予想的中 ${g.hit}/${g.n}` }) : "");
}

const render = () => { renderRoutes(); renderShare(); renderPoints(); renderGuess(); renderRecap(); renderBackup(); renderStreak(); renderCars(); renderCarPick(); renderForecast(); renderRecommend(); renderHeat(); renderHistory(); renderMemos(); };

// 記録できたことを画面を見ずに分かるよう軽く振動。アプリ版は Haptics（iOS の WebView には vibrate が無い）、
// Web 版は navigator.vibrate（Android の Chrome のみ。iPhone の Safari では何もしない）
const haptics = isNativeApp ? window.Capacitor.Plugins.Haptics : null;
const buzz = () => (haptics ? haptics.impact({ style: "LIGHT" }).catch(() => {}) : navigator.vibrate?.(15));

function record(level, label) {
  const d = timeInput();
  if (!d) return toast("時刻を入れてください");
  const log = { route: data.current, t: localIso(d), level };
  const car = currentRoute()?.lastCar;
  if (car) log.car = car;
  const guess = currentGuess();
  if (guess) { log.guess = guess; delete data.guess; }
  const tags = [...activeTags, ...(data.periodMode ? ["period"] : [])];
  if (tags.length) log.tags = tags;
  if (activeMood) log.mood = activeMood;
  const before = pointsOf(data.logs);
  data.logs.push(log);
  const gained = pointsOf(data.logs) - before;
  const payload = data.share && reportPayload(data.device, currentRoute(), log);
  if (payload) { data.outbox.push(payload); flushOutbox(); }
  save();
  buzz();
  const note = log.tags ? `（${log.tags.map((x) => TAGS[x]).join("・")}：集計外）` : "";
  setTags([]); // 印は1回ごと
  setMood(null);
  render();
  const hit = guessHit(guess, level);
  const cheer = (hit === null ? "" : hit ? "予想的中！+5pt　" : "予想ハズレ…次こそ　") + cheerOf({ level, streakDays: streak(data.logs, Date.now()).days, dow: d.getDay(), n: data.logs.length });
  toast(`${$("time").value}${car ? ` ${car}号車` : ""} に「${label}」を記録 +${gained}pt${note}
${cheer}`, () => removeLog(log));
}

// 号車予想ゲーム: 予想は今日・この路線だけ有効。もう一度押すと取り消し
const currentGuess = () => (data.guess?.route === data.current && data.guess.day === todayKey() ? data.guess.v : undefined);
function renderGuess() {
  const g = currentGuess();
  for (const b of $("guess").querySelectorAll("button")) b.ariaPressed = String(b.dataset.v === g);
}
$("guess").append(...[["low", "空いてると思う"], ["high", "混んでると思う"]].map(([v, label]) => {
  const b = el("button", { type: "button", textContent: label, ariaPressed: "false" });
  b.dataset.v = v;
  b.onclick = () => {
    if (currentGuess() === v) delete data.guess;
    else data.guess = { route: data.current, day: todayKey(), v };
    save();
    renderGuess();
  };
  return b;
}));

// 気分スタンプ（任意・1回ごと）。共有オンなら報告に添えて、号車のあだ名に使う
let activeMood = null;
function setMood(m) {
  activeMood = m;
  for (const b of $("moods").querySelectorAll("button")) b.ariaPressed = String(b.dataset.mood === m);
}
$("moods").append(...Object.entries(MOODS).map(([key, [emoji, label]]) => {
  const b = el("button", { type: "button", textContent: `${emoji}${label}`, ariaPressed: "false" });
  b.dataset.mood = key;
  b.onclick = () => setMood(activeMood === key ? null : key);
  return b;
}), el("span", { className: "tags-hint", textContent: "← 気分も添える（任意）" }));

const activeTags = new Set();
function setTags(list) {
  activeTags.clear();
  list.forEach((x) => activeTags.add(x));
  for (const b of $("tags").querySelectorAll("button")) b.ariaPressed = String(activeTags.has(b.dataset.tag));
}
$("tags").append(...["delay", "rain"].map((key) => [key, TAGS[key]]).map(([key, label]) => {
  const b = el("button", { type: "button", textContent: label, ariaPressed: "false" });
  b.dataset.tag = key;
  b.onclick = () => setTags(activeTags.has(key) ? [...activeTags].filter((x) => x !== key) : [...activeTags, key]);
  return b;
}), el("span", { className: "tags-hint", textContent: "← いつもと違う日は印をつけて記録" }));

// 試験・休暇モードは遅延・雨と違い、オフにするまで続く
$("period").checked = !!data.periodMode;
$("period").addEventListener("change", (e) => {
  data.periodMode = e.target.checked;
  save();
  toast(data.periodMode ? "試験・休暇モード: この間の記録は集計に入れません" : "通常の記録に戻しました");
});

$("levels").append(...LEVELS.map(([n, label]) =>
  el("button", { type: "button", style: `background:var(--l${n})`, onclick: () => record(n, label) },
    el("span", { className: "n", textContent: n }), label)));

$("time").addEventListener("input", () => { renderForecast(); renderCars(); });
document.querySelectorAll("[data-shift]").forEach((b) =>
  b.addEventListener("click", () => setTime(Number(b.dataset.shift))));

$("route").addEventListener("change", (e) => { data.current = e.target.value; save(); render(); });
// 選択式の一覧シート（文字入力を減らす）。steps は [{ title, items: [{ label, sub?, onPick }] }] を積んでいく
let LINES = null;
const loadLines = async () => (LINES ??= (await (await fetch("lines.json")).json()).lines);
const pickerStack = [];
function showStep(step) {
  pickerStack.push(step);
  drawStep();
}
function drawStep() {
  const step = pickerStack.at(-1);
  $("picker-title").textContent = step.title;
  $("picker-back").hidden = pickerStack.length < 2;
  // items（ボタンの一覧）か content（電車の絵など自由な中身）のどちらか
  $("picker-list").replaceChildren(...(step.content ? [step.content()] : step.items.map((it) =>
    el("button", { type: "button", onclick: it.onPick }, el("span", { textContent: it.label }), ...(it.sub ? [el("small", { textContent: it.sub })] : [])))));
  $("picker-foot").replaceChildren(...(step.foot ? [step.foot] : []));
  $("picker-list").scrollTop = 0;
}
function closePicker() {
  pickerStack.length = 0;
  $("picker").close();
}
$("picker-back").addEventListener("click", () => { pickerStack.pop(); drawStep(); });
$("picker-close").addEventListener("click", closePicker);

// 路線を選ぶ: エリア → 会社 → 路線 → 方面。onDone(name, line) で追加 or 選び直し
async function pickRoute(title, onDone) {
  const manual = el("button", { type: "button", className: "link-btn", textContent: "一覧にない路線は名前を入力", onclick: () => {
    const name = prompt("路線名（例: 〇〇線 〇〇方面）")?.trim();
    if (name) { onDone(name.slice(0, 40), null); closePicker(); }
  } });
  pickerStack.length = 0;
  $("picker").showModal();
  let lines;
  try { lines = await loadLines(); } catch { return showStep({ title, items: [], foot: manual }); }
  showStep({ title, foot: manual, items: REGIONS.map((region) => ({ label: region, onPick: () =>
    showStep({ title: region, items: companiesIn(lines, region).map((company) => ({ label: companyLabel(company), onPick: () =>
      showStep({ title: companyLabel(company), items: linesOf(lines, region, company).map((line) => ({ label: lineLabel(line), sub: `${line.s.length}駅`, onPick: () =>
        showStep({ title: `${lineLabel(line)}（どちら方面？）`, items: directionsOf(line).map((name, i) => ({ label: name, onPick: () => {
          onDone(name, { c: line.c, l: line.l }, line.s.length < 2 ? null : i === 0 ? line.s.at(-1) : line.s[0]);
          closePicker();
        } })) }) })) }) })) }) })) });
}

// 乗換メモ: 駅 → 号車（電車の絵）→ ドア → 目的、をタップで選ぶ
async function pickMemo() {
  const route = data.routes.find((r) => r.id === data.current);
  const draft = { route: route.id };
  pickerStack.length = 0;
  $("picker").showModal();
  let lines = [];
  try { lines = await loadLines(); } catch {}
  const line = route.line && lines.find((l) => l.c === route.line.c && l.l === route.line.l);
  const typeStation = el("button", { type: "button", className: "link-btn", textContent: "一覧にない駅は名前を入力", onclick: () => {
    const s = prompt("駅名")?.trim();
    if (s) { draft.station = s.slice(0, 20); carStep(); }
  } });
  const stationItems = (names) => names.map((s) => ({ label: s, onPick: () => { draft.station = s; carStep(); } }));
  // 正式な路線区分の都合で目当ての駅がない時（例: 山手線の東京駅は正式には東海道線）は、同じ会社のほかの路線から選ぶ
  const otherLines = line && el("button", { type: "button", className: "link-btn", textContent: "この会社のほかの路線から選ぶ", onclick: () =>
    showStep({ title: companyLabel(line.c), items: lines.filter((l) => l.c === line.c && l !== line).map((l) => ({ label: lineLabel(l), sub: `${l.s.length}駅`, onPick: () =>
      showStep({ title: lineLabel(l), items: stationItems(l.s) }) })) }) });
  showStep({
    title: "どの駅のメモ？",
    items: line ? stationItems(line.s) : [],
    foot: el("div", { className: "foot-stack" }, ...(otherLines ? [otherLines] : [el("p", { className: "note", textContent: "路線を「変更」で一覧から選ぶと、駅をタップで選べます。" })]), typeStation),
  });

  function carStep() {
    route.cars ??= 10;
    const train = () => el("div", {},
      el("div", { className: "cars-row" },
        el("button", { type: "button", className: "chip", textContent: "−", ariaLabel: "両数を減らす", onclick: () => { route.cars = Math.max(1, route.cars - 1); save(); drawStep(); } }),
        el("span", { textContent: `${route.cars}両編成` }),
        el("button", { type: "button", className: "chip", textContent: "＋", ariaLabel: "両数を増やす", onclick: () => { route.cars = Math.min(20, route.cars + 1); save(); drawStep(); } })),
      el("div", { className: "train", role: "group", ariaLabel: "号車を選ぶ" }, ...Array.from({ length: route.cars }, (_, i) =>
        el("button", { type: "button", className: "car", ariaLabel: `${i + 1}号車`, onclick: () => { draft.car = i + 1; doorStep(); } },
          el("b", { textContent: i + 1 }), el("small", { textContent: "号車" })))),
      el("p", { className: "note", textContent: "号車の番号はホームの足元や車内の表示で確認できます。" }));
    showStep({ title: `${draft.station}：何号車？`, content: train,
      foot: el("button", { type: "button", className: "link-btn", textContent: "号車は決めない", onclick: () => { delete draft.car; tagStep(); } }) });
  }
  function doorStep() {
    showStep({ title: `${draft.car}号車：どのドア？`, items: [1, 2, 3, 4].map((d) => ({ label: `${d}ドア`, onPick: () => { draft.door = d; tagStep(); } })),
      foot: el("button", { type: "button", className: "link-btn", textContent: "ドアは決めない", onclick: () => { delete draft.door; tagStep(); } }) });
  }
  function tagStep() {
    const chosen = new Set();
    const saveBtn = el("button", { type: "button", className: "primary-btn", textContent: "保存", onclick: () => {
      if (chosen.size) draft.tags = [...chosen];
      if (!draft.car && !draft.tags) return toast("号車か目的を1つ選んでください");
      data.memos.push(draft);
      save();
      renderMemos();
      closePicker();
      toast(`${draft.station}：${memoLabel(draft)} を保存しました`);
    } });
    showStep({ title: "何がある？（いくつでも）", content: () => el("div", { className: "tag-grid" }, ...Object.entries(MEMO_TAGS).map(([key, label]) => {
      const b = el("button", { type: "button", className: "chip", textContent: label, ariaPressed: "false" });
      b.onclick = () => { chosen.has(key) ? chosen.delete(key) : chosen.add(key); b.ariaPressed = String(chosen.has(key)); };
      return b;
    })), foot: saveBtn });
  }
}
$("memo-add").addEventListener("click", pickMemo);

$("add-route").addEventListener("click", () => pickRoute("路線を追加", (name, line, dir) => {
  const id = `r${Date.now()}`;
  data.routes.push({ id, name, ...(line ? { line } : {}), ...(dir ? { dir } : {}) });
  data.current = id;
  save();
  render();
  toast(`「${name}」を追加しました`);
}));
// 選び直しても記録は残る（同じ路線 ID のまま名前と路線情報だけ変える）
$("rename-route").addEventListener("click", () => pickRoute("路線を選び直す", (name, line, dir) => {
  const r = data.routes.find((x) => x.id === data.current);
  r.name = name;
  if (dir) r.dir = dir; else delete r.dir;
  if (line) r.line = line; else delete r.line;
  save();
  render();
  toast(`「${name}」にしました（記録はそのまま）`);
}));
$("del-route").addEventListener("click", () => {
  const r = data.routes.find((x) => x.id === data.current);
  const n = data.logs.filter((l) => l.route === r.id).length;
  if (!confirm(`「${r.name}」と記録${n}件を削除しますか？`)) return;
  data.routes = data.routes.filter((x) => x.id !== r.id);
  data.logs = data.logs.filter((l) => l.route !== r.id);
  data.memos = data.memos.filter((m) => m.route !== r.id);
  save();
  render();
});



function download(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  el("a", { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("export").addEventListener("click", exportBackup);

// アプリ版は端末のローカル通知、Web 版は定時通知ができないので .ics をカレンダーに入れてもらう
const notif = isNativeApp ? window.Capacitor.Plugins.LocalNotifications : null;
const cancelReminder = () => notif.cancel({ notifications: REMINDER_IDS.map((id) => ({ id })) });
function renderReminder() {
  if (!notif) return;
  $("remind").textContent = "通知をセット";
  $("remind-note").textContent = data.reminder ? `平日 ${data.reminder} に通知します。` : "平日のこの時刻に「今日の混み具合は？」と通知します。";
  $("remind-off").hidden = !data.reminder;
  if (data.reminder) $("remind-time").value = data.reminder;
}
$("remind").addEventListener("click", async () => {
  const t = $("remind-time").value;
  if (!t) return toast("通知する時刻を入れてください");
  if (!notif) return download(reminderIcs(t, new Date(), location.href.split("#")[0]), "text/calendar", "suiteru-reminder.ics");
  try {
    if ((await notif.requestPermissions()).display !== "granted") return toast("通知が許可されていません。端末の設定アプリで「すいてるログ」の通知を許可してください");
    await cancelReminder();
    await notif.schedule({ notifications: reminderNotifications(t) });
  } catch {
    return toast("通知をセットできませんでした");
  }
  data.reminder = t;
  save();
  renderReminder();
  toast(`平日 ${t} に通知します`);
});
$("remind-off").addEventListener("click", async () => {
  try { await cancelReminder(); } catch {}
  delete data.reminder;
  save();
  renderReminder();
  toast("通知を止めました");
});
renderReminder();
$("import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let next;
  try { next = parseBackup(await file.text()); }
  catch { return toast("すいてるログのバックアップではないようです"); }
  if (!confirm(`路線${next.routes.length}件・記録${next.logs.length}件を読み込みます。今のデータは置き換わります。`)) return;
  Object.assign(data, next, { lastExport: todayKey() }); // 読み込んだファイル自体がバックアップ
  save();
  render();
  toast("読み込みました");
});

// 開いた時刻にいちばん使っている路線へ切り替える（朝は上り、夕方は下り、など）
function autoRoute() {
  const id = routeForTime(data.logs, new Date());
  const route = data.routes.find((r) => r.id === id);
  if (!route || id === data.current) return;
  data.current = id;
  save();
  toast(`時間帯に合わせて「${route.name}」にしました`);
}

// アプリに戻ってきた時に路線と時刻を今に合わせる（朝開いたまま夕方に記録、を防ぐ）
document.addEventListener("visibilitychange", () => { if (!document.hidden) { autoRoute(); setTime(); render(); flushOutbox(); } });
window.addEventListener("online", flushOutbox);

autoRoute();
setTime();
render();

// ./?rec=N（Android のアイコン長押しショートカット等）で開いたら即記録。
// 先に URL から外すので、再読み込みや「戻る」で二重に記録されない。取消はトーストから
const quick = recParam(location.search);
if (quick) {
  history.replaceState(null, "", location.pathname + location.hash);
  record(quick, LEVELS[quick - 1][1]);
}
// ストレージ逼迫時にブラウザが勝手に消さないよう依頼（許可されなくても動作は同じ）
navigator.storage?.persist?.().catch(() => {});
// アプリ版（Capacitor）はファイルが同梱済みなので Service Worker は不要（iOS の capacitor:// では登録もできない）
if (!isNativeApp && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
