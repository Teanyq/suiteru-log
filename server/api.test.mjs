import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReport, aggregate } from "./api.mjs";

const ok = { device: "d-123", line: { c: "東急電鉄", l: "田園都市線" }, dir: "渋谷", daytype: "wd", slot: 30, car: 5, level: 4 };

test("parseReport accepts a valid report and normalizes the line key", () => {
  assert.deepEqual(parseReport(ok), { device: "d-123", line: "東急電鉄|田園都市線", dir: "渋谷", daytype: "wd", slot: 30, car: 5, level: 4 });
});

test("parseReport rejects anything out of range or malformed", () => {
  for (const bad of [
    null, {}, { ...ok, car: 0 }, { ...ok, car: 21 }, { ...ok, level: 6 }, { ...ok, level: 2.5 }, { ...ok, slot: 96 },
    { ...ok, daytype: "holiday" }, { ...ok, device: "" }, { ...ok, dir: "x".repeat(41) }, { ...ok, line: { c: "a|b", l: "c" } },
    { ...ok, line: "東急電鉄|田園都市線" },
  ]) assert.equal(parseReport(bad), null, JSON.stringify(bad));
});

test("aggregate weights same slot fully, neighbors half, and decays old reports", () => {
  const now = Date.parse("2026-10-03T00:00:00Z");
  const day = 86400000;
  const rows = [
    { car: 1, slot: 30, level: 5, created_at: now },
    { car: 1, slot: 31, level: 1, created_at: now },            // 隣の枠は半分
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
