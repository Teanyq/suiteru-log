# すいてるログ

通勤・通学の電車の混み具合をワンタップで記録し、自分の路線で空いている時間帯を見つけるスマホ向け Web アプリ（PWA）。

- 登録不要。データはその端末のブラウザ内（localStorage）だけに保存し、サーバには送らない
- オフラインで動く。ホーム画面に追加してアプリとして使える
- ビルド不要・依存ゼロの素の HTML/CSS/JS

## できること

| 機能 | 内容 |
|---|---|
| 記録 | 混雑度 1〜5 をワンタップ。時刻は今（-5/-10/-15 分・手入力で修正可） |
| 今日のおすすめ | 曜日×15 分枠の平均から、空いている時間帯トップ 3 と「いつもより何ポイント空いているか」 |
| 混雑予想 | 選んだ時刻の枠の平均（同じ曜日→平日/休日全体の順。足りなければ残り回数を表示） |
| ヒートマップ | 曜日×時間の平均混雑 |
| 精度 | 遅延・雨の印、試験・休暇モードの記録は集計外。集計は直近 90 日のみ |
| 続ける工夫 | 平日連続記録、時間帯での路線自動選択、カレンダー(.ics)リマインド |
| その他 | 乗換メモ（駅×号車・ドア）、JSON バックアップ（書き出し/読み込み） |

## ファイル構成

```
www/                    アプリ本体（Web 公開とスマホアプリ化で共通。Capacitor の webDir）
  index.html            画面（1 ページ）
  style.css             見た目（ライト/ダーク、混雑色は白文字 4.9:1 以上）
  app.js                画面の描画とイベント（DOM・保存はここだけ）
  core.js               純粋関数（集計・おすすめ・予想・検証など）
  sw.js                 Service Worker（network-first、3 秒でキャッシュに切替、オフライン対応）
  manifest.webmanifest  PWA 設定
  icon.svg, icon-*.png  アイコン（iOS 用 180px PNG を含む）
android/, ios/           Capacitor が生成したネイティブプロジェクト（www/ は `npm run sync` でコピーされる）
capacitor.config.json   アプリ ID（仮: app.suiteru.log）・アプリ名・webDir
core.test.mjs           www/core.js のテスト
docs/                   仕様・ロードマップ・開発サイクル・公開手順・アプリ化計画
```

## 動かす・テストする

```bash
python -m http.server 5180 --directory www
```

http://localhost:5180 を開く（ES modules と Service Worker のため file:// では動かない）。

```bash
npm test
```

依存パッケージはないので `npm install` は不要（`node --test` を使うので Node.js 20 以上が目安。v24 で確認済み）。

## Android アプリをビルドする

必要なもの: Android SDK（Platform 36・Build-Tools 36）と **JDK 21**（Android Studio 同梱の JDK 25 では Gradle 8.14 が動かない）。

```bash
npm run sync
cd android && JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot" ./gradlew assembleDebug
```

できあがり: `android/app/build/outputs/apk/debug/app-debug.apk`（SDK の場所は `android/local.properties`。git 管理外）

## データ形式

localStorage のキー `suiteru.v1`：

```json
{
  "routes":  [{ "id": "r1", "name": "田園都市線 上り" }],
  "logs":    [{ "route": "r1", "t": "2026-10-01T07:42:00", "level": 4, "tags": ["delay"] }],
  "memos":   [{ "route": "r1", "station": "渋谷", "text": "5号車3ドア" }],
  "current": "r1",
  "lastExport": "2026-10-01",
  "periodMode": false
}
```

- `t` はタイムゾーンなしのローカル時刻
- `tags` は `delay` / `rain` / `period`（試験・休暇）。付いた記録は集計に入らない
- バックアップ読み込み時は `core.js` の `parseBackup` で形を検証し、不正な行は捨てる

## 開発の進め方

`docs/ROADMAP.md` の未完了項目を `docs/CYCLE.md` の手順で 1 つずつ進めている。最初の企画は `docs/SPEC.md`（MVP 時点の仕様）。
