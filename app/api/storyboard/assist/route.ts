// 字コンテ→絵コンテ支援API。
// Geminiのテキストモデルで (1) ト書きの英訳（画像生成プロンプト向け）
// (2) キャラ記述文の英訳 (3) 実在人名・実在IP語の検出 をまとめて行う。

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const maxDuration = 120;

const TEXT_MODEL_ID = process.env.GEMINI_TEXT_MODEL_ID || "gemini-2.5-flash";

interface AssistRequest {
  cuts: { id: string; textJa: string; sceneDescription?: string }[];
  characters: { key: string; descriptionJa: string; displayName?: string }[];
  /** 共通のシーン規定（シーン単位で英訳して全カットに再利用） */
  scenes?: { id: string; descriptionJa: string }[];
}

export interface AssistCutResult {
  id: string;
  actionEn: string;
  location?: string;
  timeOfDay?: string;
  camera?: "top_down" | "high_angle" | "eye_level" | "close_up";
  realNames?: string[];
}

export interface AssistResponse {
  cuts: AssistCutResult[];
  characters: { key: string; descriptionEn: string }[];
  scenes: { id: string; sceneEn: string }[];
  /** 入力全体から検出した実在人名・実在IP語 */
  realNames: string[];
}

/** モデル出力からJSON本体を取り出す（コードフェンス等の揺れを吸収） */
function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSONが見つかりません");
  return JSON.parse(trimmed.slice(start, end + 1));
}

export async function POST(req: NextRequest) {
  let body: AssistRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 400 });
  }
  const cuts = (body.cuts || []).filter((c) => c?.id && c?.textJa?.trim());
  const characters = (body.characters || []).filter((c) => c?.key);
  const scenes = (body.scenes || []).filter((s) => s?.id && s?.descriptionJa?.trim());
  if (cuts.length === 0 && characters.length === 0 && scenes.length === 0) {
    return NextResponse.json({ error: "変換対象がありません。" }, { status: 400 });
  }

  const apiKey = req.headers.get("x-gemini-api-key")?.trim() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini APIキーが設定されていません。右上の「⚙ APIキー」から設定してください。" },
      { status: 401 }
    );
  }

  const instruction = `あなたは映像絵コンテ制作の支援AIです。以下の映像ト書き・シーン規定・キャラクター記述を処理し、JSONのみを出力してください。

## タスク
1. 各ト書き(cuts)を、画像生成プロンプト用の英語に**膨らませて**変換する:
   - sceneDescription（共通のシーン規定）を文脈として踏まえ、構図・被写体の動き・視線・前景/背景・光を補って「1枚の画」として成立する記述にする（名詞句と現在分詞中心、45語以内）
   - 原文に無い出来事・小道具・人物は発明しない（演出的な補完のみ）
   - 固有名詞・ブランド名・文字表示(テロップ等)に関する記述は除外する
   - 実在の人名は絶対に英訳文へ含めない（一般的な記述に置き換える）
   - location(場所)とtimeOfDay(時間帯)を英語で抽出する(不明なら省略)
   - カメラ画角が読み取れる場合のみ camera を top_down / high_angle / eye_level / close_up から選ぶ
2. 各シーン規定(scenes)を、シーン内の全カットの背景描写として再利用できる英語(25語以内。場所・時間帯・天候・雰囲気)に変換する
3. 各キャラクター記述(characters)を画像生成プロンプト用の英語(20語以内)に変換する
4. 入力テキスト全体から、実在の人物名(タレント・俳優・著名人)や実在作品・ブランド名を検出し realNames に列挙する（架空の記号的な名前 MAN_A 等や一般名詞「男」「猫」は含めない）

## 出力形式(JSONのみ、説明文なし)
{
  "cuts": [{"id": "...", "actionEn": "...", "location": "...", "timeOfDay": "...", "camera": "eye_level", "realNames": []}],
  "scenes": [{"id": "...", "sceneEn": "..."}],
  "characters": [{"key": "...", "descriptionEn": "..."}],
  "realNames": []
}

## 入力
cuts:
${JSON.stringify(cuts, null, 2)}

scenes:
${JSON.stringify(scenes, null, 2)}

characters:
${JSON.stringify(characters, null, 2)}`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: TEXT_MODEL_ID,
      contents: [{ role: "user", parts: [{ text: instruction }] }],
      config: { responseMimeType: "application/json", temperature: 0.2 } as Record<
        string,
        unknown
      >,
    });
    const text = res.text ?? "";
    const parsed = extractJson(text) as Partial<AssistResponse>;

    const outCuts: AssistCutResult[] = (parsed.cuts || [])
      .filter((c) => c && typeof c.id === "string")
      .map((c) => ({
        id: c.id,
        actionEn: String(c.actionEn || "").slice(0, 400),
        location: c.location ? String(c.location).slice(0, 100) : undefined,
        timeOfDay: c.timeOfDay ? String(c.timeOfDay).slice(0, 60) : undefined,
        camera: ["top_down", "high_angle", "eye_level", "close_up"].includes(c.camera as string)
          ? (c.camera as AssistCutResult["camera"])
          : undefined,
        realNames: Array.isArray(c.realNames) ? c.realNames.map(String) : [],
      }));
    const outChars = (parsed.characters || [])
      .filter((c) => c && typeof c.key === "string")
      .map((c) => ({ key: c.key, descriptionEn: String(c.descriptionEn || "").slice(0, 300) }));
    const outScenes = (parsed.scenes || [])
      .filter((s) => s && typeof s.id === "string")
      .map((s) => ({ id: s.id, sceneEn: String(s.sceneEn || "").slice(0, 300) }));
    const realNames = Array.from(
      new Set([
        ...(Array.isArray(parsed.realNames) ? parsed.realNames.map(String) : []),
        ...outCuts.flatMap((c) => c.realNames || []),
      ])
    ).filter((n) => n.trim().length >= 2);

    const payload: AssistResponse = {
      cuts: outCuts,
      characters: outChars,
      scenes: outScenes,
      realNames,
    };
    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "変換に失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
