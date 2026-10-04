import { test } from "node:test";
import assert from "node:assert/strict";
import { slotOf, slotLabel, aggregate, recommend, parseBackup, reminderIcs, streak, forecast, routeForTime, resolveTime, recent, needsBackup, recParam, reminderNotifications, REMINDER_IDS, REMINDER_IDS_BACK, REPORT_ACTIONS, REGIONS, companiesIn, linesOf, directionsOf, companyLabel, MEMO_TAGS, memoLabel, lineLabel, carPrior, carEstimates, pointsOf, titleOf, reportPayload, dirOf, cheerOf, guessHit, guessStats, predHit, MOODS, nicknameOf, monthRecap, isOffDay, monthGoal, badgesOf, HOLIDAYS_UNTIL, companyGroups, journeyOf, bingoOf, BINGO_POOL, bingoBonus } from "./www/core.js";

// 2026-10-01 と 2026-10-08 は木曜(4)
const log = (t, level, route = "r1") => ({ route, t, level });
const THU = 4, FRI = 5, SAT = 6;

test("slot is 15-minute bucket of local time", () => {
  assert.equal(slotOf("2026-10-01T07:42:00"), 30);
  assert.equal(slotLabel(30), "07:30");
});

test("aggregate averages per weekday x slot and ignores other routes", () => {
  const agg = aggregate(
    [log("2026-10-01T07:31:00", 4), log("2026-10-08T07:44:00", 2), log("2026-10-01T07:35:00", 5, "r2")],
    "r1"
  );
  assert.deepEqual(agg.get(`${THU}-30`), { sum: 6, n: 2 });
  assert.equal(agg.size, 1);
});

test("recommend picks lowest average slots for the weekday", () => {
  const logs = [
    log("2026-10-01T07:30:00", 5), log("2026-10-01T07:45:00", 2),
    log("2026-10-01T08:00:00", 3), log("2026-10-01T08:15:00", 4),
  ];
  const r = recommend(logs, "r1", THU);
  assert.equal(r.fallback, false);
  assert.deepEqual(r.top.map((s) => s.label), ["07:45", "08:00", "08:15"]);
});

test("recommend pools same day-type when the day has no data", () => {
  const logs = [log("2026-10-01T07:30:00", 1)];
  const fri = recommend(logs, "r1", FRI);
  assert.equal(fri.fallback, true);
  assert.equal(fri.top[0].label, "07:30");
  assert.equal(recommend(logs, "r1", SAT).top.length, 0); // 平日データで土曜を推さない
});

test("parseBackup keeps valid data and drops bad rows", () => {
  const d = parseBackup(JSON.stringify({
    routes: [{ id: "r1", name: "A線" }, { id: 5, name: "bad" }, { id: "r2", name: "x".repeat(99) }],
    logs: [
      { route: "r1", t: "2026-10-01T07:42:00", level: 3 },
      { route: "r1", t: "2026-10-01T07:42:00", level: 9 },
      { route: "nope", t: "2026-10-01T07:42:00", level: 2 },
      { route: "r1", t: "<img>", level: 2 },
    ],
  }));
  assert.deepEqual(d.routes.map((r) => r.id), ["r1", "r2"]);
  assert.equal(d.routes[1].name.length, 40);
  assert.equal(d.logs.length, 1);
  assert.equal(d.current, "r1");
});

test("parseBackup rejects non-backup input", () => {
  assert.throws(() => parseBackup("not json"));
  assert.throws(() => parseBackup(JSON.stringify({ routes: [], logs: [] })));
});

test("recommend reports the usual (most-recorded) slot from the same pool", () => {
  const logs = [
    log("2026-10-01T07:30:00", 5), log("2026-10-08T07:31:00", 4), log("2026-09-24T07:40:00", 4),
    log("2026-10-01T08:15:00", 2),
  ];
  const r = recommend(logs, "r1", THU);
  assert.equal(r.usual.label, "07:30");
  assert.equal(r.usual.n, 3);
  assert.ok(Math.abs(r.usual.avg - 13 / 3) < 1e-9);
  assert.equal(recommend([], "r1", THU).usual, null);
});

test("parseBackup keeps valid memos and tolerates old backups without them", () => {
  const routes = [{ id: "r1", name: "A線" }];
  const d = parseBackup(JSON.stringify({ routes, logs: [], memos: [
    { route: "r1", station: " 渋谷 ", text: "5号車3ドア 半蔵門線へ" },
    { route: "r9", station: "x", text: "orphan" },
    { route: "r1", station: "", text: "no station" },
  ] }));
  assert.deepEqual(d.memos, [{ route: "r1", station: "渋谷", text: "5号車3ドア 半蔵門線へ" }]);
  assert.deepEqual(parseBackup(JSON.stringify({ routes, logs: [] })).memos, []);
});

test("reminderIcs builds a weekday recurring event with an alarm at the given time", () => {
  const ics = reminderIcs("07:40", new Date("2026-10-01T18:00:00"), "https://example.test/");
  const lines = ics.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.ok(lines.includes("DTSTART:20261002T074000")); // 18時なので翌日から
  assert.ok(lines.includes("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"));
  assert.ok(lines.includes("TRIGGER:PT0M"));
  assert.ok(lines.includes("URL:https://example.test/"));
  assert.ok(reminderIcs("19:00", new Date("2026-10-01T18:00:00"), "u").includes("DTSTART:20261001T190000"));
});

