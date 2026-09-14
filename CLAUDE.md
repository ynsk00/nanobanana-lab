# CLAUDE.md

> Claude Code をはじめとするコーディングエージェント向けの規約集。人間の
> コントリビューターが読んでも有用な内容なので、PR前に一読を推奨する。

このリポジトリで作業する Claude Code 向けのガイド。全体像は [README.md](README.md) を先に読むこと。

## 何をするアプリか

画像生成モデル（Gemini / OpenAI / Replicate）を試すための Next.js ローカルツール。
**サーバーはステートレスで、DBもユーザーアカウントも存在しない。**
永続データはすべてブラウザ側（IndexedDB = 画像、localStorage = APIキーと設定）にある。

3つの独立したモードがある。作業前にどのモードの話かを必ず特定すること。

- **Lab** (`app/page.tsx`) — 単発の生成実験
- **Flow** (`components/flow/`) — ノードグラフで生成を連鎖
- **Storyboard** (`components/storyboard/` + `lib/storyboard/`) — 字コンテ→絵コンテ生成

## コマンド

```bash
npm run dev       # 開発サーバー (localhost:3000)
npm test          # vitest（storyboard のパーサー・ガードのみ）
npx tsc --noEmit  # 型チェック
npm run build     # 本番ビルド
```

**変更後は必ず `npx tsc --noEmit` と `npm test` の両方を通すこと。**
`npm run lint` は package.json に定義されているが ESLint の設定も依存も入っていないため実際には動かない。

## コードの約束

- **コメント・UI文言・コミットメッセージはすべて日本語。** 英語で書かない。
  ただしモデルへ送る生成プロンプトは英語（`lib/storyboard/prompt.ts` の辞書群）
- **状態管理ライブラリを入れない。** React の `useState` / `useReducer` と Context のみ。
  Redux・Zustand・Jotai 等を提案しない
- **依存を増やさない。** 既存の依存で解けるかをまず検討する。
  例: PDF生成は外部ライブラリを使わず `lib/storyboard/pdf.ts` で自前実装している
- ファイル冒頭に「このファイルが何を担うか」の日本語コメントを置く既存の慣習に従う
- スタイルは Tailwind のユーティリティクラスのみ。CSS Modules や styled-components は使わない

## 触る前に知っておくべき不変条件

### 1. APIキーは絶対にサーバーに保存しない

キーは localStorage → リクエストヘッダ（`x-gemini-api-key` 等）→ API ルート → プロバイダ、
という経路のみ。ログ出力・エラーメッセージ・レスポンスにキーを含めてはいけない。
環境変数フォールバックは存在するが**非推奨**で、公開デプロイでは設定しない前提。

### 2. リクエストボディは約4.5MB上限（Vercel サーバーレス関数）

画像は data URL（base64文字列）として JSON ボディに載る。
`lib/generation.ts` の `fitUnderLimit()` が上限判定と段階的縮小を担う。
**生成リクエストに画像を追加する変更をするときは、必ずこの関数を経由させること。**

### 3. モデル定義は `lib/pricing.ts` が唯一の真実

モデルID・単価・対応アスペクト比・provider はすべてここ。
UIやAPIルートにモデルIDをハードコードしない。追加時は `MODELS` に1エントリ足すだけで
UI・料金計算・アスペクト比選択がすべて追従する設計を壊さないこと。

### 4. Storyboard の実在人名ガードを迂回しない

`lib/storyboard/guard.ts` の `assertPromptSafe()` は、実在の人名やIP語が
生成プロンプトに残ったまま API へ送られるのを防ぐ最終ゲート。
`components/storyboard/StoryboardEditor.tsx` にある3つの送信経路
（カット生成 / キャラシート生成 / 顔写真からの立ち姿生成）は、いずれも
プロンプト組み立て直後に `assertPromptSafe()` を呼んでいる。
**新しい生成経路を追加する場合も必ずガードを通すこと。** テストは `lib/storyboard/__tests__/guard.test.ts`。

### 5. クライアント専用画面は SSR を無効化する

Flow と Storyboard は IndexedDB / canvas / React Flow に依存するため、
`next/dynamic` の `ssr: false` で読み込んでいる。この構造を変えない。

### 6. 生成プロンプトは「段落構造の自然文」で書く

`lib/storyboard/prompt.ts` の `buildCutPrompt` は Shot / Action / Characters / Setting /
Notes / Style / Constraints の段落を空行で区切った英語の自然文を出力する。
Gemini / GPT Image はキーワード列挙より場面描写のほうが良く反応し、ネガティブプロンプト機構も
無いため、**`masterpiece, best quality` のようなタグ列や `avoid: extra fingers` のような
否定タグを足さないこと。** 避けたい要素は `Do not include: …` の1文にする。
プロンプトに要素を足すときは、既存の段落のどこに属するかを決め、完結した文として追加する。

