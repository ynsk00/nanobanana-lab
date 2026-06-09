// モデル定義と料金（概算）。
// 価格は2026年時点の公開情報を基にした概算で、実際の請求とは異なる場合があります。
// API仕様変更に追従できるよう、モデルIDは環境変数で上書き可能。

export type Provider = "google" | "openai";

export interface ModelDef {
  key: string;
  label: string;
  /** 実際にAPIへ渡すモデルID */
  id: string;
  /** どのAPIプロバイダか */
  provider: Provider;
  /** 1枚あたりの概算出力コスト(USD) */
  pricePerImage: number;
  /** 選択可能なアスペクト比 */
  aspectRatios: string[];
  description: string;
  /** OpenAI用: 品質 (low/medium/high/auto) */
  quality?: string;
}

const NANO_BANANA_2_ID =
  process.env.NANO_BANANA_2_MODEL_ID || "gemini-2.5-flash-image";
const NANO_BANANA_PRO_ID =
  process.env.NANO_BANANA_PRO_MODEL_ID || "gemini-3-pro-image-preview";

export const MODELS: Record<string, ModelDef> = {
  "nano-banana-2": {
    key: "nano-banana-2",
    label: "Nano Banana 2",
    id: NANO_BANANA_2_ID,
    provider: "google",
    pricePerImage: 0.039,
    aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"],
    description: "高速・低コスト。気軽な試行錯誤向け (Gemini 2.5 Flash Image)。",
  },
  "nano-banana-pro": {
    key: "nano-banana-pro",
    label: "Nano Banana Pro",
    id: NANO_BANANA_PRO_ID,
    provider: "google",
    pricePerImage: 0.134,
    aspectRatios: [
      "1:1",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9",
    ],
    description: "高品質・高解像度。仕上げや複雑な指示向け (Gemini 3 Pro Image)。",
  },
  "gpt-image-1": {
    key: "gpt-image-1",
    label: "GPT Image (標準)",
    id: "gpt-image-1",
    provider: "openai",
    quality: "medium",
    pricePerImage: 0.042,
    aspectRatios: ["1:1", "3:2", "2:3"],
    description: "OpenAI gpt-image-1。標準品質でコスト控えめ。",
  },
  "gpt-image-1-high": {
    key: "gpt-image-1-high",
    label: "GPT Image (高品質)",
    id: "gpt-image-1",
    provider: "openai",
    quality: "high",
    pricePerImage: 0.167,
    aspectRatios: ["1:1", "3:2", "2:3"],
    description: "OpenAI gpt-image-1。高品質・高コスト。",
  },
};

export const DEFAULT_MODEL_KEY = "nano-banana-2";

export function getModel(key: string): ModelDef {
  return MODELS[key] ?? MODELS[DEFAULT_MODEL_KEY];
}

/** OpenAI gpt-image-1 のサイズへアスペクト比をマッピング */
export function openaiSizeForAspect(aspect: string): string {
  if (aspect === "3:2") return "1536x1024";
  if (aspect === "2:3") return "1024x1536";
  return "1024x1024";
}
