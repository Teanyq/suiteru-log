import { test } from "node:test";
import assert from "node:assert/strict";
import { slotOf, slotLabel, aggregate, recommend, parseBackup } from "./core.js";

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