test("streak counts consecutive weekdays, skipping weekends and a not-yet-recorded today", () => {
  const logs = ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"].map((d) => log(`${d}T07:40:00`, 3));
  const fri = streak(logs, new Date("2026-10-02T20:00:00")); // 火〜金
  assert.equal(fri.days, 4);
  assert.equal(fri.todayDone, true);
  const mon = streak(logs, new Date("2026-10-05T06:00:00")); // 土日をまたぐ・月曜は未記録
  assert.equal(mon.days, 4);
  assert.equal(mon.todayDone, false);
  assert.equal(streak(logs, new Date("2026-10-06T06:00:00")).days, 0); // 月曜を飛ばした
  assert.deepEqual(mon.last7.map((d) => d.has), [true, true, true, true, false, false, false]); // 9/29〜10/5
  assert.deepEqual(mon.last7.map((d) => d.weekend), [false, false, false, false, true, true, false]);
});

test("forecast uses the weekday when it has enough data, else the day-type, else says how many more", () => {
  const thu = ["2026-09-17", "2026-09-24", "2026-10-01"].map((d) => log(`${d}T07:40:00`, 4));
  const wed = [log("2026-09-30T07:35:00", 1)];
  const a = forecast([...thu, ...wed], "r1", THU, 30);
  assert.deepEqual([a.avg, a.n, a.scope], [4, 3, "day"]);
  const b = forecast([...thu, ...wed], "r1", FRI, 30);
  assert.deepEqual([b.avg, b.n, b.scope], [13 / 4, 4, "type"]);
  const c = forecast(wed, "r1", FRI, 30);
  assert.deepEqual([c.avg, c.remaining], [null, 2]);
});

test("routeForTime picks the route most recorded near this time of day", () => {
  const logs = [
    log("2026-09-29T07:40:00", 3, "up"), log("2026-09-30T07:45:00", 3, "up"), log("2026-09-30T08:20:00", 3, "down"),
    log("2026-09-29T18:30:00", 3, "down"), log("2026-09-30T18:40:00", 3, "down"),
  ];
  assert.equal(routeForTime(logs, new Date("2026-10-01T07:50:00")), "up");
  assert.equal(routeForTime(logs, new Date("2026-10-01T18:10:00")), "down");
  assert.equal(routeForTime(logs, new Date("2026-10-01T13:00:00")), null);
});

test("resolveTime maps HH:MM to the most recent past occurrence", () => {
  const now = new Date("2026-10-02T00:05:00");
  assert.equal(resolveTime("23:50", now).getDate(), 1); // 0時過ぎの -15分 は前日
  assert.equal(resolveTime("00:05", now).getDate(), 2);
  assert.equal(resolveTime("07:40", new Date("2026-10-02T08:00:00")).getDate(), 2);
  assert.equal(resolveTime("", now), null);
});

test("tagged (delay/rain) records are excluded from aggregation", () => {
  const agg = aggregate([
    log("2026-10-01T07:31:00", 2),
    { ...log("2026-10-01T07:35:00", 5), tags: ["delay"] },
    { ...log("2026-10-01T07:40:00", 5), tags: ["rain"] },
  ], "r1");
  assert.deepEqual(agg.get(`${THU}-30`), { sum: 2, n: 1 });
});

test("parseBackup keeps only known tags", () => {
  const d = parseBackup(JSON.stringify({ routes: [{ id: "r1", name: "A" }], logs: [
    { route: "r1", t: "2026-10-01T07:40:00", level: 3, tags: ["rain", "x", "delay", "rain"] },
    { route: "r1", t: "2026-10-01T07:41:00", level: 3, tags: "delay" },
    { route: "r1", t: "2026-10-01T07:42:00", level: 3 },
  ] }));
  assert.deepEqual(d.logs.map((l) => l.tags), [["rain", "delay"], undefined, undefined]);
});

test("recent keeps only the last 90 days", () => {
  const now = new Date("2026-10-01T08:00:00");
  const logs = [log("2026-07-03T07:40:00", 3), log("2026-07-02T23:59:00", 3), log("2026-10-01T07:40:00", 3)];
  assert.deepEqual(recent(logs, now).map((l) => l.t.slice(0, 10)), ["2026-07-03", "2026-10-01"]);
});

test("needsBackup nudges only with enough data and no export in 30 days", () => {
  const now = new Date("2026-10-01T08:00:00");
  const logs = (n) => Array.from({ length: n }, () => log("2026-09-30T07:40:00", 3));
  assert.equal(needsBackup({ logs: logs(19) }, now), false); // 少ないうちは促さない
  assert.equal(needsBackup({ logs: logs(20) }, now), true); // 一度も書き出していない
  assert.equal(needsBackup({ logs: logs(20), lastExport: "2026-09-02" }, now), false);
  assert.equal(needsBackup({ logs: logs(20), lastExport: "2026-08-31" }, now), true);
});

test("recommend reports pool size so the UI can tell how many more records are needed", () => {
  const r = recommend([log("2026-10-01T07:30:00", 3), log("2026-10-01T07:45:00", 2)], "r1", THU);
  assert.equal(r.total, 2);
  assert.equal(r.slots, 2);
  assert.equal(recommend([], "r1", THU).total, 0);
});

test("recommend falls back to the day-type pool when the weekday has too little to compare", () => {
  const wed = ["07:30", "07:45", "08:00"].map((t) => log(`2026-09-30T${t}:00`, 3));
  const r = recommend([...wed, log("2026-10-01T07:30:00", 5)], "r1", THU);
  assert.equal(r.fallback, true); // 木曜は1件だけ → 平日全体で比べる
  assert.equal(r.total, 4);
});

