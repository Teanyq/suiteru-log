import { test } from "node:test";
import assert from "node:assert/strict";
import { slotOf, slotLabel, aggregate, recommend, parseBackup, reminderIcs, streak, forecast, routeForTime, resolveTime, recent, needsBackup, recParam, reminderNotifications, REMINDER_IDS, REGIONS, companiesIn, linesOf, directionsOf, companyLabel, MEMO_TAGS, memoLabel } from "./www/core.js";

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

test("reminderNotifications: one repeating notification per weekday (Capacitor weekday 2=Mon..6=Fri)", () => {
  const ns = reminderNotifications("07:40");
  assert.deepEqual(ns.map((n) => n.id), REMINDER_IDS);
  assert.deepEqual(ns.map((n) => n.schedule.on.weekday), [2, 3, 4, 5, 6]);
  assert.ok(ns.every((n) => n.schedule.on.hour === 7 && n.schedule.on.minute === 40 && n.schedule.allowWhileIdle));
  assert.ok(ns.every((n) => n.isExactNotification === false)); // 正確アラーム権限なしで設定画面に飛ばさない
  assert.equal(reminderNotifications("bad"), null);
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
