// アプリ全体で共有する型定義

/** ライブラリに保存される画像（入力 / リファレンス / 生成結果のいずれも同形） */
export interface ImageItem {
  id: string;
  /** data URL 形式 (data:image/png;base64,....) */
  dataUrl: string;
  mimeType: string;
  name: string;
  /** 由来。手動アップロードか、生成結果からの取り込みか */
  origin: "upload" | "generated";
  createdAt: number;
}

/** 画像の役割 */
export type Role = "input" | "reference";

/** バッチが使用した画像（履歴・再編集用） */
export interface UsedImage {
  /** 生成時のプール画像ID（再編集時にプールに残っていれば再利用） */
  id: string;
  /** 送信した圧縮版のスナップショット（プールから消えていてもこれで復元） */
  dataUrl: string;
  mimeType: string;
  name: string;
  role: Role;
}

/** 保存済みプロンプト */
export interface PromptItem {
  id: string;
  text: string;
  name: string;
  createdAt: number;
}

/** 生成結果1枚 */
export interface ResultImage {
  id: string;
  dataUrl: string;
  mimeType: string;
  /** モデルが返したテキスト（ある場合） */
  note?: string;
}

/** 1回の「生成」= 1バッチ */
export interface Batch {
  id: string;
  createdAt: number;
  modelKey: string;
  modelLabel: string;
  modelId: string;
  aspectRatio: string;
  requestedCount: number;
  prompt: string;
  /** リクエスト時に使用した画像（役割付き）。履歴・再編集に使う */
  usedImages: UsedImage[];
  /** @deprecated 旧バージョン互換（読み込み時のフォールバック用） */
  inputThumbs?: string[];
  /** @deprecated 旧バージョン互換 */
  referenceThumbs?: string[];
  results: ResultImage[];
  /** 概算コスト(USD) */
  costUsd: number;
  /** サーバー側で計測した所要時間(ms) */
  durationMs: number;
  /** エラー（部分的失敗を含む） */
  errors: string[];
}

/** /api/generate のレスポンス */
export interface GenerateResponse {
  results: ResultImage[];
  costUsd: number;
  durationMs: number;
  errors: string[];
}
