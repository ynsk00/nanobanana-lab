// トーン参照画像の言語化API。
// アップロードされた画像を Gemini の視覚モデルで解釈し、
// 全カットのプロンプトへ流用できる英語のスタイル記述に変換する。

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const maxDuration = 60;

const TEXT_MODEL_ID = process.env.GEMINI_TEXT_MODEL_ID || "gemini-2.5-flash";

interface StyleRequest {
  /** data URL 形式の参照画像 */
  image: string;
}

export interface StyleResponse {
  /** プロンプトに追記するスタイル記述（英語・カンマ区切り） */
  styleEn: string;
  /** UI表示用の日本語要約 */
  summaryJa: string;
}

function dataUrlToPart(dataUrl: string) {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/s);
  if (!match) return null;
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

export async function POST(req: NextRequest) {
  let body: StyleRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 400 });
  }
  const part = body.image ? dataUrlToPart(body.image) : null;
  if (!part) {
    return NextResponse.json({ error: "画像がありません。" }, { status: 400 });
  }

  const apiKey = req.headers.get("x-gemini-api-key")?.trim() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini APIキーが設定されていません。右上の「⚙ APIキー」から設定してください。" },
      { status: 401 }
    );
  }

  const instruction = `この画像の「絵のトーン・スタイル」を画像生成プロンプトに流用できる形で言語化してください。

- 対象: 画材/レンダリング手法、色調・パレット、ライティング、質感、コントラスト、雰囲気、構図の傾向
- 対象外: 写っている被写体・人物・場所そのもの（何が写っているかは書かない）
- 実在の作家名・作品名・ブランド名は書かない

JSONのみを出力:
{
  "styleEn": "カンマ区切りの英語スタイル記述（40語以内。例: soft watercolor wash, muted earthy palette, ...）",
  "summaryJa": "日本語での1〜2文の要約"
}`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: TEXT_MODEL_ID,
      contents: [{ role: "user", parts: [part, { text: instruction }] }],
      config: { responseMimeType: "application/json", temperature: 0.3 } as Record<
        string,
        unknown
      >,
    });
    const text = (res.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("解析結果を取得できませんでした");
    const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<StyleResponse>;
    const payload: StyleResponse = {
      styleEn: String(parsed.styleEn || "").slice(0, 500),
      summaryJa: String(parsed.summaryJa || "").slice(0, 300),
    };
    if (!payload.styleEn) throw new Error("スタイル記述を取得できませんでした");
    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "言語化に失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
