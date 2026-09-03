# CLAUDE.md

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

## Storyboard モードの処理の流れ

字コンテ（テキスト）から絵コンテ画像までの経路：

```
字コンテ入力
  ↓  /api/storyboard/parse （AI分解。APIキー無し/失敗時は lib/storyboard/parse.ts にフォールバック）
シーン + カット表
  ↓  ユーザーがカット表で編集（ト書き・アングル・ショットサイズ・構図・キャラ紐付け）
  ↓  /api/storyboard/assist （ト書きを英訳 + 実在人名を検出）
  ↓  lib/storyboard/prompt.ts （カメラ辞書 + スタイルプリセットでプロンプト組み立て）
  ↓  guard.ts assertPromptSafe() ← 実在人名が残っていればここで遮断
  ↓  /api/generate （直列キューで1カットずつ。キャラ参照画像を全カットに同梱）
カット画像
  ↓  lib/storyboard/sheet.ts （canvas で絵コンテシートに合成）
  ↓  lib/storyboard/pdf.ts
PDF / PNG 書き出し
```

`lib/storyboard/parse.ts` は DOM も DB も触らない純粋関数のみで構成されており、
テスト可能性のためにこの制約を保っている。**ここに副作用を持ち込まない。**

## よくある落とし穴

- `lib/storyboard/types.ts` の `CameraAngle` / `ShotSize` / `Composition` は
  型・日本語ラベル辞書（types.ts）・英語フレーズ辞書（prompt.ts）の**3箇所が対応**している。
  値を追加するときは3箇所すべてを更新する
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
