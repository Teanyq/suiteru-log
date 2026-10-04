// 本番の利用状況（どの路線から宣伝するか・効果が出たかの判断用）。端末 ID など個人に近い情報は出さない。
// 使い方: npm run stats（wrangler にログイン済みであること）
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../server/", import.meta.url));
const WRANGLER = fileURLToPath(new URL("../server/node_modules/wrangler/bin/wrangler.js", import.meta.url));

const QUERIES = {
  "直近 7 日の報告数（日本時間の日付ごと）":
    "SELECT date(created_at / 1000, 'unixepoch', '+9 hours') AS 日付, COUNT(*) AS 報告, COUNT(DISTINCT device) AS 人 FROM reports WHERE created_at > (strftime('%s','now') - 7 * 86400) * 1000 GROUP BY 1 ORDER BY 1",
  "路線ごと（30 日、多い順に 10）":
    "SELECT line AS 路線, COUNT(*) AS 報告, COUNT(DISTINCT device) AS 人 FROM reports WHERE created_at > (strftime('%s','now') - 30 * 86400) * 1000 GROUP BY line ORDER BY 2 DESC LIMIT 10",
  "全体（30 日）":
    "SELECT (SELECT COUNT(*) FROM reports WHERE created_at > (strftime('%s','now') - 30 * 86400) * 1000) AS 報告, (SELECT COUNT(DISTINCT device) FROM reports WHERE created_at > (strftime('%s','now') - 30 * 86400) * 1000) AS 報告した人, (SELECT COUNT(DISTINCT device) FROM views) AS 見に来た人",
};

for (const [title, sql] of Object.entries(QUERIES)) {
  // シェルを通さず wrangler 本体を node で直接呼ぶ（SQL の引用符が Windows のシェルで崩れないように）
  const out = execFileSync(process.execPath, [WRANGLER, "d1", "execute", "suiteru-reports", "--remote", "--json", "--command", sql],
    { cwd: SERVER, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  console.log(`\n■ ${title}`);
  const rows = JSON.parse(out)[0].results;
  if (rows.length) console.table(rows); else console.log("（まだありません）");
}
