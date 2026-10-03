import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReport, aggregate, moodsOf, dayStartJst, DAILY_CAP } from "./api.mjs";

const ok = { device: "d-123", line: { c: "東急電鉄", l: "田園都市線" }, dir: "渋谷", daytype: "wd", slot: 30, car: 5, level: 4 };

test("parseReport accepts a valid report and normalizes the line key", () => {
  assert.deepEqual(parseReport(ok), { device: "d-123", line: "東急電鉄|田園都市線", dir: "渋谷", daytype: "wd", slot: 30, car: 5, level: 4, mood: null });
});

test("parseReport rejects anything out of range or malformed", () => {
  for (const bad of [
    null, {}, { ...ok, car: 0 }, { ...ok, car: 21 }, { ...ok, level: 6 }, { ...ok, level: 2.5 }, { ...ok, slot: 96 },
    { ...ok, daytype: "holiday" }, { ...ok, device: "" }, { ...ok, dir: "x".repeat(41) }, { ...ok, line: { c: "a|b", l: "c" } },
    { ...ok, line: "東急電鉄|田園都市線" }, { ...ok, mood: "angry" },
  ]) assert.equal(parseReport(bad), null, JSON.stringify(bad));
});

test("aggregate weights same slot fully, neighbors half, and decays old reports", () => {
  const now = Date.parse("2026-10-03T00:00:00Z");
  const day = 86400000;
  const rows = [
    { device: "a", car: 1, slot: 30, level: 5, created_at: now },
    { device: "b", car: 1, slot: 31, level: 1, created_at: now }, // 隣の枠は半分
    { car: 2, slot: 30, level: 2, created_at: now - 30 * day }, // 30 日前は半分
    { car: 3, slot: 33, level: 5, created_at: now },            // 枠が遠いので無視
    { car: 4, slot: 30, level: 5, created_at: now - 200 * day },// 古すぎるので無視
  ];
  const a = aggregate(rows, 30, now);
  assert.deepEqual(a.map((c) => c.car), [1, 2]);
  assert.equal(a[0].w, 1.5);
  assert.equal(a[0].mean, 3.67); // (5*1 + 1*0.5) / 1.5
  assert.equal(a[1].w, 0.5);
});

test("parseReport keeps an optional known mood", () => {
  assert.equal(parseReport({ ...ok, mood: "sleepy" }).mood, "sleepy");
  assert.equal(parseReport(ok).mood, null);
});

test("moodsOf: one vote per device (latest), nickname only with 3+ people on that car", () => {
  const rows = [
    { car: 7, mood: "happy", device: "a", created_at: 1 },
    { car: 7, mood: "sleepy", device: "a", created_at: 2 }, // a の最新は sleepy
    { car: 7, mood: "sleepy", device: "b", created_at: 1 },
    { car: 7, mood: "happy", device: "c", created_at: 1 },
    { car: 3, mood: "tired", device: "a", created_at: 1 },
    { car: 3, mood: "tired", device: "b", created_at: 1 }, // 2 人だけ → 出さない
  ];
  assert.deepEqual(moodsOf(rows), [{ car: 7, mood: "sleepy", n: 3 }]);
});

test("dayStartJst is local midnight in Japan", () => {
  const t = Date.parse("2026-10-03T14:59:00Z"); // JST 23:59
  assert.equal(new Date(dayStartJst(t)).toISOString(), "2026-10-02T15:00:00.000Z");
});

test("aggregate holds a lone outlier until someone else backs it up", () => {
  const now = Date.parse("2026-10-03T00:00:00Z");
  const r = (device, level) => ({ device, car: 1, slot: 30, level, created_at: now });
  const calm = [r("a", 1), r("b", 1), r("c", 2)];
  assert.equal(aggregate([...calm, r("x", 5)], 30, now)[0].n, 3); // 5 は保留
  assert.equal(aggregate([...calm, r("x", 5), r("y", 4)], 30, now)[0].n, 5); // 裏付けがあれば反映
});

test("aggregate caps one device at weight 2 per car (no flooding)", () => {
  const now = Date.parse("2026-10-03T00:00:00Z");
  const spam = Array.from({ length: 10 }, () => ({ device: "x", car: 1, slot: 30, level: 5, created_at: now }));
  const a = aggregate([...spam, { device: "a", car: 1, slot: 30, level: 1, created_at: now }], 30, now)[0];
  assert.equal(a.w, 3);
  assert.equal(a.mean, 3.67); // (5*2 + 1*1) / 3
  assert.ok(DAILY_CAP >= 10);
});
