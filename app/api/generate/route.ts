import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import {
  getModel,
  openaiSizeForAspect,
  replicateSizeForAspect,
  type ModelDef,
} from "@/lib/pricing";
import type { ControlParams } from "@/lib/generation";
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
  controls?: ControlParams;
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

/** 例外/エラーJSONを短い日本語メッセージに要約する */
function summarizeError(raw: unknown): string {
  let msg = raw instanceof Error ? raw.message : String(raw ?? "不明なエラー");
  try {
    const start = msg.indexOf("{");
    if (start >= 0) {
      const obj = JSON.parse(msg.slice(start)) as {
        error?: { code?: number; status?: string; message?: string };
      };
      const err = obj.error;
      if (err) {
        if (err.code === 429 || err.status === "RESOURCE_EXHAUSTED") {
          return "クォータ超過 (429): APIの利用上限に達しました。時間をおくか、課金プラン/別モデル(GPT Image等)をお試しください。";
        }
        const m = (err.message || "").split("\n")[0];
        return `${err.code ? `[${err.code}] ` : ""}${m}`.slice(0, 200);
      }
    }
  } catch {
    /* JSONでなければそのまま */
  }
  msg = msg.split("\n")[0];
  if (/RESOURCE_EXHAUSTED|quota|rate.?limit|429/i.test(msg)) {
    return "クォータ/レート上限に達しました。時間をおくか、別モデルをお試しください。";
  }
  return msg.slice(0, 200);
}

export async function POST(req: NextRequest) {
  let body: GenerateRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 400 });
  }

  const { modelKey, aspectRatio, prompt, inputImages = [], referenceImages = [], controls } = body;
  const count = Math.min(Math.max(1, Number(body.count) || 1), 8);
  const model = getModel(modelKey);
  const hasControlImage = !!(controls?.identityImage || controls?.controlImage || controls?.styleImage);

  if (!prompt?.trim() && inputImages.length === 0 && !hasControlImage) {
    return NextResponse.json(
      { error: "プロンプトまたは入力画像が必要です。" },
      { status: 400 }
    );
  }

  const args: HandlerArgs = { aspectRatio, count, prompt, inputImages, referenceImages, controls };

  if (model.provider === "replicate") {
    const apiKey =
      req.headers.get("x-replicate-api-key")?.trim() || process.env.REPLICATE_API_TOKEN;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Replicate APIキーが設定されていません。右上の「⚙ APIキー」から設定してください。" },
        { status: 401 }
      );
    }
    return handleReplicate(model, apiKey, args);
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
    return handleOpenAI(model, apiKey, args);
  }

  const apiKey =
    req.headers.get("x-gemini-api-key")?.trim() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini APIキーが設定されていません。右上の「⚙ APIキー」から設定してください。" },
      { status: 401 }
    );
  }
  return handleGoogle(model, apiKey, args);
}

interface HandlerArgs {
  aspectRatio: string;
  count: number;
  prompt: string;
  inputImages: string[];
  referenceImages: string[];
  controls?: ControlParams;
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
      errors.push(summarizeError(s.reason));
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
  const size = openaiSizeForAspect(aspectRatio, model.imageSizeTier);
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
      fd.append("model", model.id);
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
        body: JSON.stringify({ model: model.id, prompt: finalPrompt, n, size, quality }),
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

// ---------- Replicate (InstantID 等) ----------
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** "owner/name" なら latest_version を解決。version hash ならそのまま返す */
async function resolveReplicateVersion(idOrName: string, apiKey: string): Promise<string> {
  if (!idOrName.includes("/")) return idOrName;
  const res = await fetch(`https://api.replicate.com/v1/models/${idOrName}`, {
    headers: { Authorization: `Token ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Replicateモデル解決に失敗 (HTTP ${res.status})`);
  const j = (await res.json()) as { latest_version?: { id?: string } };
  const v = j?.latest_version?.id;
  if (!v) throw new Error("Replicateモデルのバージョンが取得できませんでした");
  return v;
}

interface ReplicatePrediction {
  id?: string;
  status?: string;
  output?: unknown;
  error?: unknown;
}

async function runReplicatePrediction(
  version: string,
  input: Record<string, unknown>,
  apiKey: string
): Promise<ReplicatePrediction> {
  const create = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
      Prefer: "wait", // 最大~60s ブロックして同期的に待つ
    },
    body: JSON.stringify({ version, input }),
  });
  if (!create.ok) {
    const j = (await create.json().catch(() => ({}))) as { detail?: string; title?: string };
    throw new Error(j?.detail || j?.title || `Replicate予測の作成に失敗 (HTTP ${create.status})`);
  }
  let pred = (await create.json()) as ReplicatePrediction;
  const deadline = Date.now() + 260_000; // maxDuration(300s)内で打ち切り
  while (pred.status && !["succeeded", "failed", "canceled"].includes(pred.status)) {
    if (Date.now() > deadline) throw new Error("生成がタイムアウトしました。時間をおいて再試行してください。");
    await sleep(2000);
    const get = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
      headers: { Authorization: `Token ${apiKey}` },
    });
    if (!get.ok) throw new Error(`Replicate状態取得に失敗 (HTTP ${get.status})`);
    pred = (await get.json()) as ReplicatePrediction;
  }
  return pred;
}

