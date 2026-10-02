// listing.md の各欄が各ストアの文字数上限に収まっているか確認する
import { readFileSync } from "node:fs";

const md = readFileSync(new URL("./listing.md", import.meta.url), "utf8");
const LIMITS = { "play-short": 80, "play-full": 4000, "ios-subtitle": 30, "ios-promo": 170, "ios-keywords": 100 };
let ok = true;
for (const [key, max] of Object.entries(LIMITS)) {
  const m = md.match(new RegExp(`<!-- ${key} -->\\n([\\s\\S]*?)\\n<!-- /${key} -->`));
  if (!m) { console.log(`✖ ${key}: 見つからない`); ok = false; continue; }
  const len = [...m[1]].length; // 絵文字等も 1 文字として数える
  console.log(`${len <= max ? "✔" : "✖"} ${key}: ${len}/${max}`);
  if (len > max) ok = false;
}
process.exit(ok ? 0 : 1);
