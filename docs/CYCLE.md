# 開発サイクル（1 周 = 1 項目）

1. **選ぶ**: ROADMAP.md の未完了の先頭 1 項目（Stage 順を守る）
2. **相談**: 必要なら ai-orchestration-dashboard（localhost:3311）に設計・UX 観点を投げる
3. **実装**: 純粋ロジックは core.js に置き core.test.mjs にテストを足す
4. **検証**: `node --test` 緑 + ブラウザ（375px 幅）で実際に操作
5. **記録**: ROADMAP を [x]、sw.js の VERSION を上げ、コミット
6. 外部公開・課金・アカウント作成が絡む項目は**実装せず止めてユーザーに確認**