function normalizeReplicateOutput(output: unknown): string[] {
  if (!output) return [];
  if (typeof output === "string") return [output];
  if (Array.isArray(output)) return output.filter((x): x is string => typeof x === "string");
  return [];
}

async function handleReplicate(model: ModelDef, apiKey: string, args: HandlerArgs) {
  const { aspectRatio, count, prompt, controls } = args;
  const c = controls || {};
  if (!c.identityImage) {
    return NextResponse.json(
      {
        error:
          "InstantIDには同一性(顔)画像が必要です。「制御生成」ノードの identity 入力に顔画像を接続してください。",
      },
      { status: 400 }
    );
  }

  const { width, height } = replicateSizeForAspect(aspectRatio);
  const numOutputs = Math.min(Math.max(1, count), 4);

  let version: string;
  try {
    version = process.env.REPLICATE_INSTANTID_VERSION || (await resolveReplicateVersion(model.id, apiKey));
  } catch (e) {
    return NextResponse.json({ error: summarizeError(e) }, { status: 502 });
  }

  const input: Record<string, unknown> = {
    image: c.identityImage,
    prompt: prompt?.trim() || "a portrait photo, high quality, detailed",
    negative_prompt: "lowres, bad anatomy, worst quality, low quality, blurry, deformed",
    width,
    height,
    num_outputs: numOutputs,
    num_inference_steps: clamp(c.steps ?? 30, 1, 60),
    guidance_scale: c.guidanceScale ?? 5,
    ip_adapter_scale: clamp(c.identityStrength ?? 0.8, 0, 1.5),
    controlnet_conditioning_scale: clamp(c.controlStrength ?? 0.8, 0, 1.5),
  };
  if (typeof c.seed === "number") input.seed = c.seed;
  if (c.controlImage) {
    input.pose_image = c.controlImage;
    input.enable_pose_controlnet = true;
  }

  const start = Date.now();
  let pred: ReplicatePrediction;
  try {
    pred = await runReplicatePrediction(version, input, apiKey);
  } catch (e) {
    return NextResponse.json({ error: summarizeError(e) }, { status: 502 });
  }
  const durationMs = Date.now() - start;

  if (pred.status !== "succeeded") {
    const reason = pred.error ? String(pred.error) : `生成に失敗しました (${pred.status})`;
    return NextResponse.json({ error: summarizeError(reason) }, { status: 502 });
  }

  // 出力URL → base64 data URL
  const urls = normalizeReplicateOutput(pred.output);
  const results: ResultImage[] = [];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get("content-type") || "image/png";
      results.push({
        id: genId(),
        dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
        mimeType: mime,
      });
    } catch {
      /* skip one */
    }
  }

  const payload: GenerateResponse = {
    results,
    costUsd: results.length * model.pricePerImage,
    durationMs,
    errors: results.length ? [] : ["画像が返却されませんでした"],
    sentInputCount: 1,
    sentReferenceCount: (c.controlImage ? 1 : 0) + (c.styleImage ? 1 : 0),
  };
  return NextResponse.json(payload);
}
