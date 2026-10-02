# スマホアプリとしてのリリース計画

目標: App Store（iOS）と Google Play（Android）で「すいてるログ」を配布する。

## 方式: Capacitor（今の Web 版をそのままアプリに包む）

| 方式 | iOS | Android | 公開サーバ | 判定 |
|---|---|---|---|---|
| **Capacitor** | ○ | ○ | 不要（アプリ内に同梱） | **採用** |
| TWA / Bubblewrap | × | ○ | 必要 | Android だけなので不採用 |
| React Native / Flutter で作り直し | ○ | ○ | 不要 | 作り直しのコストに見合わない |

採用理由:
- 今の HTML/CSS/JS（`core.js` の集計ロジックとテスト含む）をほぼそのまま使える
- ファイルをアプリに同梱するのでオフラインで確実に動き、Web の公開を待たずに進められる
- 足りない所はネイティブ機能で補える（Web 版の限界だったところ）:
  - **定時通知**: Web では無理だったリマインドを、端末のローカル通知で出せる（.ics が不要になる）
  - **データ保全**: WebView の localStorage は OS に消されうるので、アプリでは端末の保存領域（Preferences）に保存
  - **App Store 審査 4.2（Web をそのまま包んだだけのアプリは却下されうる）**への対策にもなる

## 進め方（ROADMAP の Stage 14〜17）

| Stage | 内容 | 自分で進められるか |
|---|---|---|
| 14 アプリ化の土台 | Web ファイルを `www/` へ、Capacitor 導入、保存先の切り替え | ○ |
| 15 ネイティブ機能 | ローカル通知でのリマインド、記録時の振動 | ○（実機確認は 16 以降） |
| 16 ビルド | Android: APK を作って実機/エミュレータで確認。iOS: Xcode でビルド | **要対応**（下記） |
| 17 ストア準備 | プライバシーポリシー、掲載文、スクリーンショット、アイコン | 文面と素材は ○、掲載は **要対応** |

## ユーザーにお願いすること（私にはできない／やってはいけないもの）

1. **開発者アカウント**（作成と支払いは本人が行う必要がある）
   - Google Play Console: 登録料 25 ドル（1 回）
   - Apple Developer Program: 年 99 ドル（日本では 12,800 円/年）
2. **Android のビルド環境**: Android Studio（JDK 21 同梱）のインストール。約 1GB のダウンロードを伴うので、許可をもらってから行うか、ご自身で入れてもらう
3. **iOS のビルド**: Mac と Xcode が必須（Windows ではビルドできない）。Mac が無い場合はクラウドの Mac ビルド（例: Codemagic 等。アカウント作成が必要）
4. **プライバシーポリシーの URL**: 両ストアとも、データを集めないアプリでも掲載 URL が必須。→ 結局どこかに 1 ページ公開する必要がある（GitHub Pages 等）
5. **アプリ ID**（例: `app.suiteru.log`）: 一度ストアに出すと変更できない。仮の ID で進め、提出前に確定してもらう
6. **販売者名**: ストアに表示される開発者名（個人なら本名が表示されることがある）

## 現状メモ

- Capacitor 8.5（`@capacitor/core` `android` `ios`、CLI は devDependencies）。Web を直したら `npm run sync` でネイティブ側へコピー
- アプリ ID: `io.github.teanyq.suiteru`（2026-10-02 確定。所有する teanyq.github.io を逆にした形。Play への初回アップロードで固定）
- `npm audit` で moderate 3 件: すべて開発用 CLI が Xcode プロジェクト編集に使う `xcode` パッケージ由来で、アプリには含まれない。`audit fix --force` は破壊的変更になるので見送り、CLI の更新で解消されるのを待つ
- 2026-10-02: Android ビルド環境を導入（ユーザー承認のうえ Android Studio 2026.1.4.7、SDK Platform 36 / Build-Tools 36・35、Temurin JDK 21。Android SDK ライセンスに同意）。`assembleDebug` で app-debug.apk（4.1MB、app.suiteru.log、targetSdk 36、www 同梱）を確認
- 2026-10-02: エミュレータ（system-images;android-36;default;x86_64、WHPX 加速）で実動作を確認。保存は `shared_prefs/CapacitorStorage.xml` に入る。リマインドは設定時刻の約 1 分後に到着（正確アラームなしの想定どおり）。「止める」後に `getPending()` は配信済みの 1 件を返すが、OS のアラーム（`dumpsys alarm`）は 0 件で、プラグインが配信済み記録を残す仕様（ソースで確認）。ライセンスは Android SDK License のみに同意（一括同意で入った他 6 種の同意記録は削除済み）
- 2026-10-02: Google Play Console 登録済み（デベロッパー名 Amicha）。アップロード鍵 C:/keys/suiteru-upload.jks（CN=Amicha, C=JP, 10000日）をユーザーが作成、パスワードは keystore.properties（git 管理外）にユーザーが記入。署名つき app-release.aab（versionCode 1 / 1.0）の生成と署名検証済み
- 2026-10-02: パッケージ名を app.suiteru.log → io.github.teanyq.suiteru に変更（初回アップロード前）
