// カットの生成後AIチェック(QA)API。
// 生成されたカット画像を Gemini の視覚モデルで採点し、
// 文字混入・ト書き不一致・キャラ不一致など明らかな失敗を人が目視する前に検出する。
// 実在人名ガード(assertPromptSafe)の対象外: 画像生成プロンプトは送らず、
// 画像本体とト書き・キャラの記述文のみを送る。

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const maxDuration = 60;

const TEXT_MODEL_ID = process.env.GEMINI_TEXT_MODEL_ID || "gemini-2.5-flash";

interface QaCharacter {
  key: string;
  descriptionEn?: string;
  /** data URL 形式の参照画像（任意） */
  refImage?: string;
}

interface QaRequest {
  /** data URL 形式の生成画像 */
  image: string;
  actionEn: string;
  actionJa: string;
  characters: QaCharacter[];
  styleLabel: string;
  expectedCharacterKeys: string[];
  /** data URL 形式の手書きレイアウトスケッチ（任意） */
  sketch?: string;
}

export interface QaResponse {
  /** 画像内に文字・字幕・ロゴ・透かしがあるか */
  textDetected: boolean;
  /** ト書きの出来事・被写体・位置関係が描かれているか(0-5) */
  actionMatch: number;
  /** 登場人物の人数・外見の一致度(0-5) */
  characterMatch: number;
  /** 指定スタイルらしさ(0-5) */
  styleMatch: number;
  /** スケッチとの構図・フレーミング・配置の一致度(0-5)。sketchがある場合のみ */
  layoutMatch?: number;
  /** 日本語の短い指摘（最大5件） */
  issues: string[];
  /** 再生成時にプロンプト末尾へ足す英語1文（問題なければ空文字） */
  revisionHint: string;
}

function dataUrlToPart(dataUrl: string) {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/s);
  if (!match) return null;
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

/** 0〜5の整数にクランプ */
function clamp05(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(5, v));
}

export async function POST(req: NextRequest) {
  let body: QaRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 400 });
  }
  const imagePart = body.image ? dataUrlToPart(body.image) : null;
  if (!imagePart) {
    return NextResponse.json({ error: "画像がありません。" }, { status: 400 });
  }

  const apiKey = req.headers.get("x-gemini-api-key")?.trim() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini APIキーが設定されていません。右上の「⚙ APIキー」から設定してください。" },
      { status: 401 }
    );
  }

  const characters = Array.isArray(body.characters) ? body.characters : [];
  const refParts = characters
    .map((c) => (c.refImage ? dataUrlToPart(c.refImage) : null))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const sketchPart = body.sketch ? dataUrlToPart(body.sketch) : null;

  const charLines =
    characters.map((c) => `- ${c.key}: ${c.descriptionEn?.trim() || "(記述なし)"}`).join("\n") ||
    "(登場人物なし)";

  const sketchNote = sketchPart
    ? "最後の画像は手書きのレイアウトスケッチです。構図・フレーミング・被写体の配置が生成画像と一致しているかを layoutMatch (0-5) で採点してください。"
    : "";
  const layoutKeyDoc = sketchPart
    ? "\nlayoutMatch: 生成画像の構図・フレーミング・被写体の配置が手書きのレイアウトスケッチ(最後の画像)と一致しているか(0-5の整数)"
    : "";
  const jsonTemplate = sketchPart
    ? '{"textDetected": boolean, "actionMatch": 0-5, "characterMatch": 0-5, "styleMatch": 0-5, "layoutMatch": 0-5, "issues": ["..."], "revisionHint": "..."}'
    : '{"textDetected": boolean, "actionMatch": 0-5, "characterMatch": 0-5, "styleMatch": 0-5, "issues": ["..."], "revisionHint": "..."}';

  const instruction = `あなたは絵コンテの品質チェッカーです。1枚目の画像が生成されたカット画像、
続く画像があればそれぞれ登場キャラクターの参照画像です。${sketchNote}
以下のト書き(日本語原文と英訳)と照らし合わせ、採点は厳しめに行い、結果をJSONのみで返してください。

ト書き(日本語): ${body.actionJa || "(なし)"}
ト書き(英訳): ${body.actionEn || "(なし)"}
指定スタイル: ${body.styleLabel || "(未指定)"}
登場するはずのキャラクター:
${charLines}

JSONの各キー:
textDetected: 画像内に文字・字幕・ロゴ・透かしがあるか(true/false)
actionMatch: ト書きの出来事・被写体・位置関係が描かれているか(0-5の整数)
characterMatch: 登場人物の人数と外見が記述/参照と一致するか(0-5の整数)。参照画像があれば顔・髪型・服装を比較する。参照画像が無ければ記述文とだけ比較する
styleMatch: 指定スタイル(${body.styleLabel || "未指定"})らしい描画か(0-5の整数)${layoutKeyDoc}
issues: 気づいた問題点の日本語の短い指摘(最大5件の配列。問題なければ空配列)
revisionHint: 再生成時にプロンプト末尾へ足す英語1文(問題なければ空文字)

JSONのみを出力:
${jsonTemplate}`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const parts = sketchPart
      ? [imagePart, ...refParts, sketchPart, { text: instruction }]
      : [imagePart, ...refParts, { text: instruction }];
    const res = await ai.models.generateContent({
      model: TEXT_MODEL_ID,
      contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json", temperature: 0.1 } as Record<
        string,
        unknown
      >,
    });
    const text = (res.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("解析結果を取得できませんでした");
    const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<QaResponse>;
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.slice(0, 5).map((s) => String(s).slice(0, 80))
      : [];
    const payload: QaResponse = {
      textDetected: Boolean(parsed.textDetected),
      actionMatch: clamp05(parsed.actionMatch),
      characterMatch: clamp05(parsed.characterMatch),
      styleMatch: clamp05(parsed.styleMatch),
      layoutMatch: sketchPart ? clamp05(parsed.layoutMatch) : undefined,
      issues,
      revisionHint: String(parsed.revisionHint || "").slice(0, 200),
    };
    return NextResponse.json(payload);
  } catch (e) {
    const msg =
      e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "AIチェックに失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
