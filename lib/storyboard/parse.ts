// 字コンテ(テキスト)をカット表に分解するパーサー。
// 純粋関数のみ（DOM/DB非依存）でテスト可能にする。
//
// 記法:
//   BGM:        シーン区切りのヒント（画像化しない・オーバーレイにもしない）
//   SE:         効果音 → SE オーバーレイ
//   T：         テロップ/プロンプトUI → PROMPT_UI オーバーレイ
//   NA（名前）「…」 ナレーション → NA オーバーレイ（青字）
//   話者「セリフ」   セリフ → 画像化しない。感情ヒントのみプロンプトに反映
//   （ト書き）      画の本体。1行 = 1カット（カット表で自由に結合・分割可能）
//
// 区切り: 空行 / BGM: 行 / （カット替わり）

import type { CameraAngle, Cut, Overlay } from "./types";

/** 半角/全角コロンの両方を許容した行頭プレフィックス判定 */
function stripPrefix(line: string, prefix: string): string | null {
  const m = line.match(new RegExp(`^${prefix}[:：]\\s*(.*)$`));
  return m ? m[1].trim() : null;
}

/** ト書き行か（全角/半角括弧で行全体が囲まれている） */
function matchAction(line: string): string | null {
  const m = line.match(/^[（(](.*)[）)]$/s);
  return m ? m[1].trim() : null;
}

/** `NA（男・心の声）「……」` を解析 */
function matchNarration(line: string): Overlay | null {
  const m = line.match(/^NA\s*[（(]([^）)]*)[）)]\s*「(.*?)」?\s*$/s);
  if (m) return { type: "NA", speaker: m[1].trim(), text: m[2].trim() };
  const plain = stripPrefix(line, "NA");
  if (plain !== null) return { type: "NA", text: plain.replace(/^「|」$/g, "") };
  return null;
}

/** `話者「セリフ」` を解析（話者名に括弧・空白を含まない行のみ） */
function matchDialogue(line: string): Overlay | null {
  const m = line.match(/^([^「」（()）\s][^「」]{0,29})「(.*?)」\s*$/s);
  if (!m) return null;
  return { type: "DIALOGUE", speaker: m[1].trim(), text: m[2].trim() };
}

/** ト書きの語彙からカメラ画角を推定 */
export function inferCamera(textJa: string): CameraAngle | null {
  if (/真俯瞰/.test(textJa)) return "top_down";
  if (/ハイアングル|俯瞰|見下ろ/.test(textJa)) return "high_angle";
  if (/寄り|アップ|クローズ/.test(textJa)) return "close_up";
  if (/人目線|目線|アイレベル/.test(textJa)) return "eye_level";
  return null;
}

/** セリフ・ト書きの感情語 → 英語ヒント */
const EMOTION_MAP: [RegExp, string][] = [
  [/笑|ニコ|微笑/, "smiling"],
  [/泣|涙/, "crying"],
  [/怒|睨/, "angry expression"],
  [/驚|びっくり|ハッ/, "surprised expression"],
  [/照れ|赤面/, "shy, blushing"],
  [/悲し/, "sad expression"],
];

export function inferEmotion(text: string): string | undefined {
  const hits = EMOTION_MAP.filter(([re]) => re.test(text)).map(([, en]) => en);
  return hits.length ? hits.join(", ") : undefined;
}

/** 秒数ヒント（「4s」「（4秒）」等）をト書きから拾う */
function inferDuration(textJa: string): string {
  const m = textJa.match(/(\d+(?:\.\d+)?)\s*(?:秒|s)/);
  return m ? `${m[1]}s` : "";
}

export interface ParseResult {
  cuts: Cut[];
  /** NA/セリフの話者から抽出したキャラクター名候補（重複なし・出現順） */
  characterNames: string[];
}

let seq = 0;
function cutId(): string {
  seq += 1;
  return `cut_${Date.now().toString(36)}_${seq}`;
}

/** 話者表記からキャラ名を取り出す（「男・心の声」→「男」） */
function speakerName(speaker: string): string {
  return speaker.split(/[・･]/)[0].trim();
}

/**
 * 字コンテ全文をカット配列に分解する。
 * - 各（ト書き）行を 1 カットとする（8±2 カット程度の粒度。結合・分割はUI側で可能）
 * - NA/T/SE は同ブロック内の直前のカットに紐付ける。
 *   ブロック先頭でまだカットが無い場合は、次に現れるカットに紐付ける
 * - セリフは DIALOGUE として保持し、感情語のみ emotionHint に反映
 */