### 7. モデル定義に解像度を足すときは `imageSizes` / `pricePerImageBySize` を使う

Gemini の `imageSize`（1K/2K/4K）は `lib/pricing.ts` の `imageSizes` を持つモデルにのみ
UI が出て、API ルートも `model.imageSizes.includes()` を通った値しか送らない。
単価は `priceForImage(model, imageSize)` で引く。

### 8. 生成後のAIチェックは generateOne の中で完結させ、自動リトライは1回まで

`StoryboardEditor.tsx` の `generateOne` は `doGenerateOnce` → `runQaCheck` → 判定 → 必要なら
`isRetry: true` で自身を1回だけ再帰、という構造。`runQueue` の直列 for ループはこれを
await するだけなので、キューの直列性はここで担保されている。
- `isRetry` の打ち切りを外さない（無限ループになる）
- QA の失敗（401・ネットワーク・JSON不正）は生成の失敗にしない。`cut.qa` を未設定のまま
  `console.warn` に留める
- QA へ送るのは生成画像のサムネ・キャラ参照のサムネ・key・記述文のみ。**表示名（displayName）
  や送信プロンプトは送らない**
- 判定ロジック `qaVerdict` は `lib/storyboard/qa.ts` の純粋関数。閾値を変えるときは
  `qa.test.ts` の境界値テストも更新する

### 9. 生成リクエストの入力画像の順序は [スケッチ, 修正対象の直前画像] で固定

`doGenerateOnce` は `cut.sketchAssetId` があればスケッチを `@in1`、修正指示（editNote /
QA の revisionHint）があれば直前の生成画像をその次に積む。プロンプト側の `sketchInputIndex` /
`revisionInputIndex` はアセットの実ロード結果で上書きされる（`cutPromptOptions` の値は見積もり）。
Layout 段落は Shot 段落の直後、Revision 段落は `apply to input image @inN` と対象を明示する。
入力画像を増やす変更をするときは、この順序と両インデックスの整合を保つこと。

## Storyboard モードの処理の流れ

字コンテ（テキスト）から絵コンテ画像までの経路：

```
字コンテ入力
  ↓  /api/storyboard/parse （AI分解。APIキー無し/失敗時は lib/storyboard/parse.ts にフォールバック）
シーン + カット表
  ↓  ユーザーがカット表で編集（ト書き・アングル・ショットサイズ・構図・照明・レンズ・キャラ紐付け）
  ↓  任意: 手書きスケッチを各カットに登録（レイアウト参照。生成時は入力画像 @in1 として送る）
  ↓  /api/storyboard/assist （ト書きを英訳 + 実在人名を検出）
  ↓  lib/storyboard/prompt.ts （cutPromptOptions → buildCutPrompt。右パネルの「送信プロンプト」も同じ経路で事前表示）
  ↓  guard.ts assertPromptSafe() ← 実在人名が残っていればここで遮断
  ↓  /api/generate （直列キューで1カットずつ。キャラ参照画像を全カットに同梱）
カット画像
  ↓  /api/storyboard/qa （視覚モデルで自己採点: 文字混入 / ト書き一致 / キャラ一致 / スタイル）
  ↓  lib/storyboard/qa.ts qaVerdict() → "retry" なら generateOne 内で1回だけ自動再生成
  ↓  lib/storyboard/sheet.ts （canvas で絵コンテシートに合成）
  ↓  lib/storyboard/pdf.ts
PDF / PNG 書き出し
```

`lib/storyboard/parse.ts` は DOM も DB も触らない純粋関数のみで構成されており、
テスト可能性のためにこの制約を保っている。**ここに副作用を持ち込まない。**

## よくある落とし穴

- `lib/storyboard/types.ts` の `CameraAngle` / `ShotSize` / `Composition` / `Lighting` / `Lens` は
  型・日本語ラベル辞書（types.ts）・英語フレーズ辞書（prompt.ts）の**3箇所が対応**している。
  値を追加するときは3箇所すべてを更新する。英語フレーズは「文の中に収まる形」で書く
  （例: `"from a high angle looking down"`）
- `app/page.tsx` は1,350行の単一ファイル。分割の誘惑があるが、
  依頼されていない限りリファクタリングしない
- 生成結果は IndexedDB にあるためサーバー側から検証できない。
  動作確認は開発サーバーを立ててブラウザで行う

## 公開リポジトリである

このリポジトリは公開されている。以下をコミットしないこと。

- APIキー、トークン、`.env.local`
- 実案件のクライアント名・ブランド名・実在人名を含む字コンテやテスト fixture
  （テストデータは架空の題材で書く）
- `.vercel/` 配下（`.gitignore` 済み）
