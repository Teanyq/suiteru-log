import { test } from "node:test";
import assert from "node:assert/strict";
import { slotOf, slotLabel, aggregate, recommend } from "./core.js";

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