test("period (試験・休暇) tag is a known tag and excluded from aggregation", () => {
  const d = parseBackup(JSON.stringify({ routes: [{ id: "r1", name: "A" }], logs: [
    { route: "r1", t: "2026-10-01T07:40:00", level: 1, tags: ["period"] },
    { route: "r1", t: "2026-10-01T07:41:00", level: 4 },
  ] }));
  assert.deepEqual(d.logs[0].tags, ["period"]);
  assert.deepEqual(aggregate(d.logs, "r1").get(`${THU}-30`), { sum: 4, n: 1 });
});

test("recParam accepts only a single integer level 1-5", () => {
  assert.equal(recParam("?rec=4"), 4);
  assert.equal(recParam("?x=1&rec=1"), 1);
  for (const bad of ["", "?rec=0", "?rec=6", "?rec=3.5", "?rec=abc", "?rec=", "?rec=4&rec=5", "?rec=04x"]) {
    assert.equal(recParam(bad), null, bad);
  }
});

test("reminderNotifications: next 4 weeks of working days only (no weekends or holidays), each at the set time", () => {
  const now = new Date("2026-10-07T21:00:00"); // 水曜の夜
  const ns = reminderNotifications("07:40", now);
  const days = ns.map((n) => n.schedule.at);
  assert.ok(days.every((d) => !isOffDay(d) && d.getHours() === 7 && d.getMinutes() === 40));
  assert.ok(days.every((d) => d > now && d - now <= 28 * 86400000));
  assert.ok(!days.some((d) => d.toDateString() === new Date("2026-10-12T12:00:00").toDateString()), "スポーツの日は鳴らない");
  assert.equal(days[0].toDateString(), new Date("2026-10-08T12:00:00").toDateString()); // 今日の 7:40 は過ぎたので明日から
  assert.ok(ns.length <= REMINDER_IDS.length && new Set(ns.map((n) => n.id)).size === ns.length);
  assert.ok(ns.every((n) => n.isExactNotification === false && n.actionTypeId === REPORT_ACTIONS.id && n.schedule.allowWhileIdle));
  // 通知のボタンは 3 つまで（Android）。いちばん押したい「ぎゅうぎゅう」を入れる
  assert.deepEqual(REPORT_ACTIONS.actions.map((a) => [a.id, a.title]), [["l2", "座れる"], ["l3", "立つけど余裕"], ["l5", "ぎゅうぎゅう"]]);
  // 帰りの通知は別の番号を使う（行きと上書きし合わない）
  const back = reminderNotifications("18:30", now, undefined, REMINDER_IDS_BACK);
  assert.ok(back.every((n) => REMINDER_IDS_BACK.includes(n.id)) && !REMINDER_IDS_BACK.some((id) => REMINDER_IDS.includes(id)));
  assert.equal(reminderNotifications("bad", now), null);
});

test("reminderNotifications: the answer goes in the title so it survives the one-line preview", () => {
  const ns = reminderNotifications("07:40", new Date("2026-10-07T21:00:00"), (d) => ({ title: `${d.getDate()}日は1号車が空いてそう`, body: "田園都市線 渋谷方面" }));
  assert.equal(ns[0].title, "8日は1号車が空いてそう");
  assert.equal(ns[0].body, "田園都市線 渋谷方面");
  assert.equal(reminderNotifications("07:40", new Date("2026-10-07T21:00:00"))[0].title, "今日の電車の混み具合は？"); // 予想が出せない時はいつもの文面
});

const LINES = [
  { c: "東急電鉄", l: "田園都市線", k: 4, r: ["関東"], s: ["中央林間", "つきみ野", "渋谷"] },
  { c: "東急電鉄", l: "東横線", k: 4, r: ["関東"], s: ["横浜", "渋谷"] },
  { c: "東日本旅客鉄道", l: "中央線", k: 2, r: ["関東", "中部"], s: ["塩尻", "神田"] },
  { c: "大阪市高速電気軌道", l: "御堂筋線", k: 3, r: ["近畿"], s: ["江坂", "なかもず"] },
];

test("companiesIn lists companies touching a region, JR first", () => {
  assert.deepEqual(companiesIn(LINES, "関東"), ["東日本旅客鉄道", "東急電鉄"]);
  assert.deepEqual(companiesIn(LINES, "中部"), ["東日本旅客鉄道"]); // 地域をまたぐ路線は両方に出る
  assert.ok(REGIONS.includes("九州・沖縄"));
});

test("linesOf filters by region and company", () => {
  assert.deepEqual(linesOf(LINES, "関東", "東急電鉄").map((l) => l.l), ["田園都市線", "東横線"]);
});

test("directionsOf names both directions by their terminal stations", () => {
  assert.deepEqual(directionsOf(LINES[0]), ["田園都市線 渋谷方面", "田園都市線 中央林間方面"]);
  assert.deepEqual(directionsOf({ l: "環状線", s: ["A"] }), ["環状線"]); // 1 駅だけなら方面なし
});

test("parseBackup keeps a route's line reference", () => {
  const d = parseBackup(JSON.stringify({ routes: [{ id: "r1", name: "田園都市線 渋谷方面", line: { c: "東急電鉄", l: "田園都市線" } }, { id: "r2", name: "x", line: { c: 5 } }], logs: [] }));
  assert.deepEqual(d.routes[0].line, { c: "東急電鉄", l: "田園都市線" });
  assert.equal(d.routes[1].line, undefined);
});