export function parseScript(script: string): ParseResult {
  const lines = script.split(/\r?\n/);
  const cuts: Cut[] = [];
  const characterNames: string[] = [];

  // 現在のブロックで最後に作ったカット。区切りで null に戻す
  let current: Cut | null = null;
  // カットより先に現れたオーバーレイ（次のカットに付与）
  let pending: Overlay[] = [];

  const addCharacter = (name: string) => {
    if (name && !characterNames.includes(name)) characterNames.push(name);
  };

  const attach = (ov: Overlay) => {
    if (ov.speaker) addCharacter(speakerName(ov.speaker));
    const target = current ?? null;
    if (target) {
      target.overlays.push(ov);
      if (ov.type === "DIALOGUE") {
        const emo = inferEmotion(ov.text);
        if (emo) target.emotionHint = target.emotionHint ? `${target.emotionHint}, ${emo}` : emo;
      }
    } else {
      pending.push(ov);
    }
  };

  for (const raw of lines) {
    const line = raw.trim();

    // --- 区切り: 空行 / BGM: ---
    if (!line || stripPrefix(line, "BGM") !== null) {
      current = null;
      continue;
    }

    // --- オーバーレイ系 ---
    const se = stripPrefix(line, "SE");
    if (se !== null) {
      attach({ type: "SE", text: se });
      continue;
    }
    const t = stripPrefix(line, "T");
    if (t !== null) {
      attach({ type: "PROMPT_UI", text: t });
      continue;
    }
    const na = matchNarration(line);
    if (na) {
      attach(na);
      continue;
    }

    // --- ト書き ---
    const action = matchAction(line);
    if (action !== null) {
      if (/^カット替わり$/.test(action)) {
        current = null;
        continue;
      }
      const cut: Cut = {
        id: cutId(),
        textJa: action,
        durationHint: inferDuration(action),
        camera: inferCamera(action),
        overlays: pending,
        characters: [],
        emotionHint: inferEmotion(action),
        status: "draft",
      };
      pending = [];
      cuts.push(cut);
      current = cut;
      continue;
    }

    // --- セリフ ---
    const dlg = matchDialogue(line);
    if (dlg) {
      attach(dlg);
      continue;
    }

    // 上記以外の行は補足メモとして直前カットのト書きに足す（情報を落とさない）
    if (current) current.textJa += `。${line}`;
  }

  // 末尾に残った pending は最後のカットへ
  if (pending.length && cuts.length) {
    cuts[cuts.length - 1].overlays.push(...pending);
  }

  return { cuts, characterNames };
}

/**
 * カットにキャラクターを自動割り当てする。
 * 表示名がト書き・セリフ話者に含まれるキャラを紐付ける
 */
export function assignCharacters(
  cuts: Cut[],
  characters: { key: string; displayName: string }[]
): Cut[] {
  return cuts.map((cut) => {
    const keys = characters
      .filter((c) => {
        if (!c.displayName) return false;
        if (cut.textJa.includes(c.displayName)) return true;
        return cut.overlays.some(
          (o) => o.speaker && speakerName(o.speaker) === c.displayName
        );
      })
      .map((c) => c.key);
    return { ...cut, characters: keys };
  });
}

/** カットを1つ前のカットと結合する */
export function mergeWithPrevious(cuts: Cut[], index: number): Cut[] {
  if (index <= 0 || index >= cuts.length) return cuts;
  const prev = cuts[index - 1];
  const cur = cuts[index];
  const merged: Cut = {
    ...prev,
    textJa: `${prev.textJa}。${cur.textJa}`,
    overlays: [...prev.overlays, ...cur.overlays],
    characters: Array.from(new Set([...prev.characters, ...cur.characters])),
    camera: prev.camera ?? cur.camera,
    emotionHint:
      [prev.emotionHint, cur.emotionHint].filter(Boolean).join(", ") || undefined,
    // 内容が変わるので翻訳・生成結果は破棄
    promptEn: undefined,
    generatedPrompt: undefined,
    resultAssetId: undefined,
    thumbUrl: undefined,
    status: "draft",
    error: undefined,
  };
  return [...cuts.slice(0, index - 1), merged, ...cuts.slice(index + 1)];
}

/** カットを句点で2つに分割する（分割点が無ければそのまま） */
export function splitCut(cuts: Cut[], index: number): Cut[] {
  const cut = cuts[index];
  if (!cut) return cuts;
  const m = cut.textJa.match(/^(.+?)[。．]\s*(.+)$/s);
  if (!m) return cuts;
  const first: Cut = {
    ...cut,
    textJa: m[1].trim(),
    promptEn: undefined,
    generatedPrompt: undefined,
    resultAssetId: undefined,
    thumbUrl: undefined,
    status: "draft",
    error: undefined,
  };
  const second: Cut = {
    id: cutId(),
    textJa: m[2].trim(),
    durationHint: "",
    camera: inferCamera(m[2]),
    overlays: [],
    characters: [...cut.characters],
    emotionHint: inferEmotion(m[2]),
    status: "draft",
  };
  return [...cuts.slice(0, index), first, second, ...cuts.slice(index + 1)];
}
