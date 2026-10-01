# 公開手順書

**外部公開はユーザーの承認後にのみ行う。** 承認時に公開先（A / B）と公開範囲（リポジトリを公開してよいか）を確認する。

公開するのは `www/` フォルダだけ（静的ファイルのみ、ビルド不要）。

## A. GitHub Pages（おすすめ: 無料・HTTPS・`git push` だけで更新）

前提: `gh` CLI でログイン済み。GitHub Pages を無料で使うにはリポジトリが public である必要がある（＝ソースも公開される）。

GitHub Pages はリポジトリ直下か `docs/` しか直接公開できないので、`www/` は GitHub Actions で公開する。

1. `.github/workflows/pages.yml` を追加（`actions/upload-pages-artifact` の `path: www` → `actions/deploy-pages`）
2. 作成と push:
   ```bash
   gh repo create suiteru-log --public --source . --push
   ```
3. リポジトリの Settings → Pages → Source を「GitHub Actions」にする
- 公開 URL は `https://<owner>.github.io/suiteru-log/`（サブパス）。コード上は全て相対パス（`./`、`sw.js`、`manifest` の `start_url: "./"`。絶対パスがないことは grep で確認済み）なのでそのまま動く見込み。**サブパスでの実動作は未検証**なので、公開直後に下の「共通」チェックで確認する
- 反映まで 1〜2 分

## B. Render の静的サイト（ソースを非公開にしたい場合）

1. GitHub に **private** リポジトリを作って push
2. Render ダッシュボード → New → Static Site → リポジトリを選択
3. Build Command: 空 / Publish Directory: `www`
4. 公開 URL は `https://<name>.onrender.com/`（ルート直下）

## 公開 URL が決まったら（同じ日にやる）

1. `index.html` に追記して push:
   ```html
   <meta property="og:url" content="https://…/">
   <meta property="og:image" content="https://…/icon-512.png">
   ```
   （`twitter:card` は `summary` なので正方形アイコンで足りる。OGP 専用画像は不要）
2. 共有プレビューを確認: LINE / X に URL を貼ってタイトル・説明・アイコンが出るか
3. `docs/ROADMAP.md` の公開項目を [x] にする

## 実機チェックリスト

### iPhone（Safari）
- [ ] 開いて記録 → 再読み込みしても残っている
- [ ] 共有 → 「ホーム画面に追加」→ アイコンが電車の絵（ページの縮小画像ではない）
- [ ] ホーム画面から起動 → アドレスバーなしの全画面
- [ ] 機内モードで起動 → 画面が出て記録できる
- [ ] 「カレンダーに追加」→ カレンダーに平日繰り返しの予定が入り、時刻に通知が来る
- [ ] 「書き出す」→ ファイルに保存できる。「読み込む」で戻せる

### Android（Chrome）
- [ ] メニュー → 「アプリをインストール」が出る → アイコンが正しい
- [ ] 機内モードで起動・記録できる
- [ ] 「カレンダーに追加」で .ics を開くとカレンダーアプリに取り込める
- [ ] 書き出し / 読み込み

### 共通
- [ ] 公開 URL（サブパス含む）で開き、DevTools の Application で Service Worker が登録され、キャッシュに全ファイルがある
- [ ] 電波の弱い場所（地下・トンネル）で開いても 3 秒以内に画面が出る
- [ ] ダークモードで文字が読める

## 公開後の更新

ファイルを直して push するだけ（Service Worker は network-first なので、利用者は次に開いた時に最新になる。`sw.js` の VERSION を上げる必要はない）。
