# O-Span

計算を解きながら文字の順番を覚える、ワーキングメモリの課題（Automated Operation Span）を、iPhone のホーム画面から 1 タップで始められるようにした個人用 PWA です。

- **Setup**: 最初に 1 回だけ、Math practice・Letters practice・Math + Letters practice を単独で行う。1 つ終わるたびに保存される
- **クイック**: Setup が済んだあと、練習なしで系列長 3〜7 の 5 セット（約 5 分、満点 25 点）。計算の制限時間は Setup で保存した値を使う
- **正式測定**: 文字練習 → 計算練習 → 複合練習 → 本番 15 試行（満点 75 点）。原著の手順どおり
- PC ではキーボードでも操作できます（Space / Enter で進む、T・F で True / False、想起は文字キー、Esc で Quit）
- 成績・制限時間は端末内（IndexedDB）にだけ保存します。設定から JSON で書き出し・読み込みができます
- 仕様の詳細は [SPEC.md](./SPEC.md)

## 開発

```sh
npm install
npm run dev      # 開発サーバー
npm test         # 単体テスト
npm run build    # 型チェック + ビルド（dist/）
```

課題のロジック（`src/core/`）は画面から独立していて、`npm test` で仕様どおりの動作を確認できます。

## 公開（GitHub Pages）

1. 公開リポジトリを作って push する（ブランチ名は `main`）
2. リポジトリの Settings → Pages → Source を **GitHub Actions** にする
3. push のたびに `.github/workflows/deploy.yml` がテスト・ビルド・公開を行う
4. iPhone の Safari で公開 URL を開き、共有メニューの「ホーム画面に追加」から追加する。以後はホーム画面のアイコン側を本体として使う（Safari とホーム画面でデータが別になるため）

## クレジット

- 課題: Unsworth, N., Heitz, R. P., Schrock, J. C., & Engle, R. W. (2005). An automated version of the operation span task. *Behavior Research Methods, 37*, 498–505.
- 参照実装: [PsyToolkit](https://www.psytoolkit.org/) の Automated Operation Span（Prof. Gijsbert Stoet）。非商用の研究・教育目的での利用が認められており、利用にあたって明記が求められています。この実装は PsyToolkit のコードを流用せず、公開されている仕様と挙動をもとに書き直したものです。非商用の個人利用です。
- 書体: [Lexend](https://github.com/googlefonts/lexend)（SIL Open Font License）
