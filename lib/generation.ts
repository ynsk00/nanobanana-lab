// 生成リクエストのパイプライン（画像のサイズ調整・送信）を一元管理するモジュール。
// 画像は「原本のまま送る」を基本とし、ボディ上限を超える場合のみ段階的に縮小する。

import { compressForUpload } from "@/lib/image";
import type { GenerateResponse, ImageItem } from "@/lib/types";

// Vercelサーバーレス関数のリクエストボディ上限(約4.5MB)に対する安全マージン。
// data URL は base64 文字列としてそのまま送られるため、文字数(≈バイト)で見積もる。
export const MAX_UPLOAD_BYTES = 4_200_000;

// 上限超過時の段階的縮小（高品質→低品質。原本に近い順に試す）
const UPLOAD_STEPS: [number, number][] = [
  [3072, 0.95],
  [2560, 0.92],
  [2048, 0.9],
  [1600, 0.86],
  [1280, 0.82],
];

/** 送信される文字数(≈バイト)の合計 */
export function payloadLen(arr: string[]): number {
  return arr.reduce((s, d) => s + d.length, 0);
}

/** ImageItem 配列を控えめに圧縮した data URL 配列にする（履歴スナップショット用） */
export function compressList(items: ImageItem[], maxSize?: number, quality?: number) {
  return Promise.all(items.map((x) => compressForUpload(x.dataUrl, maxSize, quality)));
}

/**
 * まず原本のまま送れるか判定し、上限を超える場合のみ必要最小限だけ縮小する。
 * 高品質側から順に試し、最初に上限内に収まった版を返す。
 */
export async function fitUnderLimit(
  inputs: string[],
  refs: string[],
  limit: number = MAX_UPLOAD_BYTES
): Promise<{ inputs: string[]; refs: string[]; downscaled: boolean }> {
  if (payloadLen(inputs) + payloadLen(refs) <= limit) {
    return { inputs, refs, downscaled: false };
  }
  let best = { inputs, refs, downscaled: true };
  for (const [maxSize, q] of UPLOAD_STEPS) {
    const ci = await Promise.all(inputs.map((d) => compressForUpload(d, maxSize, q)));
    const cr = await Promise.all(refs.map((d) => compressForUpload(d, maxSize, q)));
    best = { inputs: ci, refs: cr, downscaled: true };
    if (payloadLen(ci) + payloadLen(cr) <= limit) return best;
  }
  return best; // 最小版でも超える場合はそのまま返し、呼び出し側で判定
}

/** ControlNet / IP-Adapter / 同一性 等の制御パラメータ（任意。google/openaiは無視） */
export interface ControlParams {
  controlType?: "pose" | "depth" | "canny" | "lineart" | "seg" | "none";
  controlImage?: string; // data URL（ポーズ等の制御画像）
  controlStrength?: number; // 0..1
  identityImage?: string; // data URL（固定したい顔）
  identityStrength?: number; // 0..1
  styleImage?: string; // data URL（IP-Adapterスタイル参照）
  styleStrength?: number; // 0..1
  steps?: number;
  seed?: number | null; // null/undefined => ランダム
  guidanceScale?: number;
  baseModel?: string;
}

export interface GenerateParams {
  geminiKey?: string;
  openaiKey?: string;
  replicateKey?: string;
  modelKey: string;
  aspectRatio: string;
  count: number;
  prompt: string;
  controls?: ControlParams;
}

/** 制御画像は検出品質を守るため強圧縮しない（下限~1280px） */
async function fitControls(c?: ControlParams): Promise<ControlParams | undefined> {
  if (!c) return undefined;
  const gentle = (d?: string) => (d ? compressForUpload(d, 1280, 0.88) : Promise.resolve(d));
  const [controlImage, identityImage, styleImage] = await Promise.all([
    gentle(c.controlImage),
    gentle(c.identityImage),
    gentle(c.styleImage),
  ]);
  return { ...c, controlImage, identityImage, styleImage };
}

function controlsBytes(c?: ControlParams): number {
  if (!c) return 0;
  return [c.controlImage, c.identityImage, c.styleImage].reduce(
    (s, d) => s + (d ? d.length : 0),
    0
  );
}

/**
 * 入力画像群・参照画像群を受け取り、1リクエスト分を送信する。
 * - 原本を優先し、上限超過時のみ段階縮小
 * - サーバーが実際に添付した入力/参照枚数(sentInputCount/sentReferenceCount)を返す
 */
export async function requestGeneration(
  params: GenerateParams,
  inputDataUrls: string[],
  referenceDataUrls: string[]
): Promise<GenerateResponse> {
  const controls = await fitControls(params.controls);
  const ctrlBytes = controlsBytes(controls);
  const fitted = await fitUnderLimit(inputDataUrls, referenceDataUrls, MAX_UPLOAD_BYTES - ctrlBytes);
  const bodyLen = payloadLen(fitted.inputs) + payloadLen(fitted.refs) + ctrlBytes;
  if (bodyLen > MAX_UPLOAD_BYTES) {
    throw new Error(
      `画像の合計サイズが大きすぎます(約${(bodyLen / 1_000_000).toFixed(1)}MB)。枚数を減らすか、より小さい画像を使ってください。`
    );
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (params.geminiKey) headers["x-gemini-api-key"] = params.geminiKey;
  if (params.openaiKey) headers["x-openai-api-key"] = params.openaiKey;
  if (params.replicateKey) headers["x-replicate-api-key"] = params.replicateKey;

  const res = await fetch("/api/generate", {
    method: "POST",
    headers,
    body: JSON.stringify({
      modelKey: params.modelKey,
      aspectRatio: params.aspectRatio,
      count: params.count,
      prompt: params.prompt,
      inputImages: fitted.inputs,
      referenceImages: fitted.refs,
      controls,
    }),
  });
  if (!res.ok) {
    if (res.status === 413) {
      throw new Error("送信データが大きすぎます(413)。より小さい画像を使ってください。");
    }
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `生成に失敗しました (${res.status})`);
  }
  return (await res.json()) as GenerateResponse;
}
