# 開発サイクル（1 周 = 1 項目）

1. **選ぶ**: ROADMAP.md の未完了の先頭 1 項目（Stage 順を守る）
2. **相談**: 必要なら ai-orchestration-dashboard（localhost:3311）に設計・UX 観点を投げる
3. **実装**: 純粋ロジックは core.js に置き core.test.mjs にテストを足す
4. **検証**: `node --test` 緑 + ブラウザ（375px 幅）で実際に操作
5. **説明をそろえる**: 機能や送るデータが変わったら、ストア説明（docs/store/listing.md）・アプリ内の使い方と FAQ（www/index.html）・README・プライバシーポリシー（www/privacy.html）の 4 か所を確認する（2026-10-04、説明のずれが 3 件続いたため）
6. **記録**: ROADMAP を [x] にしてコミット（sw.js は network-first なので VERSION 更新は不要）
7. 外部公開・課金・アカウント作成が絡む項目は**実装せず止めてユーザーに確認**
