# Google Play への提出手順

前提: Google Play Console の開発者登録（25 ドル、本人が行う）。プライバシーポリシーは公開済み（下表）。

## 1. 署名鍵（アップロード鍵）を作る ― 最初の 1 回だけ、本人が行う

この鍵とパスワードを失うと、アプリを更新できなくなる（Play App Signing を使えば鍵の再発行は申請できるが手間がかかる）。**パスワードは自分で決め、鍵ファイルと一緒に安全な場所（パスワードマネージャー等）へ控える。**

```bash
"C:/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot/bin/keytool" -genkeypair -keystore C:/keys/suiteru-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

聞かれたパスワード・名前等を入力する。`C:/keys/` はリポジトリの外にする。

次に `android/keystore.properties` を作る（git 管理外。コミットされないことは確認済み）:

```
storeFile=C:/keys/suiteru-upload.jks
storePassword=（決めたパスワード）
keyAlias=upload
keyPassword=（決めたパスワード）
```

## 2. リリース版（AAB）を作る

```bash
npm test
npm run sync
cd android && JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot" ./gradlew bundleRelease
```

できあがり: `android/app/build/outputs/bundle/release/app-release.aab`（keystore.properties があれば署名つき）。

更新のたびに `android/app/build.gradle` の `versionCode` を 1 つ上げ、`versionName` を変える（同じ versionCode は Play に再アップロードできない）。

## 3. Play Console での入力

| 項目 | 入力内容 |
|---|---|
| アプリ名・説明 | `docs/store/listing.md` |
| アイコン 512px | `www/icon-512.png` |
| フィーチャーグラフィック | `docs/store/feature-graphic.png` |
| スクリーンショット | `docs/store/screenshots/play-1〜3.png`（見出しつき。元の画面は android-*.png） |
| カテゴリ | 地図／ナビ |
| プライバシーポリシー | https://teanyq.github.io/suiteru-log/privacy.html |
| アプリの署名 | Play App Signing を使う（既定）。アップロードするのは上で作った鍵で署名した AAB |

### データ セーフティ（データの取り扱いに関する申告）

コード・権限で確認済みの事実に基づく回答:

1.3 以降（「みんなと共有」あり）。外部 SDK なし、端末 ID・広告 ID は使わない。位置情報（1.12 以降・任意・フォアグラウンドのみ）は端末の中で近くの駅を探すだけで送信しないので「収集」に当たらない（Google の定義: 端末の外に送るものが収集）。ただし権限を使うので、データ セーフティの位置情報の欄は「収集しない」、アプリのアクセス権の説明はプライバシーポリシー 4 章:

- ユーザーデータを収集または共有しますか → **はい（収集する）**。第三者との「共有」は **なし**
- 収集するデータの種類 → **アプリのアクティビティ ＞ その他のユーザー作成コンテンツ**（号車・混雑度の報告）。路線・方面・時間帯もこの報告の一部
  - 収集は任意か → **任意**（アプリ内で共有をオン/オフできる。既定は聞いてから）
  - 目的 → **アプリの機能**（号車ごとの混雑の集計表示）
  - 一時的な処理か → いいえ（120 日間集計に使う）
  - 遅延の印の報告（路線・方面・遅延であること）も同じ「その他のユーザー作成コンテンツ」。直近 30 分の人数にだけ使い、1 日で消去
- **アプリのアクティビティ ＞ アプリの操作**（集計を見に来た記録。「◯人の役に立った」の計算用、30 日で消去）: 任意・アプリの機能・共有なし
- データは転送時に暗号化されますか → **はい**（HTTPS のみ）
- データの削除をリクエストできますか → **はい**（プライバシーポリシーの連絡先へ。アプリの「データ」欄に出る共有番号＝端末のランダム番号の先頭 8 文字で特定し、`DELETE FROM reports WHERE device LIKE '<番号>%'`）
- 端末 ID について: アプリが作るランダムな番号はアプリ内でのみ使い、ほかのアプリやサービスと結びつかないため「デバイスまたはその他の ID」には該当しない

### コンテンツのレーティング

暴力・性的表現・ギャンブル・ユーザー間のやり取り・位置情報の共有・購入: すべて「いいえ」。

### ターゲット ユーザー

対象年齢は 13 歳以上を推奨（通学の学生を想定。13 歳未満を含めると「ファミリー」ポリシーの追加要件がかかる）。

## 4. リリースの順番（おすすめ）

1. **内部テスト**に AAB を上げ、自分の端末でインストールして動作確認
2. 新規の個人デベロッパーアカウントは、製品版の前に **クローズドテスト（12 人以上が 14 日間参加）** が必要な場合がある。Play Console の案内に従う
3. 製品版として公開

## メモ: 対応端末が減った警告（1.12, 2026-10-04）

位置情報の権限（ACCESS_FINE_LOCATION）を足すと、Android は「GPS が必須」とみなし、GPS のない端末が対象外になる（Play Console で「6 台のデバイスがサポートされなくなりました」）。
位置情報は任意の機能なので、AndroidManifest.xml で `android.hardware.location*` を `required="false"` にして解消（versionCode 14）。権限を足すときは、同じように「その機能がない端末を外していないか」を確認する。
