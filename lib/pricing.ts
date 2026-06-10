// モデル定義と料金（概算）。
// 価格は2026年時点の公開情報を基にした概算で、実際の請求とは異なる場合があります。
// API仕様変更に追従できるよう、モデルIDは環境変数で上書き可能。

export type Provider = "google" | "openai" | "replicate";

/** モデルが備える制御能力（ノードUIを駆動する） */
export interface ModelControls {
  identity?: boolean; // 同一性固定（顔1枚）
  control?: boolean; // ControlNet（ポーズ等）
  style?: boolean; // IP-Adapter（スタイル）
  controlTypes?: string[]; // 対応するcontrol種別（pose/depth/canny/lineart など）
}

export interface ModelDef {
  key: string;
  label: string;
  /** 実際にAPIへ渡すモデルID（replicateは "owner/name"） */
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
  /** OpenAI用: 出力解像度ティア */
  imageSizeTier?: "1k" | "2k";
  /** 制御生成ノードの能力記述子 */
  controls?: ModelControls;
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
    label: "GPT Image 1",
    id: "gpt-image-1",
    provider: "openai",
    quality: "medium",
    imageSizeTier: "1k",
    pricePerImage: 0.042,
    aspectRatios: ["1:1", "3:2", "2:3"],
    description: "OpenAI gpt-image-1。標準品質でコスト控えめ。",
  },
  "gpt-image-2": {
    key: "gpt-image-2",
    label: "GPT Image 2",
    id: "gpt-image-2",
    provider: "openai",
    quality: "high",
    imageSizeTier: "1k",
    pricePerImage: 0.19,
    aspectRatios: ["1:1", "3:2", "2:3"],
    description: "OpenAI gpt-image-2。最新・高品質。テキスト描画や編集に強い。",
  },
  "gpt-image-2-2k": {
    key: "gpt-image-2-2k",
    label: "GPT Image 2 (2K)",
    id: "gpt-image-2",
    provider: "openai",
    quality: "high",
    imageSizeTier: "2k",
    pricePerImage: 0.4,
    aspectRatios: ["1:1", "3:2", "2:3"],
    description: "OpenAI gpt-image-2 をネイティブ2K解像度で出力。高コスト。",
  },
  "instant-id": {
    key: "instant-id",
    label: "InstantID（人物固定）",
    id: process.env.REPLICATE_INSTANTID_MODEL || "zsxkib/instant-id",
    provider: "replicate",
    pricePerImage: 0.02,
    aspectRatios: ["1:1", "3:4", "4:3", "2:3", "3:2"],
    description:
      "Replicate InstantID。顔1枚で人物の同一性を固定し、ポーズ画像で姿勢を制御 (SDXL/1024)。",
    controls: { identity: true, control: true, style: false, controlTypes: ["pose"] },
  },
};

export const DEFAULT_MODEL_KEY = "nano-banana-2";

export function getModel(key: string): ModelDef {
  return MODELS[key] ?? MODELS[DEFAULT_MODEL_KEY];
}

/** Replicate(SDXL系)向けにアスペクト比を解像度へマッピング（8の倍数・約1Mpx） */
export function replicateSizeForAspect(aspect: string): { width: number; height: number } {
  switch (aspect) {
    case "3:4":
      return { width: 896, height: 1152 };
    case "4:3":
      return { width: 1152, height: 896 };
    case "2:3":
      return { width: 832, height: 1216 };
    case "3:2":
      return { width: 1216, height: 832 };
    default:
      return { width: 1024, height: 1024 };
  }
}

/** OpenAI 画像モデルのサイズへアスペクト比をマッピング（解像度ティア対応） */
export function openaiSizeForAspect(aspect: string, tier: "1k" | "2k" = "1k"): string {
  if (tier === "2k") {
    if (aspect === "3:2") return "2048x1360";
    if (aspect === "2:3") return "1360x2048";
    return "2048x2048";
  }
  if (aspect === "3:2") return "1536x1024";
  if (aspect === "2:3") return "1024x1536";
  return "1024x1024";
}