test("companyLabel shows the everyday name for well-known operators", () => {
  assert.equal(companyLabel("東京地下鉄"), "東京メトロ");
  assert.equal(companyLabel("東日本旅客鉄道"), "JR東日本");
  assert.equal(companyLabel("東急電鉄"), "東急電鉄"); // 登録がなければそのまま
});

test("memoLabel formats tap-built memos and still shows old free-text memos", () => {
  assert.equal(memoLabel({ station: "渋谷", car: 5, door: 3, tags: ["stairs", "transfer"] }), "5号車3ドア・階段・乗換");
  assert.equal(memoLabel({ station: "渋谷", car: 8 }), "8号車");
  assert.equal(memoLabel({ station: "渋谷", text: "半蔵門線の階段" }), "半蔵門線の階段");
  assert.equal(memoLabel({ station: "渋谷", car: 2, text: "前寄り" }), "2号車・前寄り");
  assert.ok(Object.keys(MEMO_TAGS).includes("elevator"));
});

test("parseBackup keeps car/door/tags memos and drops invalid ones", () => {
  const d = parseBackup(JSON.stringify({ routes: [{ id: "r1", name: "A" }], logs: [], memos: [
    { route: "r1", station: "渋谷", car: 5, door: 3, tags: ["stairs", "bogus"] },
    { route: "r1", station: "渋谷", car: 99 },
    { route: "r1", station: "渋谷" },
    { route: "r1", station: "新橋", text: "改札近い" },
  ] }));
  assert.deepEqual(d.memos, [
    { route: "r1", station: "渋谷", car: 5, door: 3, tags: ["stairs"] },
    { route: "r1", station: "新橋", text: "改札近い" },
  ]);
});

test("parseBackup keeps a route's car count (1-20)", () => {
  const d = parseBackup(JSON.stringify({ routes: [{ id: "r1", name: "A", cars: 10 }, { id: "r2", name: "B", cars: 99 }], logs: [] }));
  assert.equal(d.routes[0].cars, 10);
  assert.equal(d.routes[1].cars, undefined);
});

test("lineLabel drops the official route number subways carry", () => {
  assert.equal(lineLabel({ c: "東京地下鉄", l: "11号線半蔵門線" }), "半蔵門線");
  assert.equal(lineLabel({ c: "大阪市高速電気軌道", l: "1号線(御堂筋線)" }), "御堂筋線");
  assert.equal(lineLabel({ c: "横浜市", l: "4号線" }), "グリーンライン");
  assert.equal(lineLabel({ c: "千葉都市モノレール", l: "1号線" }), "1号線"); // 名前がなければそのまま
  assert.equal(lineLabel({ c: "東急電鉄", l: "田園都市線" }), "田園都市線");
  assert.deepEqual(directionsOf({ c: "東京地下鉄", l: "3号線銀座線", s: ["浅草", "渋谷"] }), ["銀座線 渋谷方面", "銀座線 浅草方面"]);
});

test("carPrior is U-shaped: end cars emptier than the middle", () => {
  const p = carPrior(10, 3);
  assert.ok(p[0] < p[4] && p[9] < p[5], "端の方が空いている");
  assert.ok(Math.abs(p[0] - 2.2) < 0.01 && Math.abs(p[0] - p[9]) < 1e-9, "左右対称・端は -0.8");
  assert.ok(p.every((x) => x >= 1 && x <= 5));
  assert.deepEqual(carPrior(1, 3), [3.4]); // 1両なら中央扱い
});

test("carEstimates starts from the prior and moves toward reports", () => {
  const now = new Date("2026-10-02T08:00:00");
  const base = { route: "r1", cars: 4, dow: 5, slot: 30, now };
  const none = carEstimates({ ...base, logs: [] });
  assert.equal(none.length, 4);
  assert.ok(none.every((c) => c.stars === 1 && c.n === 0), "報告なし = 推定のみ");
  // 2号車（事前は中央寄りで混雑側）に「ガラガラ」報告を 5 件 → 推定より空いている側へ
  const logs = Array.from({ length: 5 }, (_, i) => ({ route: "r1", t: `2026-10-0${1 - 0}T07:3${i}:00`, level: 1, car: 2 }));
  const est = carEstimates({ ...base, logs });
  assert.ok(est[1].value < none[1].value - 1, "報告で大きく下がる");
  assert.ok(est[1].stars >= 2);
  assert.equal(est[1].n, 5);
});

test("carEstimates: old reports count less, other slots/routes ignored, stairs push up", () => {
  const now = new Date("2026-10-02T08:00:00");
  const base = { route: "r1", cars: 4, dow: 5, slot: 30, now };
  const fresh = carEstimates({ ...base, logs: [{ route: "r1", t: "2026-10-01T07:35:00", level: 5, car: 1 }] })[0].value;
  const old = carEstimates({ ...base, logs: [{ route: "r1", t: "2026-07-03T07:35:00", level: 5, car: 1 }] })[0].value;
  assert.ok(fresh > old, "新しい報告ほど効く");
  const other = carEstimates({ ...base, logs: [{ route: "r2", t: "2026-10-01T07:35:00", level: 5, car: 1 }, { route: "r1", t: "2026-10-01T18:00:00", level: 5, car: 1 }] });
  assert.equal(other[0].n, 0, "別路線・別の時間帯は使わない");
  const stairs = carEstimates({ ...base, logs: [], stairsCars: [1] });
  assert.ok(stairs[0].value > carEstimates({ ...base, logs: [] })[0].value, "階段のある号車は混雑側");
});

