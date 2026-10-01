// network-first: オンラインなら常に最新を返し、キャッシュはオフライン用の控え。
// VERSION はキャッシュ名。ファイル変更のたびに上げる必要はない（キャッシュ形式を変える時だけ上げる）。
const VERSION = "v15";
const FILES = ["./", "index.html", "style.css", "app.js", "core.js", "manifest.webmanifest", "icon.svg"];
const SLOW_MS = 3000; // 電車内の弱い電波で待たせない上限

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // no-cache: ブラウザの HTTP キャッシュ（ホスティングの max-age 等）を素通りせず必ず再検証。変更なしなら 304 で軽い
  // navigate モードの Request には init を付けられないので URL で取る（静的ファイルなのでヘッダは不要）
  const network = fetch(req.url, { cache: "no-cache" });
  // 遅くて控えを返した場合も、取得し終えたらキャッシュを更新（clone は本文が読まれる前にここで取る）
  e.waitUntil(network.then((res) => {
    if (!res.ok) return;
    const copy = res.clone();
    return caches.open(VERSION).then((c) => c.put(req, copy));
  }).catch(() => {}));
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    try {
      if (!cached) return await network;
      return await Promise.race([network, new Promise((r) => setTimeout(() => r(cached), SLOW_MS))]);
    } catch {
      return cached || Response.error();
    }
  })());
});
