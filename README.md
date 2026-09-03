# 🍌 Nano Banana Lab

画像生成モデル（Google Gemini "Nano Banana" 系 / OpenAI GPT Image / Replicate InstantID）を
実務ワークフローで試すための Next.js 製ローカルツール。

**3つのモード**があり、それぞれ別ページとして独立している。

| モード | パス | 用途 |
|---|---|---|
| **Lab** | `/` | 単発の生成実験。画像・プロンプトをライブラリ化して差分比較しながら試行錯誤する |
| **Flow** | `/flow` | ノードグラフで生成を連鎖させる。1つの出力を次の入力に繋いでパイプラインを組む |
| **Storyboard** | `/storyboard` | 字コンテ（テキスト台本）を解析してカット表に分解し、絵コンテ画像を一括生成する |

---

## セットアップ

```bash
npm install
npm run dev
```

http://localhost:3000 を開き、初回に表示されるモーダルで API キーを入力する。

### APIキーは BYO（Bring Your Own Key）

**このアプリはサーバー側に API キーを保持しない。** キーはユーザー各自が用意する。

- キーはブラウザの **localStorage にのみ**保存される（`lib/settings.ts`）
- 生成時にリクエストヘッダ `x-gemini-api-key` / `x-openai-api-key` / `x-replicate-api-key` で送信され、
  API ルートが各プロバイダへ中継するだけ。サーバーには永続化しない
- 「接続テスト」は課金の発生しないモデル一覧エンドポイントで検証する（`/api/validate-key`）

| プロバイダ | キー取得先 |
|---|---|
| Google Gemini | https://aistudio.google.com/apikey |
| OpenAI | https://platform.openai.com/api-keys |
| Replicate | https://replicate.com/account/api-tokens |

> **環境変数によるサーバー側キーは非推奨。**
> `GEMINI_API_KEY` 等を設定すると、キー未設定のユーザーに対するフォールバックとして使われる。
> 公開URLにデプロイする場合、認証もレート制限も無いため**第三者にキーを消費される**。
> ローカル専用か、Vercel の Deployment Protection を有効にした環境でのみ設定すること。
> `.env.local.example` を参照。

---

## アーキテクチャ

```
app/
  page.tsx              Lab モード本体（単一ファイル・約1,350行）
  flow/page.tsx         Flow モード（FlowEditor を SSR 無効で動的import）
  storyboard/page.tsx   Storyboard モード（同上）
  api/
    generate/           全プロバイダの生成を受ける単一エンドポイント
    validate-key/       キー疎通確認（無課金エンドポイントを叩くだけ）
    storyboard/
      parse/            字コンテ → シーン+カット表 への AI 構造化
      assist/           ト書きの英訳 / キャラ記述の英訳 / 実在人名検出
      style/            トーン参照画像 → 英語スタイル記述への言語化

lib/
  pricing.ts            モデル定義の唯一の真実（ID・単価・対応アスペクト比・provider）
  generation.ts         生成リクエストの送信パイプライン（ペイロード上限対応）
  settings.ts           APIキーの localStorage 入出力
  db.ts                 IndexedDB ラッパー（画像はここに永続化）
  image.ts              リサイズ・圧縮・data URL 変換
  contactSheet.ts       複数画像を1枚のグリッドに合成
  diff.ts               文字単位差分（LCSベース。日本語対応）
  flow/                 ノードグラフの型・実行エンジン・保存
  storyboard/
    types.ts            カット/シーン/キャラシートの型とラベル辞書
    parse.ts            記法ベースのオフラインパーサー（AI分解のフォールバック）
    prompt.ts           プロンプト組み立て（カメラ辞書 + スタイルプリセット）
    guard.ts            実在人名ガード（API送信直前の最終ゲート）
    sheet.ts            絵コンテシートの canvas 合成
    pdf.ts              依存ライブラリなしの最小PDF生成
```

### 設計上の前提

- **サーバーはステートレス**。永続データはすべてブラウザ側（IndexedDB / localStorage）にある。
  DBもユーザーアカウントも存在しない
- **API ルートは薄い中継層**。キーをヘッダから受け取り、各プロバイダへ投げ、レスポンスを正規化して返すだけ
- **Vercel のリクエストボディ上限（約4.5MB）が制約になる**。`lib/generation.ts` の `fitUnderLimit()` が
  画像を「原本のまま送る」を基本としつつ、上限超過時のみ段階的に縮小する
- **Storyboard の実在人名ガード**。生成プロンプトに実在の人名やIP語が残っていると
  `assertPromptSafe()` が例外で送信を遮断する（`lib/storyboard/guard.ts`）

---

## 開発コマンド

```bash
npm run dev      # 開発サーバー
npm run build    # 本番ビルド
npm test         # vitest（storyboard のパーサー・ガードの単体テスト）
npx tsc --noEmit # 型チェック
```

## モデル定義のカスタマイズ

モデルID・概算単価・対応アスペクト比は [`lib/pricing.ts`](lib/pricing.ts) に集約されている。
プロバイダ側の仕様変更に追従する場合はここを編集するか、環境変数で上書きする。

```bash
NANO_BANANA_2_MODEL_ID=gemini-2.5-flash-image
NANO_BANANA_PRO_MODEL_ID=gemini-3-pro-image-preview
```

> ⚠️ 画面に出るコストは公開情報を基にした**概算**。実際の請求額は各プロバイダの明細を確認すること。

## 技術スタック

Next.js 15 (App Router) / React 19 / TypeScript / Tailwind CSS v4 / @google/genai / @xyflow/react / JSZip / Vitest

---

## コントリビュート

改変・PR歓迎。実装に入る前に [CLAUDE.md](CLAUDE.md) を読むこと。
コーディング規約（日本語コメント、状態管理ライブラリを入れない、依存を増やさない）と、
壊してはいけない不変条件（APIキーをサーバーに保存しない、実在人名ガードを迂回しない等）を
まとめてあり、AIコーディングエージェントを使う場合はそのままコンテキストとして機能する。

PRを出す前に以下を通すこと。

```bash
npx tsc --noEmit
npm test
```

## ライセンス

[MIT](LICENSE) © ynsk00
