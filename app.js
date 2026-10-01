import { aggregate, recommend, slotLabel, parseBackup, reminderIcs, streak, forecast, routeForTime, resolveTime, slotOf, isWeekend, TAGS, recent, needsBackup } from "./core.js";

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

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.routes) && Array.isArray(d.logs)) return d;
  } catch {}
  return { routes: [{ id: "r1", name: "いつもの路線" }], logs: [], current: "r1" };
}
const data = load();
data.memos ??= []; // 乗換メモ追加前のデータ
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch { toast("保存できませんでした（プライベートモード？）"); }
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
  const kids = [msg];
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
  const recent = data.logs.filter((l) => l.route === data.current)
    .sort((a, b) => b.t.localeCompare(a.t)).slice(0, 10);
  $("history-list").replaceChildren(...(recent.length ? recent.map((l) => el("li", {},
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
  const { top, fallback, usual } = recommend(recentLogs(), data.current, today);
  const mine = (logs) => logs.filter((l) => l.route === data.current).length;
  const old = mine(data.logs) - mine(recentLogs());
  const oldLine = old ? [el("p", { className: "note", textContent: `90日より前の記録${old}件は、季節やダイヤ改正でずれるので使っていません。` })] : [];
  if (!top.length) {
    box.replaceChildren(el("p", { className: "empty", textContent: "記録がたまると、空いている時間帯をここに出します。まずは今日の電車を記録してみてください。" }), ...oldLine);
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
    table.replaceChildren(el("caption", { className: "empty", textContent: "まだ記録がありません" }));
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
    el("span", { textContent: m.text }),
    el("button", { type: "button", textContent: "削除", ariaLabel: `${m.station}のメモを削除`, onclick: () => {
      data.memos = data.memos.filter((x) => x !== m);
      save();
      renderMemos();
    } })))
    : [el("li", { className: "empty", textContent: "例: 渋谷 → 5号車3ドア（半蔵門線の階段が目の前）" })]));
}

function renderStreak() {
  const { days, todayDone, last7 } = streak(data.logs, new Date());
  const msg = days ? `平日連続 ${days}日${todayDone ? "" : "（今日はまだ）"}` : "今日の1回目を記録しよう";
  $("streak").replaceChildren(
    el("span", { className: "streak-n", textContent: msg }),
    el("span", { className: "streak-dots", ariaLabel: "直近7日の記録" }, ...last7.map((d) =>
      el("span", { className: `sd${d.has ? " on" : ""}${d.weekend ? " we" : ""}`, title: DOW[d.dow], textContent: DOW[d.dow] }))));
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
  nudge.hidden = !needsBackup(data, new Date());
  if (nudge.hidden) return;
  nudge.replaceChildren(
    el("span", { textContent: `記録が${data.logs.length}件たまりました。ブラウザのデータ削除や機種変更に備えて、書き出しておきましょう。` }),
    el("button", { type: "button", textContent: "いま書き出す", onclick: exportBackup }));
}

const render = () => { renderBackup(); renderStreak(); renderForecast(); renderRoutes(); renderRecommend(); renderHeat(); renderHistory(); renderMemos(); };

function record(level, label) {
  const d = timeInput();
  if (!d) return toast("時刻を入れてください");
  const log = { route: data.current, t: localIso(d), level };
  if (activeTags.size) log.tags = [...activeTags];
  data.logs.push(log);
  save();
  const note = log.tags ? `（${log.tags.map((x) => TAGS[x]).join("・")}：集計外）` : "";
  setTags([]); // 印は1回ごと
  render();
  toast(`${$("time").value} に「${label}」を記録${note}`, () => removeLog(log));
}

const activeTags = new Set();
function setTags(list) {
  activeTags.clear();
  list.forEach((x) => activeTags.add(x));
  for (const b of $("tags").querySelectorAll("button")) b.ariaPressed = String(activeTags.has(b.dataset.tag));
}
$("tags").append(...Object.entries(TAGS).map(([key, label]) => {
  const b = el("button", { type: "button", textContent: label, ariaPressed: "false" });
  b.dataset.tag = key;
  b.onclick = () => setTags(activeTags.has(key) ? [...activeTags].filter((x) => x !== key) : [...activeTags, key]);
  return b;
}), el("span", { className: "tags-hint", textContent: "← いつもと違う日は印をつけて記録" }));

$("levels").append(...LEVELS.map(([n, label]) =>
  el("button", { type: "button", style: `background:var(--l${n})`, onclick: () => record(n, label) },
    el("span", { className: "n", textContent: n }), label)));

$("time").addEventListener("input", renderForecast);
document.querySelectorAll("[data-shift]").forEach((b) =>
  b.addEventListener("click", () => setTime(Number(b.dataset.shift))));

$("route").addEventListener("change", (e) => { data.current = e.target.value; save(); render(); });
$("add-route").addEventListener("click", () => {
  const name = prompt("路線名（例: 田園都市線 上り）")?.trim();
  if (!name) return;
  const id = `r${Date.now()}`;
  data.routes.push({ id, name: name.slice(0, 40) });
  data.current = id;
  save();
  render();
});
$("rename-route").addEventListener("click", () => {
  const r = data.routes.find((x) => x.id === data.current);
  const name = prompt("路線名（例: 田園都市線 上り）", r.name)?.trim();
  if (!name || name === r.name) return;
  r.name = name.slice(0, 40);
  save();
  render();
});
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

$("memo-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const station = $("memo-station").value.trim().slice(0, 20);
  const text = $("memo-text").value.trim().slice(0, 100);
  if (!station || !text) return;
  data.memos.push({ route: data.current, station, text });
  save();
  renderMemos();
  e.target.reset();
});

function download(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  el("a", { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("export").addEventListener("click", exportBackup);

$("remind").addEventListener("click", () => {
  const t = $("remind-time").value;
  if (!t) return toast("通知する時刻を入れてください");
  download(reminderIcs(t, new Date(), location.href.split("#")[0]), "text/calendar", "suiteru-reminder.ics");
});
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
document.addEventListener("visibilitychange", () => { if (!document.hidden) { autoRoute(); setTime(); render(); } });

autoRoute();
setTime();
render();
// ストレージ逼迫時にブラウザが勝手に消さないよう依頼（許可されなくても動作は同じ）
navigator.storage?.persist?.().catch(() => {});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
