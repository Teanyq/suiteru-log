# すいてるログ

乗る前に「何号車が空いてるか」が分かる、通勤・通学向けのスマホアプリ（Android アプリ＋Web 版）。乗ったら混み具合をワンタップで報告し、自分の記録とみんなの匿名の報告から号車ごとの混み具合を推定する。

公開中: Web 版 https://teanyq.github.io/suiteru-log/ ／ Android 版は Google Play（審査中・テスト中）

- 登録不要。記録はその端末の中に保存する（アプリ版は Preferences、Web 版は localStorage）
- 「みんなと共有」をオンにしたときだけ、ランダムな番号と路線・方面・平日/休日・15 分枠・号車・混み具合（・任意の気分）を匿名で送る（[プライバシーポリシー](www/privacy.html)）。位置情報・名前・連絡先は扱わない
- オフラインでも開いて記録できる（報告は送信待ちに入れ、通信が戻ったら送る）

## できること

| 機能 | 内容 |
|---|---|
| 空いてる号車 | 「◯時ごろ・◯◯方面は ◯号車が空いてそう」。編成の図で号車ごとの混み具合（色＋混んでいる号車は斜線、★は報告の多さ）。報告が少ないうちは「端は空きやすい」などの一般的な傾向から推定 |
| 記録 | 号車（前回を記憶）と混み具合を 1 タップ。アプリの予想と自動で答え合わせ。記録後に気分スタンプ（任意） |
| 通知 | 平日の決めた時刻に、今日のおすすめ号車。通知のボタン（座れる／立つけど余裕／混んでる）からそのまま記録（Android） |
| みんなの報告 | 匿名の報告を集計（いたずら対策: 外れ値の保留・端末ごとの重み上限・回数制限）。この 30 分に同じ号車にいた人数、気分が集まった号車のあだ名、路線ごとの報告ランキング（自動ニックネーム） |
| 楽しみ | 労いの一言、ポイントと称号、今月の目標と季節のバッジ、今月のふりかえり、「あなたの報告が◯人の号車選びに使われた」 |
| v1 からの機能 | 空いている時間帯トップ 3、曜日×時間のヒートマップ、乗換メモ、遅延・雨・試験期間の印（集計から外す）、祝日は休日扱い、JSON バックアップ |

## ファイル構成

```
www/                    アプリ本体（Web 公開とスマホアプリ化で共通。Capacitor の webDir）
  index.html            画面（1 ページ）
  style.css             見た目（ライト/ダーク、混雑色は白文字 4.9:1 以上）
  app.js                画面の描画とイベント（DOM・保存はここだけ）
  core.js               純粋関数（集計・おすすめ・予想・検証など）
  store.js              保存先の切り替え（アプリ版は Preferences、Web 版は localStorage）
  sw.js                 Service Worker（network-first、3 秒でキャッシュに切替、オフライン対応）
  manifest.webmanifest  PWA 設定
  icon.svg, icon-*.png  アイコン（iOS 用 180px PNG を含む）
android/, ios/           Capacitor が生成したネイティブプロジェクト（www/ は `npm run sync` でコピーされる）
capacitor.config.json   アプリ ID（io.github.teanyq.suiteru）・アプリ名・webDir
core.test.mjs, store.test.mjs  www/core.js・www/store.js のテスト
server/                 Cloudflare Workers + D1 の報告 API（worker.mjs・api.mjs・schema.sql、api.test.mjs）
docs/                   仕様（SPEC-v2.md）・ロードマップ・改善ブレスト・公開手順・ストア掲載情報
```

## 動かす・テストする

```bash
python -m http.server 5180 --directory www
```

http://localhost:5180 を開く（ES modules と Service Worker のため file:// では動かない）。

```bash
npm test
```

Web 版の画面ファイルはビルド不要（依存なし）。アプリ化に Capacitor、サーバーに wrangler を使う（`npm install` / `cd server && npm install`）。サーバーのテストは `cd server && node --test api.test.mjs`。

## 利用状況を見る

```bash
npm run stats
```

直近 7 日の報告数・路線ごとの件数・報告した人数を表示する（本番 D1 を読むだけ。端末 ID は出さない。wrangler にログイン済みであること）。

## Android アプリをビルドする

必要なもの: Android SDK（Platform 36・Build-Tools 36）と **JDK 21**（Android Studio 同梱の JDK 25 では Gradle 8.14 が動かない）。

```bash
npm run sync
cd android && JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot" ./gradlew assembleDebug
```

できあがり: `android/app/build/outputs/apk/debug/app-debug.apk`（SDK の場所は `android/local.properties`。git 管理外）

## 路線・駅データ

`www/lines.json` は国土数値情報（鉄道データ N02、国土交通省、CC BY 4.0）の駅データから `node scripts/build-lines.mjs <N02-xx_Station.geojson>` で作る（596 路線・約 1 万駅）。路線名は正式名称（例: JR 山手線は品川〜新宿〜田端の区間のみ）。データ更新時は最新版をダウンロードして再生成する。

## データ形式

localStorage のキー `suiteru.v1`：

```json
{
  "routes":  [{ "id": "r1", "name": "田園都市線 渋谷方面", "line": { "c": "東急電鉄", "l": "田園都市線" }, "dir": "渋谷", "cars": 10, "lastCar": 9 }],
  "logs":    [{ "route": "r1", "t": "2026-10-01T07:42:00", "level": 4, "car": 9, "pred": 3, "mood": "sleepy", "tags": ["delay"] }],
  "memos":   [{ "route": "r1", "station": "渋谷", "text": "5号車3ドア" }],
  "current": "r1",
  "lastExport": "2026-10-01",
  "periodMode": false,
  "share": true,
  "device": "（ランダムな番号）",
  "outbox": []
}
```

- `t` はタイムゾーンなしのローカル時刻
- `tags` は `delay` / `rain` / `period`（試験・休暇）。付いた記録は集計に入らない
- バックアップ読み込み時は `core.js` の `parseBackup` で形を検証し、不正な行は捨てる

## 開発の進め方

`docs/ROADMAP.md` の未完了項目を `docs/CYCLE.md` の手順で 1 つずつ進めている。改善案は `docs/BRAINSTORM.md` に定期的にまとめている。v2（空いてる号車）の仕様は `docs/SPEC-v2.md`、最初の企画は `docs/SPEC.md`。
