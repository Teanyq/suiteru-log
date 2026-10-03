// Cloudflare Worker: 匿名の号車混雑報告の受付と集計（docs/SPEC-v2.md）
import { parseReport, aggregate, moodsOf, dayStartJst, RATE_LIMIT_MS, WINDOW_DAYS, HELPED_DAYS, DAILY_CAP, rankingOf } from "./api.mjs";

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
      const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE device = ? AND created_at >= ?").bind(r.device, dayStartJst(now)).first();
      if (today.n >= DAILY_CAP) return json({ ok: false, reason: "daily_cap" }, 429, cors);
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
      const device = (q.get("device") ?? "").slice(0, 64);
      const day = new Date(dayStartJst(now) + 9 * 3600000).toISOString().slice(0, 10);
      // 「あなたの報告が◯人の役に立った」用: 誰が・どの枠を見たかを 1 日 1 行だけ残す（HELPED_DAYS を過ぎたら消す）
      if (device) {
        await env.DB.batch([
          env.DB.prepare("INSERT OR IGNORE INTO views (line, dir, daytype, slot, day, device) VALUES (?, ?, ?, ?, ?, ?)").bind(p.line, p.dir, p.daytype, slot, day, device),
          env.DB.prepare("DELETE FROM views WHERE day < ?").bind(new Date(now - (HELPED_DAYS + 1) * 86400000).toISOString().slice(0, 10)),
        ]);
      }
      const { results } = await env.DB.prepare(
        "SELECT device, car, slot, level, created_at FROM reports WHERE line = ? AND dir = ? AND daytype = ? AND slot BETWEEN ? AND ? AND created_at > ? AND device != ? LIMIT 5000")
        // 自分の報告はアプリ側で記録として数えるので除く（二重に数えない）
        .bind(p.line, p.dir, p.daytype, slot - 1, slot + 1, now - WINDOW_DAYS * 86400000, device).all();
      // 今日のこの路線・方面の気分スタンプ（号車のあだ名用。3 人未満の号車は返さない）
      const { results: moods } = await env.DB.prepare(
        "SELECT car, mood, device, created_at FROM reports WHERE line = ? AND dir = ? AND created_at >= ? AND mood IS NOT NULL LIMIT 5000")
        .bind(p.line, p.dir, dayStartJst(now)).all();
      // いまこの号車にいる仲間: 直近 30 分に同じ路線・方面・号車を報告したほかの端末の数
      const { results: riders } = await env.DB.prepare(
        "SELECT car, COUNT(DISTINCT device) AS n FROM reports WHERE line = ? AND dir = ? AND created_at > ? AND device != ? GROUP BY car")
        .bind(p.line, p.dir, now - 30 * 60000, device).all();
      return json({ cars: aggregate(results, slot, now), moods: moodsOf(moods), riders }, 200, { ...cors, "Cache-Control": "public, max-age=60" });
    }

    // この端末の報告がある枠（路線・方面・平日休日・15 分枠）を、ほかの人が何人・日見に来たか（直近 HELPED_DAYS 日）
    if (url.pathname === "/v1/me" && req.method === "GET") {
      const device = (url.searchParams.get("device") ?? "").slice(0, 64);
      if (!device) return json({ helped: 0 }, 400, cors);
      const now = Date.now();
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM views v JOIN (SELECT DISTINCT line, dir, daytype, slot FROM reports WHERE device = ? AND created_at > ?) r
           ON v.line = r.line AND v.dir = r.dir AND v.daytype = r.daytype AND v.slot = r.slot
         WHERE v.device != ? AND v.day >= ?`)
        .bind(device, now - HELPED_DAYS * 86400000, device, new Date(now - HELPED_DAYS * 86400000).toISOString().slice(0, 10)).first();
      return json({ helped: row?.n ?? 0 }, 200, { ...cors, "Cache-Control": "private, max-age=600" });
    }

    // 路線ごとの報告数ランキング（直近 30 日、自動ニックネーム）
    if (url.pathname === "/v1/rank" && req.method === "GET") {
      const q = url.searchParams;
      const p = parseReport({ device: "q", line: { c: q.get("c"), l: q.get("l") }, dir: "x", daytype: "wd", slot: 0, car: 1, level: 1 });
      if (!p) return json({ top: [], me: null }, 400, cors);
      const { results } = await env.DB.prepare(
        "SELECT device, COUNT(*) AS n FROM reports WHERE line = ? AND created_at > ? GROUP BY device ORDER BY n DESC LIMIT 1000")
        .bind(p.line, Date.now() - HELPED_DAYS * 86400000).all();
      return json(rankingOf(results, (q.get("device") ?? "").slice(0, 64)), 200, { ...cors, "Cache-Control": "private, max-age=600" });
    }

    return json({ error: "not found" }, 404, cors);
  },
};
