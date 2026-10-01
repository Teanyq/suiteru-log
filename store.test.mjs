import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./www/store.js";

const fakeLocal = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m };
};
const fakePrefs = ({ failSet = false } = {}) => {
  const m = new Map();
  return {
    m,
    get: async ({ key }) => ({ value: m.has(key) ? m.get(key) : null }),
    set: async ({ key, value }) => { if (failSet) throw new Error("disk full"); m.set(key, value); },
  };
};

test("web: reads and writes localStorage", async () => {
  const local = fakeLocal();
  const s = createStore({ key: "k", local });
  assert.equal(await s.load(), null);
  assert.equal(await s.save("{}"), true);
  assert.equal(await s.load(), "{}");
});

test("web: a throwing localStorage is reported, not thrown", async () => {
  const local = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } };
  const s = createStore({ key: "k", local });
  assert.equal(await s.load(), null);
  assert.equal(await s.save("{}"), false);
});

test("app: uses Preferences, not localStorage", async () => {
  const local = fakeLocal(), prefs = fakePrefs();
  const s = createStore({ key: "k", prefs, local });
  assert.equal(await s.save('{"a":1}'), true);
  assert.equal(prefs.m.get("k"), '{"a":1}');
  assert.equal(local.m.size, 0);
  assert.equal(await s.load(), '{"a":1}');
});

test("app: a failing Preferences write is reported", async () => {
  const s = createStore({ key: "k", prefs: fakePrefs({ failSet: true }), local: fakeLocal() });
  assert.equal(await s.save("{}"), false);
});
