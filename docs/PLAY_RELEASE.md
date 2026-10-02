# Google Play への提出手順

前提: Google Play Console の開発者登録（25 ドル、本人が行う）と、プライバシーポリシーの公開 URL。

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
| スクリーンショット | `docs/store/screenshots/android-*.png` |
| カテゴリ | 地図／ナビ |
| プライバシーポリシー | 公開した `privacy.html` の URL |
| アプリの署名 | Play App Signing を使う（既定）。アップロードするのは上で作った鍵で署名した AAB |

### データ セーフティ（データの取り扱いに関する申告）

コード・権限で確認済みの事実に基づく回答:

- ユーザーデータを収集または共有しますか → **いいえ**（記録は端末内のみ。インターネット権限なし、外部 SDK なし）
- したがって「データの暗号化」「削除リクエスト」の欄は該当なし

### コンテンツのレーティング

暴力・性的表現・ギャンブル・ユーザー間のやり取り・位置情報の共有・購入: すべて「いいえ」。

### ターゲット ユーザー

対象年齢は 13 歳以上を推奨（通学の学生を想定。13 歳未満を含めると「ファミリー」ポリシーの追加要件がかかる）。

## 4. リリースの順番（おすすめ）

1. **内部テスト**に AAB を上げ、自分の端末でインストールして動作確認
2. 新規の個人デベロッパーアカウントは、製品版の前に **クローズドテスト（12 人以上が 14 日間参加）** が必要な場合がある。Play Console の案内に従う
3. 製品版として公開