test("parseBackup keeps a record's car (1-20)", () => {
  const d = parseBackup(JSON.stringify({ routes: [{ id: "r1", name: "A" }], logs: [
    { route: "r1", t: "2026-10-01T07:40:00", level: 3, car: 5 },
    { route: "r1", t: "2026-10-01T07:41:00", level: 3, car: 0 },
  ] }));
  assert.equal(d.logs[0].car, 5);
  assert.equal(d.logs[1].car, undefined);
});

test("pointsOf: 10 per record, +5 with a car, +50 for every 5 consecutive weekdays", () => {
  const base = (logs) => pointsOf(logs) - bingoBonus(logs); // ビンゴのごほうびは別のテスト
  const rec = (day, car) => ({ route: "r1", t: `${day}T07:40:00`, level: 3, ...(car ? { car } : {}) });
  assert.equal(base([]), 0);
  assert.equal(base([rec("2026-09-28"), rec("2026-09-28", 3)]), 25);
  // 月〜金（9/28〜10/2）の 5 連続 = 5×10 + 50
  const week = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"].map((d) => rec(d));
  assert.equal(base(week), 100);
  // 土日をはさんでも途切れない: 木金 + 月火水 = 5 連続
  const across = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"].map((d) => rec(d));
  assert.equal(base(across), 100);
  // 平日を 1 日空けると途切れる
  const broken = ["2026-09-28", "2026-09-29", "2026-10-01", "2026-10-02", "2026-10-05"].map((d) => rec(d));
  assert.equal(base(broken), 50);
});

test("titleOf picks the title by points and says how far to the next", () => {
  assert.deepEqual(titleOf(0), { title: "見習い乗客", next: "通勤ルーキー", toNext: 100 });
  assert.deepEqual(titleOf(320), { title: "号車ハンター", next: "ベテラン車掌", toNext: 380 });
  assert.equal(titleOf(99999).next, null);
});

test("carEstimates blends everyone's shared reports with mine", () => {
  const now = new Date("2026-10-02T08:00:00");
  const base = { route: "r1", cars: 4, dow: 5, slot: 30, now, logs: [] };
  const alone = carEstimates(base)[2];
  const withShared = carEstimates({ ...base, shared: [{ car: 3, w: 10, mean: 1, n: 12 }] })[2];
  assert.ok(withShared.value < alone.value - 1, "みんなの報告で大きく動く");
  assert.equal(withShared.shared, 12);
  assert.equal(withShared.stars, 3);
});

test("dirOf reads the direction from the route", () => {
  assert.equal(dirOf({ name: "田園都市線 渋谷方面" }), "渋谷");
  assert.equal(dirOf({ name: "x", dir: "中央林間" }), "中央林間");
  assert.equal(dirOf({ name: "いつもの路線" }), null);
});

test("reportPayload builds an anonymous report only when line, direction and car are known", () => {
  const route = { id: "r1", name: "田園都市線 渋谷方面", line: { c: "東急電鉄", l: "田園都市線" } };
  const log = { route: "r1", t: "2026-10-02T07:42:00", level: 4, car: 5 };
  assert.deepEqual(reportPayload("dev-1", route, log), { device: "dev-1", line: { c: "東急電鉄", l: "田園都市線" }, dir: "渋谷", daytype: "wd", slot: 30, car: 5, level: 4 });
  assert.equal(reportPayload("dev-1", route, { ...log, car: undefined }), null, "号車なしは送らない");
  assert.equal(reportPayload("dev-1", { ...route, line: undefined }, log), null, "一覧から選んでいない路線は送らない");
  assert.equal(reportPayload("dev-1", route, { ...log, tags: ["delay"] }), null, "遅延などの印つきは送らない");
});

test("carEstimates: one extreme record doesn't flatten the whole train into ties", () => {
  const now = new Date("2026-10-02T08:00:00");
  const est = carEstimates({ route: "r1", cars: 10, dow: 5, slot: 30, now, logs: [{ route: "r1", t: "2026-10-02T07:30:00", level: 1, car: 7 }] });
  const min = Math.min(...est.map((c) => c.value));
  const ties = est.filter((c) => c.value - min < 0.05).length;
  assert.ok(ties <= 2, `同点が ${ties} 両もある`);
});

test("pointsOf: crowded rides (4-5) earn a +10 warrior bonus", () => {
  const rec = (level) => ({ route: "r1", t: "2026-09-28T07:40:00", level });
  assert.equal(pointsOf([rec(3)]), 10);
  assert.equal(pointsOf([rec(4)]), 20);
  assert.equal(pointsOf([rec(5)]), 20);
});

test("cheerOf: crowded beats streak beats weekday beats empty, otherwise rotates", () => {
  assert.match(cheerOf({ level: 5, streakDays: 5, dow: 1, n: 0 }), /戦士/);
  assert.match(cheerOf({ level: 3, streakDays: 10, dow: 1, n: 0 }), /10日連続/);
  assert.match(cheerOf({ level: 3, streakDays: 3, dow: 1, n: 0 }), /月曜/);
  assert.match(cheerOf({ level: 3, streakDays: 3, dow: 5, n: 0 }), /金曜/);
  assert.match(cheerOf({ level: 1, streakDays: 3, dow: 3, n: 0 }), /空いて/);
  const plain = new Set([0, 1, 2, 3].map((n) => cheerOf({ level: 3, streakDays: 1, dow: 3, n })));
  assert.ok(plain.size > 1, "日替わりで変わる");
});

