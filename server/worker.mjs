// Cloudflare Worker: 匿名の号車混雑報告の受付と集計（docs/SPEC-v2.md）
import { parseReport, aggregate, moodsOf, dayStartJst, RATE_LIMIT_MS, WINDOW_DAYS } from "./api.mjs";

// アプリ（Android: https://localhost / iOS: capacitor://localhost）と Web 版からだけ受け付ける
const ORIGINS = new Set(["https://teanyq.github.io", "https://localhost", "capacitor://localhost", "http://localhost:5180"]);
const MAX_BODY = 2048;

const corsOf = (req) => {
  const o = req.headers.get("Origin");
  return o && ORIGINS.has(o) ? { "Access-Control-Allow-Origin": o, Vary: "Origin" } : {};
};
const json = (obj, status, headers) => new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsOf(req);
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } });
    }

    if (url.pathname === "/v1/reports" && req.method === "POST") {
      if (Number(req.headers.get("Content-Length") ?? 0) > MAX_BODY) return json({ ok: false }, 413, cors);
      let body;
      try { body = JSON.parse((await req.text()).slice(0, MAX_BODY)); } catch { return json({ ok: false }, 400, cors); }
      const r = parseReport(body);
      if (!r) return json({ ok: false }, 400, cors);
      const now = Date.now();
      const recent = await env.DB.prepare("SELECT 1 FROM reports WHERE device = ? AND line = ? AND dir = ? AND car = ? AND created_at > ? LIMIT 1")
        .bind(r.device, r.line, r.dir, r.car, now - RATE_LIMIT_MS).first();
      if (recent) return json({ ok: false, reason: "too_soon" }, 429, cors);
      await env.DB.prepare("INSERT INTO reports (device, line, dir, daytype, slot, car, level, mood, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(r.device, r.line, r.dir, r.daytype, r.slot, r.car, r.level, r.mood, now).run();
      return json({ ok: true }, 201, cors);
    }

    if (url.pathname === "/v1/cars" && req.method === "GET") {
      const q = url.searchParams;
      const slot = Number(q.get("slot"));
      const p = parseReport({ device: "q", line: { c: q.get("c"), l: q.get("l") }, dir: q.get("dir"), daytype: q.get("daytype"), slot, car: 1, level: 1 });
      if (!p) return json({ cars: [] }, 400, cors);
      const now = Date.now();
      const { results } = await env.DB.prepare(
        "SELECT car, slot, level, created_at FROM reports WHERE line = ? AND dir = ? AND daytype = ? AND slot BETWEEN ? AND ? AND created_at > ? AND device != ? LIMIT 5000")
        // 自分の報告はアプリ側で記録として数えるので除く（二重に数えない）
        .bind(p.line, p.dir, p.daytype, slot - 1, slot + 1, now - WINDOW_DAYS * 86400000, (q.get("device") ?? "").slice(0, 64)).all();
      // 今日のこの路線・方面の気分スタンプ（号車のあだ名用。3 人未満の号車は返さない）
      const { results: moods } = await env.DB.prepare(
        "SELECT car, mood, device, created_at FROM reports WHERE line = ? AND dir = ? AND created_at >= ? AND mood IS NOT NULL LIMIT 5000")
        .bind(p.line, p.dir, dayStartJst(now)).all();
      return json({ cars: aggregate(results, slot, now), moods: moodsOf(moods) }, 200, { ...cors, "Cache-Control": "public, max-age=60" });
    }

    return json({ error: "not found" }, 404, cors);
  },
};
