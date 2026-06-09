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
  /** リクエスト時に添付した入力画像のサムネ（再現用に縮小版を保持） */
  inputThumbs: string[];
  referenceThumbs: string[];
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
