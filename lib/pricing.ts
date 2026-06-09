// モデル定義と料金（概算）。
// 価格は2026年時点の公開情報を基にした概算で、実際の請求とは異なる場合があります。
// API仕様変更に追従できるよう、モデルIDは環境変数で上書き可能。

export interface ModelDef {
  key: string;
  label: string;
  /** 実際にAPIへ渡すモデルID */
  id: string;
  /** 1枚あたりの概算出力コスト(USD) */
  pricePerImage: number;
  /** 選択可能なアスペクト比 */
  aspectRatios: string[];
  description: string;
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
    pricePerImage: 0.039,
    aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"],
    description: "高速・低コスト。気軽な試行錯誤向け (Gemini 2.5 Flash Image)。",
  },
  "nano-banana-pro": {
    key: "nano-banana-pro",
    label: "Nano Banana Pro",
    id: NANO_BANANA_PRO_ID,
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
};

export const DEFAULT_MODEL_KEY = "nano-banana-2";

export function getModel(key: string): ModelDef {
  return MODELS[key] ?? MODELS[DEFAULT_MODEL_KEY];
}
