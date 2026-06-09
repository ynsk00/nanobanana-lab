import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getModel } from "@/lib/pricing";
import type { GenerateResponse, ResultImage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface GenerateRequest {
  modelKey: string;
  aspectRatio: string;
  count: number;
  prompt: string;
  inputImages: string[]; // data URLs
  referenceImages: string[]; // data URLs
}

/** data URL を Gemini の inlineData パートに変換 */
function dataUrlToPart(dataUrl: string) {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/s);
  if (!match) return null;
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

function genId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

export async function POST(req: NextRequest) {
  // ユーザーがブラウザの設定画面で入力したキーを優先。なければ環境変数。
  const apiKey =
    req.headers.get("x-gemini-api-key")?.trim() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Gemini APIキーが設定されていません。右上の「⚙ APIキー」から設定してください。",
      },
      { status: 401 }
    );
  }

  let body: GenerateRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 400 });
  }

  const { modelKey, aspectRatio, prompt, inputImages = [], referenceImages = [] } = body;
  const count = Math.min(Math.max(1, Number(body.count) || 1), 8);
  const model = getModel(modelKey);

  if (!prompt?.trim() && inputImages.length === 0) {
    return NextResponse.json(
      { error: "プロンプトまたは入力画像が必要です。" },
      { status: 400 }
    );
  }

  const ai = new GoogleGenAI({ apiKey });

  // contents パートを構築。各画像の直前に役割ラベルのテキストを入れ、
  // モデルが @inN / @refN を画像と正しく対応づけられるようにする。
  const parts: Record<string, unknown>[] = [];

  if (inputImages.length + referenceImages.length > 0) {
    parts.push({
      text:
        "以下に画像を添付します。@inN は入力画像（編集・合成の対象）、" +
        "@refN は参照画像（スタイルや要素・構図の参考）です。プロンプト中の " +
        "@inN / @refN は対応する画像を指します。",
    });
  }

  inputImages.forEach((dataUrl, i) => {
    const part = dataUrlToPart(dataUrl);
    if (part) {
      parts.push({ text: `入力画像 @in${i + 1}:` });
      parts.push(part);
    }
  });

  referenceImages.forEach((dataUrl, i) => {
    const part = dataUrlToPart(dataUrl);
    if (part) {
      parts.push({ text: `参照画像 @ref${i + 1}（スタイル/要素の参考。被写体ではなく参考として扱う）:` });
      parts.push(part);
    }
  });

  if (prompt?.trim()) {
    parts.push({ text: prompt });
  } else if (parts.length > 0) {
    parts.push({ text: "上記の入力画像をもとに、参照画像を参考にして画像を生成してください。" });
  }

  const start = Date.now();

  // count 枚を並列リクエスト（画像モデルは1リクエスト=1枚が安定するため）
  const tasks = Array.from({ length: count }).map(async () => {
    const response = await ai.models.generateContent({
      model: model.id,
      contents: [{ role: "user", parts }],
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio },
      } as Record<string, unknown>,
    });
    return response;
  });

  const settled = await Promise.allSettled(tasks);
  const durationMs = Date.now() - start;

  const results: ResultImage[] = [];
  const errors: string[] = [];

  for (const s of settled) {
    if (s.status === "rejected") {
      errors.push(String(s.reason?.message ?? s.reason ?? "不明なエラー"));
      continue;
    }
    const candidate = s.value.candidates?.[0];
    const cparts = candidate?.content?.parts ?? [];
    let note = "";
    let found = false;
    for (const p of cparts) {
      const anyP = p as { text?: string; inlineData?: { data?: string; mimeType?: string } };
      if (anyP.inlineData?.data) {
        const mimeType = anyP.inlineData.mimeType || "image/png";
        results.push({
          id: genId(),
          dataUrl: `data:${mimeType};base64,${anyP.inlineData.data}`,
          mimeType,
          note: note || undefined,
        });
        found = true;
      } else if (anyP.text) {
        note += anyP.text;
      }
    }
    if (!found) {
      // 画像が返らなかった場合（安全フィルタ等）。理由を拾えるなら拾う。
      const reason =
        candidate?.finishReason ||
        (s.value as { promptFeedback?: { blockReason?: string } }).promptFeedback
          ?.blockReason ||
        note ||
        "画像が返却されませんでした";
      errors.push(String(reason));
    }
  }

  const costUsd = results.length * model.pricePerImage;

  const payload: GenerateResponse = { results, costUsd, durationMs, errors };
  return NextResponse.json(payload);
}