test("guess game: low hits on 1-2, high hits on 4-5, and each hit is +5pt", () => {
  assert.equal(guessHit("low", 2), true);
  assert.equal(guessHit("low", 3), false);
  assert.equal(guessHit("high", 4), true);
  assert.equal(guessHit("high", 2), false);
  assert.equal(guessHit(undefined, 1), null); // 予想していない
  const rec = (level, guess) => ({ route: "r1", t: "2026-09-28T07:40:00", level, ...(guess ? { guess } : {}) });
  assert.equal(pointsOf([rec(1, "low")]), 15);
  assert.equal(pointsOf([rec(3, "low")]), 10);
  assert.deepEqual(guessStats([rec(1, "low"), rec(3, "high"), rec(5, "high"), rec(2)]), { n: 3, hit: 2 });
});

test("parseBackup keeps a valid guess and drops a bad one", () => {
  const d = parseBackup(JSON.stringify({
    routes: [{ id: "r1", name: "A" }],
    logs: [{ route: "r1", t: "2026-10-01T07:40:00", level: 1, guess: "low" }, { route: "r1", t: "2026-10-01T07:41:00", level: 1, guess: "maybe" }],
  }));
  assert.equal(d.logs[0].guess, "low");
  assert.equal(d.logs[1].guess, undefined);
});

test("mood: kept in backups, sent with reports, and turned into a car nickname", () => {
  const d = parseBackup(JSON.stringify({ routes: [{ id: "r1", name: "A" }],
    logs: [{ route: "r1", t: "2026-10-01T07:40:00", level: 3, mood: "sleepy" }, { route: "r1", t: "2026-10-01T07:41:00", level: 3, mood: "evil" }] }));
  assert.equal(d.logs[0].mood, "sleepy");
  assert.equal(d.logs[1].mood, undefined);
  const route = { id: "r1", name: "x", line: { c: "C", l: "L" }, dir: "D" };
  assert.equal(reportPayload("dev", route, { t: "2026-10-01T07:40:00", level: 3, car: 2, mood: "happy" }).mood, "happy");
  assert.equal("mood" in reportPayload("dev", route, { t: "2026-10-01T07:40:00", level: 3, car: 2 }), false);
  for (const m of Object.keys(MOODS)) assert.match(nicknameOf(m), /号$/);
});

test("monthRecap counts this month's rides, empty/crowded rides, guesses and the top mood", () => {
  const rec = (t, level, extra = {}) => ({ route: "r1", t, level, ...extra });
  const logs = [
    rec("2026-09-30T07:40:00", 1), // 先月は数えない
    rec("2026-10-01T07:40:00", 1, { guess: "low", mood: "sleepy" }),
    rec("2026-10-02T07:40:00", 5, { guess: "low", mood: "sleepy" }),
    rec("2026-10-05T07:40:00", 3, { mood: "happy" }),
  ];
  assert.deepEqual(monthRecap(logs, new Date("2026-10-20T12:00:00")), {
    month: 10, rides: 3, empty: 1, crowded: 1, guessN: 2, guessHit: 1, mood: "sleepy",
  });
  assert.equal(monthRecap(logs, new Date("2026-11-01T12:00:00")).rides, 0);
});

test("auto prediction: the app's predicted level is checked against the record, +5pt on an exact hit", () => {
  const rec = (level, extra) => ({ route: "r1", t: "2026-09-28T07:40:00", level, car: 1, ...extra });
  assert.equal(predHit(rec(2, { pred: 2 })), true);
  assert.equal(predHit(rec(3, { pred: 2 })), false);
  assert.equal(predHit(rec(3, {})), null);
  assert.equal(predHit(rec(1, { guess: "low" })), true); // 以前の手動予想も数える
  assert.equal(pointsOf([rec(2, { pred: 2 })]) - bingoBonus([rec(2, { pred: 2 })]), 20); // ビンゴのごほうびは別
  assert.deepEqual(guessStats([rec(2, { pred: 2 }), rec(3, { pred: 2 }), rec(3, {})]), { n: 2, hit: 1 });
  const d = parseBackup(JSON.stringify({ routes: [{ id: "r1", name: "A" }], logs: [{ ...rec(2, { pred: 2 }) }, { ...rec(2, { pred: 9 }) }] }));
  assert.equal(d.logs[0].pred, 2);
  assert.equal(d.logs[1].pred, undefined);
});

test("holidays count as days off: shared reports, streaks and car estimates", () => {
  // 2026-10-12（月）スポーツの日
  assert.equal(isOffDay(new Date("2026-10-12T08:00:00")), true);
  assert.equal(isOffDay(new Date("2026-10-13T08:00:00")), false);
  assert.equal(isOffDay(new Date("2026-10-10T08:00:00")), true); // 土曜
  const route = { id: "r1", name: "x", line: { c: "C", l: "L" }, dir: "D" };
  assert.equal(reportPayload("dev", route, { t: "2026-10-12T08:00:00", level: 1, car: 2 }).daytype, "we");
  // 金 → 祝日の月をはさんで → 火: 連続は途切れない
  const days = ["2026-10-08", "2026-10-09", "2026-10-13"].map((d) => ({ route: "r1", t: `${d}T08:00:00`, level: 3 }));
  assert.equal(streak(days, new Date("2026-10-13T20:00:00")).days, 3);
  // 祝日の記録は、平日の号車予想に入らない
  const holidayLog = { route: "r1", t: "2026-10-12T08:00:00", level: 1, car: 1 };
  const est = carEstimates({ route: "r1", cars: 4, dow: 2, slot: 32, now: new Date("2026-10-13T08:00:00"), logs: [holidayLog], off: false });
  assert.equal(est[0].n, 0);
});

