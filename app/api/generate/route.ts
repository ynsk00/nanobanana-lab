import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getModel, openaiSizeForAspect, type ModelDef } from "@/lib/pricing";
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

/** data URL を Node の Blob に変換（OpenAI multipart 用） */
function dataUrlToBlobNode(dataUrl: string): Blob | null {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/s);
  if (!match) return null;
  const buf = Buffer.from(match[2], "base64");
  return new Blob([buf], { type: match[1] || "image/png" });
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function POST(req: NextRequest) {
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

  if (model.provider === "openai") {
    const apiKey =
      req.headers.get("x-openai-api-key")?.trim() || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI APIキーが設定されていません。右上の「⚙ APIキー」から設定してください。" },
        { status: 401 }
      );
    }
    return handleOpenAI(model, apiKey, { aspectRatio, count, prompt, inputImages, referenceImages });
  }

  const apiKey =
    req.headers.get("x-gemini-api-key")?.trim() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini APIキーが設定されていません。右上の「⚙ APIキー」から設定してください。" },
      { status: 401 }
    );
  }
  return handleGoogle(model, apiKey, { aspectRatio, count, prompt, inputImages, referenceImages });
}

interface HandlerArgs {
  aspectRatio: string;
  count: number;
  prompt: string;
  inputImages: string[];
  referenceImages: string[];
}

// ---------- Google (Gemini / Nano Banana) ----------
async function handleGoogle(model: ModelDef, apiKey: string, args: HandlerArgs) {
  const { aspectRatio, count, prompt, inputImages, referenceImages } = args;
  const ai = new GoogleGenAI({ apiKey });

  const parts: Record<string, unknown>[] = [];
  if (inputImages.length + referenceImages.length > 0) {
    parts.push({
      text:
        "以下に画像を添付します。@inN は入力画像（編集・合成の対象）、" +
        "@refN は参照画像（スタイルや要素・構図の参考）です。プロンプト中の " +
        "@inN / @refN は対応する画像を指します。",
    });
  }

  let sentInputCount = 0;
  let sentReferenceCount = 0;
  inputImages.forEach((dataUrl, i) => {
    const part = dataUrlToPart(dataUrl);
    if (part) {
      parts.push({ text: `入力画像 @in${i + 1}:` });
      parts.push(part);
      sentInputCount++;
    }
  });
  referenceImages.forEach((dataUrl, i) => {
    const part = dataUrlToPart(dataUrl);
    if (part) {
      parts.push({ text: `参照画像 @ref${i + 1}（スタイル/要素の参考。被写体ではなく参考として扱う）:` });
      parts.push(part);
      sentReferenceCount++;
    }
  });
  if (prompt?.trim()) parts.push({ text: prompt });
  else if (parts.length > 0)
    parts.push({ text: "上記の入力画像をもとに、参照画像を参考にして画像を生成してください。" });

  const start = Date.now();
  const tasks = Array.from({ length: count }).map(() =>
    ai.models.generateContent({
      model: model.id,
      contents: [{ role: "user", parts }],
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio },
      } as Record<string, unknown>,
    })
  );
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
      const reason =
        candidate?.finishReason ||
        (s.value as { promptFeedback?: { blockReason?: string } }).promptFeedback?.blockReason ||
        note ||
        "画像が返却されませんでした";
      errors.push(String(reason));
    }
  }

  const costUsd = results.length * model.pricePerImage;
  const payload: GenerateResponse = {
    results,
    costUsd,
    durationMs,
    errors,
    sentInputCount,
    sentReferenceCount,
  };
  return NextResponse.json(payload);
}

// ---------- OpenAI (GPT Image) ----------
async function handleOpenAI(model: ModelDef, apiKey: string, args: HandlerArgs) {
  const { aspectRatio, count, prompt, inputImages, referenceImages } = args;
  const size = openaiSizeForAspect(aspectRatio);
  const n = Math.min(Math.max(1, count), 10);
  const quality = model.quality || "auto";
  const finalPrompt = prompt?.trim() || "Create an image based on the provided reference images.";

  const allImages = [...inputImages, ...referenceImages];
  const start = Date.now();

  let res: Response;
  let sentInputCount = 0;
  let sentReferenceCount = 0;

  try {
    if (allImages.length > 0) {
      // 画像あり → 編集エンドポイント (multipart)
      const fd = new FormData();
      fd.append("model", "gpt-image-1");
      fd.append("prompt", finalPrompt);
      fd.append("n", String(n));
      fd.append("size", size);
      fd.append("quality", quality);
      inputImages.forEach((d, i) => {
        const blob = dataUrlToBlobNode(d);
        if (blob) {
          fd.append("image[]", blob, `input_${i + 1}.png`);
          sentInputCount++;
        }
      });
      referenceImages.forEach((d, i) => {
        const blob = dataUrlToBlobNode(d);
        if (blob) {
          fd.append("image[]", blob, `reference_${i + 1}.png`);
          sentReferenceCount++;
        }
      });
      res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
      });
    } else {
      // 画像なし → 生成エンドポイント (JSON)
      res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "gpt-image-1", prompt: finalPrompt, n, size, quality }),
      });
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "OpenAIへの接続に失敗しました。" },
      { status: 502 }
    );
  }

  const durationMs = Date.now() - start;

  if (!res.ok) {
    const j = await res.json().catch(() => ({} as { error?: { message?: string } }));
    const msg = j?.error?.message || `OpenAI API エラー (HTTP ${res.status})`;
    return NextResponse.json({ error: msg }, { status: res.status === 401 ? 401 : 502 });
  }

  const data = (await res.json()) as { data?: { b64_json?: string }[] };
  const results: ResultImage[] = (data.data || [])
    .filter((d) => d.b64_json)
    .map((d) => ({
      id: genId(),
      dataUrl: `data:image/png;base64,${d.b64_json}`,
      mimeType: "image/png",
    }));

  const costUsd = results.length * model.pricePerImage;
  const payload: GenerateResponse = {
    results,
    costUsd,
    durationMs,
    errors: results.length ? [] : ["画像が返却されませんでした"],
    sentInputCount,
    sentReferenceCount,
  };
  return NextResponse.json(payload);
}
