// AI分解API。任意の書式の字コンテ（括弧なしのト書き・箇条書き・台本形式など）を
// Geminiのテキストモデルで解釈し、シーン（共通の舞台設定）とカット表に構造化する。
// ト書きは「画が浮かぶ」程度に軽く膨らませて正規化する（出来事の発明はしない）。

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const maxDuration = 120;

const TEXT_MODEL_ID = process.env.GEMINI_TEXT_MODEL_ID || "gemini-2.5-flash";

interface ParseRequest {
  script: string;
}

export interface ParsedOverlay {
  type: "NA" | "PROMPT_UI" | "SE" | "DIALOGUE";
  text: string;
  speaker?: string;
}

export interface ParsedCut {
  /** 所属シーン（scenes 配列のインデックス。無所属は -1） */
  sceneIndex: number;
  /** 正規化・補完済みのト書き（日本語） */
  textJa: string;
  camera?:
    | "top_down"
    | "high_angle"
    | "eye_level"
    | "low_angle"
    | "close_up"
    | "bust_shot"
    | "full_shot"
    | "wide"
    | "over_shoulder"
    | "pov";
  durationHint?: string;
  overlays: ParsedOverlay[];
  /** このカットに登場するキャラクター名（表示名） */
  characterNames: string[];
}

export interface ParseResponse {
  scenes: { name: string; descriptionJa: string }[];
  cuts: ParsedCut[];
  characterNames: string[];
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSONが見つかりません");
  return JSON.parse(trimmed.slice(start, end + 1));
}

const VALID_CAMERAS = [
  "top_down",
  "high_angle",
  "eye_level",
  "low_angle",
  "close_up",
  "bust_shot",
  "full_shot",
  "wide",
  "over_shoulder",
  "pov",
];
const VALID_OVERLAYS = ["NA", "PROMPT_UI", "SE", "DIALOGUE"];

export async function POST(req: NextRequest) {
  let body: ParseRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 400 });
  }
  const script = (body.script || "").trim();
  if (!script) {
    return NextResponse.json({ error: "字コンテが空です。" }, { status: 400 });
  }

  const apiKey = req.headers.get("x-gemini-api-key")?.trim() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini APIキーが設定されていません。右上の「⚙ APIキー」から設定してください。" },
      { status: 401 }
    );
  }

  const instruction = `あなたは映像制作の絵コンテ演出家です。以下の字コンテ（書式は自由。台本・箇条書き・散文など何でも）を読み、絵コンテのカット表に分解してJSONのみを出力してください。

## 分解ルール
1. **シーン**: 場所・時間帯が共通するまとまりを1シーンとし、name（短い見出し）と descriptionJa（場所・時間帯・天候・状況を1〜2文で規定。シーン内の全カットの背景に共通反映される）を書く
2. **カット**: 1カット = 1枚の画。全体で6〜12カット程度を目安に、映像として自然なカット割りにする
3. **textJa（ト書き）**: 各カットの画の内容。原文が簡素な場合は、構図・人物の動き・視線・背景が画として浮かぶように1〜2文へ軽く膨らませる。ただし原文に無い出来事・小道具・人物を発明しない（演出的な補完のみ）
4. **画像化しないもの**: BGM・音楽指定は無視。テロップ/字幕(T)・ナレーション(NA)・効果音(SE)・セリフ(DIALOGUE)は textJa に含めず overlays に分類する。セリフの感情は textJa の表情描写に反映してよい
5. **camera**: 画角が読み取れる/演出上自然な場合のみ次から選ぶ: top_down(真俯瞰) / high_angle(俯瞰) / eye_level(目線) / low_angle(あおり) / close_up(寄り) / bust_shot(バストアップ) / full_shot(全身) / wide(引き) / over_shoulder(肩越し・背中越し) / pov(主観)
6. **characterNames**: 各カットに映るキャラクター名（人物・動物）。字コンテ内の呼び名をそのまま使う
7. 実在の人名・ブランド名は textJa に残してよい（後段で置換処理される）

## 出力形式(JSONのみ)
{
  "scenes": [{"name": "朝の路地", "descriptionJa": "朝の通勤時間帯。住宅街の細い路地。ブロック塀が続く"}],
  "cuts": [{
    "sceneIndex": 0,
    "textJa": "...",
    "camera": "high_angle",
    "durationHint": "4s",
    "overlays": [{"type": "NA", "text": "...", "speaker": "男"}],
    "characterNames": ["男", "猫"]
  }],
  "characterNames": ["男", "猫"]
}

## 字コンテ
${script}`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: TEXT_MODEL_ID,
      contents: [{ role: "user", parts: [{ text: instruction }] }],
      config: { responseMimeType: "application/json", temperature: 0.3 } as Record<
        string,
        unknown
      >,
    });
    const parsed = extractJson(res.text ?? "") as Partial<ParseResponse>;

    const scenes = (Array.isArray(parsed.scenes) ? parsed.scenes : [])
      .filter((s) => s && (s.name || s.descriptionJa))
      .map((s) => ({
        name: String(s.name || "").slice(0, 80),
        descriptionJa: String(s.descriptionJa || s.name || "").slice(0, 500),
      }));

    const cuts: ParsedCut[] = (Array.isArray(parsed.cuts) ? parsed.cuts : [])
      .filter((c) => c && String(c.textJa || "").trim())
      .map((c) => ({
        sceneIndex:
          typeof c.sceneIndex === "number" && c.sceneIndex >= 0 && c.sceneIndex < scenes.length
            ? c.sceneIndex
            : -1,
        textJa: String(c.textJa).slice(0, 600),
        camera: VALID_CAMERAS.includes(c.camera as string)
          ? (c.camera as ParsedCut["camera"])
          : undefined,
        durationHint: c.durationHint ? String(c.durationHint).slice(0, 12) : "",
        overlays: (Array.isArray(c.overlays) ? c.overlays : [])
          .filter((o) => o && VALID_OVERLAYS.includes(o.type as string) && o.text)
          .map((o) => ({
            type: o.type as ParsedOverlay["type"],
            text: String(o.text).slice(0, 300),
            speaker: o.speaker ? String(o.speaker).slice(0, 40) : undefined,
          })),
        characterNames: (Array.isArray(c.characterNames) ? c.characterNames : [])
          .map(String)
          .filter((n) => n.trim())
          .slice(0, 8),
      }));

    if (!cuts.length) throw new Error("カットに分解できませんでした");

    const characterNames = Array.from(
      new Set([
        ...(Array.isArray(parsed.characterNames) ? parsed.characterNames.map(String) : []),
        ...cuts.flatMap((c) => c.characterNames),
      ])
    ).filter((n) => n.trim());

    const payload: ParseResponse = { scenes, cuts, characterNames };
    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "AI分解に失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