test("carEstimates: shared reports also move the baseline, so unreported cars follow the time of day", () => {
  // 深夜・4 両・自分の記録なし・みんなの報告は 1 号車に「ガラガラ」5 件分
  const est = carEstimates({ route: "r1", cars: 4, dow: 3, slot: 4, now: new Date("2026-10-07T01:00:00"), logs: [], shared: [{ car: 1, w: 5, mean: 1, n: 5 }] });
  assert.ok(est[1].value < 2.5, `報告のない 2 号車も空いている側に寄る（${est[1].value}）`);
  assert.ok(est[0].value < est[1].value, "報告のある 1 号車はいちばん空いている");
});

test("parseBackup carries the share ID over to the new phone (and ignores a bad one)", () => {
  const base = { routes: [{ id: "r1", name: "A" }], logs: [] };
  assert.equal(parseBackup(JSON.stringify({ ...base, device: "abc-123" })).device, "abc-123");
  assert.equal("device" in parseBackup(JSON.stringify({ ...base, device: "x".repeat(65) })), false);
  assert.equal("device" in parseBackup(JSON.stringify(base)), false);
});

test("monthly goal = weekdays in that month (one ride a day is enough); reaching it earns the season's badge", () => {
  assert.equal(monthGoal("2026-10"), 21); // 平日 22 日 − スポーツの日
  assert.equal(monthGoal("2026-11"), 19);
  const rides = (ym, n) => Array.from({ length: n }, (_, i) => ({ route: "r1", t: `${ym}-${String(1 + (i % 28)).padStart(2, "0")}T08:00:00`, level: 3 }));
  const logs = [...rides("2026-09", monthGoal("2026-09")), ...rides("2026-10", monthGoal("2026-10") - 1), ...rides("2026-12", monthGoal("2026-12") + 5)];
  assert.deepEqual(badgesOf(logs), [{ ym: "2026-09", emoji: "🎑" }, { ym: "2026-12", emoji: "🎄" }]);
});

test("late-night rides belong to the previous service day (Friday's last train is a weekday)", () => {
  assert.equal(isOffDay(new Date("2026-10-10T00:30:00")), false); // 土曜 0:30 = 金曜の終電
  assert.equal(isOffDay(new Date("2026-10-12T01:00:00")), true);  // 月曜(祝) 1:00 = 日曜の終電
  assert.equal(isOffDay(new Date("2026-10-10T05:00:00")), true);  // 土曜の始発以降は休日
  const route = { id: "r1", name: "x", line: { c: "C", l: "L" }, dir: "D" };
  assert.equal(reportPayload("d", route, { t: "2026-10-10T00:30:00", level: 5, car: 3 }).daytype, "wd");
});

test("the holiday list still covers next year (update core.js HOLIDAYS from the Cabinet Office CSV every February)", () => {
  assert.ok(HOLIDAYS_UNTIL >= new Date().getFullYear() + (new Date().getMonth() >= 10 ? 1 : 0),
    `祝日の一覧が ${HOLIDAYS_UNTIL} 年までしかない`);
});

test("cheerOf has enough variety not to repeat for weeks, and fits the hour and season", () => {
  const plain = (n, extra = {}) => cheerOf({ level: 3, streakDays: 1, dow: 3, n, hour: 8, month: 5, ...extra });
  assert.ok(new Set(Array.from({ length: 60 }, (_, n) => plain(n))).size >= 20, "ふつうの日の言葉が 20 種類以上");
  assert.ok(new Set(Array.from({ length: 8 }, (_, n) => cheerOf({ level: 5, streakDays: 1, dow: 3, n }))).size >= 3, "ぎゅうぎゅうの日も毎回同じではない");
  assert.ok(Array.from({ length: 12 }, (_, n) => plain(n, { hour: 6 })).some((t) => /早/.test(t)), "早朝の言葉");
  assert.ok(Array.from({ length: 12 }, (_, n) => plain(n, { month: 6 })).some((t) => /梅雨|雨/.test(t)), "梅雨の言葉");
});

test("companyGroups splits a long company list under headings, keeping the companiesIn order", () => {
  const L = [
    { c: "東日本旅客鉄道", l: "山手線", k: 2, r: ["関東"], s: [] }, { c: "東京都", l: "大江戸線", k: 3, r: ["関東"], s: [] },
    { c: "東京地下鉄", l: "銀座線", k: 4, r: ["関東"], s: [] }, { c: "東急電鉄", l: "東横線", k: 4, r: ["関東"], s: [] }, { c: "東急電鉄", l: "田園都市線", k: 4, r: ["関東"], s: [] },
    { c: "小田急電鉄", l: "小田原線", k: 4, r: ["関東"], s: [] }, { c: "ゆりかもめ", l: "東京臨海新交通臨海線", k: 5, r: ["関東"], s: [] },
  ];
  assert.deepEqual(companyGroups(L, "関東"), [
    { label: "JR・新幹線", companies: ["東日本旅客鉄道"] },
    { label: "地下鉄・公営", companies: ["東京都", "東京地下鉄"] }, // メトロは民営だが地下鉄の見出しに
    { label: "私鉄", companies: ["東急電鉄", "小田急電鉄"] },
    { label: "その他（第三セクターなど）", companies: ["ゆりかもめ"] },
  ]);
});

test("journeyOf: each record moves one real station; at the terminal it transfers to a line through that station", () => {
  const L = [
    { c: "C", l: "A線", k: 4, r: ["関東"], s: ["a", "b", "c", "d"] },
    { c: "C", l: "B線", k: 4, r: ["関東"], s: ["x", "d", "e", "f", "g"] },
    { c: "C", l: "C線", k: 4, r: ["関東"], s: ["g", "h"] },
  ];
  const start = { c: "C", l: "A線", dir: "d" };
  const j0 = journeyOf(L, start, 0);
  assert.deepEqual([j0.line.l, j0.at, j0.next, j0.toEnd, j0.terminal, j0.done.length], ["A線", "a", "b", 3, "d", 0]);
  assert.deepEqual([journeyOf(L, start, 2).at, journeyOf(L, start, 2).toEnd], ["c", 1]);
  const j3 = journeyOf(L, start, 3); // A 線を制覇して、d を通る B 線へ（長い方 = g 方面）
  assert.deepEqual([j3.line.l, j3.at, j3.next, j3.terminal, j3.done.map((d) => d.l)], ["B線", "d", "e", "g", ["A線"]]);
  const j6 = journeyOf(L, start, 6);
  assert.deepEqual([j6.line.l, j6.at, j6.next, j6.done.map((d) => d.l)], ["C線", "g", "h", ["A線", "B線"]]);
  assert.equal(journeyOf(L, { c: "C", l: "A線", dir: "a" }, 1).at, "c"); // 逆方向（a 方面）は d から
  assert.equal(journeyOf(L, start, 500).passed, 500); // どこまで行っても止まらない
});

test("bingoOf: 3x3 weekly card with a FREE center; cells fill from ordinary records; never asks for a crowding level", () => {
  const now = new Date("2026-10-09T20:00:00"); // 金曜
  const b = bingoOf([], now);
  assert.equal(b.cells.length, 9);
  assert.equal(b.cells[4].id, "free");
  assert.equal(b.cells[4].hit, true);
  assert.equal(b.lines, 0);
  assert.deepEqual(bingoOf([], new Date("2026-10-06T08:00:00")).cells.map((c) => c.id), b.cells.map((c) => c.id), "同じ週は同じマス");
  assert.notDeepEqual(bingoOf([], new Date("2026-10-13T08:00:00")).cells.map((c) => c.id), b.cells.map((c) => c.id), "週が変わるとマスも変わる");
  assert.ok(BINGO_POOL.every((p) => !/ガラガラ|座れる|混んで|ぎゅうぎゅう|空いて/.test(p.label)), "混み具合を指定するマスはない");
  // その週の記録でマスが開く（例: 号車つきの記録 → 「号車を選んで記録」）
  const logs = [{ route: "r1", t: "2026-10-06T08:00:00", level: 3, car: 2, mood: "happy" }, { route: "r1", t: "2026-10-06T18:30:00", level: 3 }];
  const hits = bingoOf(logs, now).cells.filter((c) => c.hit).map((c) => c.id);
  for (const id of hits) assert.ok(["free", "car", "mood", "both", "night", "mon"].includes(id), id);
  assert.equal(bingoOf(logs, new Date("2026-10-13T08:00:00")).cells.filter((c) => c.hit).length, 1, "先週の記録は数えない");
});

test("bingoBonus: each completed bingo line of each week is +20pt, and pointsOf includes it", () => {
  const logs = [];
  for (const d of ["05", "06", "07", "08", "09", "10"]) for (const h of ["06:30", "18:30"])
    logs.push({ route: "r1", t: `2026-10-${d}T${h}:00`, level: 3, car: d === "05" ? 1 : 2, mood: "happy", pred: 3 });
  const lines = bingoOf(logs, new Date("2026-10-10T12:00:00")).lines;
  assert.ok(lines >= 1);
  assert.equal(bingoBonus(logs), 20 * lines);
  const noBingo = logs.slice(0, 1); // 1 件だけではそろわない
  assert.equal(bingoBonus(noBingo), 0);
  assert.equal(pointsOf(logs) - bingoBonus(logs), logs.reduce((p, l) => p + 10 + 5 + 5, 0) + 50); // 記録・号車・的中・5 日連続
});

test("bingo is personal: never-done cells (early, weekend) don't appear, and each card has some stretch cells", () => {
  const logs = [];
  for (let i = 0; i < 40; i++) {
    const d = new Date("2026-08-31T12:00:00"); d.setDate(d.getDate() + i);
    if (isOffDay(d)) continue;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    logs.push({ route: "r1", t: `${k}T08:10:00`, level: 3, car: 9 });
  }
  for (const day of ["2026-10-13", "2026-10-20", "2026-10-27", "2026-11-03"]) {
    const ids = bingoOf(logs, new Date(`${day}T12:00:00`)).cells.map((c) => c.id);
    assert.ok(!ids.includes("early") && !ids.includes("weekend"), `${day}: ${ids}`);
    assert.ok(ids.filter((id) => BINGO_POOL.find((p) => p.id === id)?.kind === "stretch").length >= 3, `${day}: 頑張ればマスがある`);
  }
});
