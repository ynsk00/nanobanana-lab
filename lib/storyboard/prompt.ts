// 生成プロンプトの組み立て（テンプレート + カメラ辞書 + スタイルプリセット）

import type { CameraAngle, CharacterSheet, Cut, StylePresetKey } from "./types";

/** camera enum → 英語フレーズ */
export const CAMERA_PHRASES: Record<CameraAngle, string> = {
  top_down: "top-down aerial view",
  high_angle: "high angle shot",
  eye_level: "eye level medium shot",
  close_up: "close-up shot",
};

export interface StylePreset {
  key: StylePresetKey;
  label: string;
  suffix: string;
  description: string;
}

/**
 * スタイルプリセット。フォトリアル系は不気味の谷・肖像権リスクのため提供しない。
 * 全プリセット共通で NEGATIVE_SUFFIX を末尾に付与する
 */
export const STYLE_PRESETS: Record<StylePresetKey, StylePreset> = {
  pencil_rough: {
    key: "pencil_rough",
    label: "鉛筆ラフ（デフォルト）",
    suffix:
      "storyboard sketch, rough pencil drawing, monochrome, cinematic composition, 16:9",
    description: "コンテとして最も読みやすい",
  },
  gray_cinematic: {
    key: "gray_cinematic",
    label: "グレー・シネマティック",
    suffix: "grayscale digital painting, film storyboard style, soft shading, 16:9",
    description: "映画コンテ風のグレースケール",
  },
  anime_layout: {
    key: "anime_layout",
    label: "アニメレイアウト",
    suffix: "anime keyframe rough, clean line art, minimal shading, 16:9",
    description: "アニメ原画ラフ風",
  },
};

export const DEFAULT_STYLE: StylePresetKey = "pencil_rough";

/** 全プリセット共通の禁止事項（文字焼き込み防止） */
export const NEGATIVE_SUFFIX = "no text, no letters, no logo, no watermark";

/** 文字混入時のリカバリ用・強調版 */
export const NO_TEXT_EMPHASIS =
  "IMPORTANT: absolutely no text, no letters, no captions, no subtitles, no logos, no watermarks anywhere in the image";

/**
 * キャラクターのプロンプト句を作る。
 * 表示名（実名の可能性がある）は使わず、キー + 記述文のみを使う。
 * 参照画像を添付する場合は @refN 対応を明示する（/api/generate が @refN ラベルを付ける）
 */
export function characterPhrase(c: CharacterSheet, refIndex: number | null): string {
  const desc = c.descriptionEn?.trim() || c.descriptionJa.trim() || c.key;
  if (refIndex !== null) {
    return `${c.key} (@ref${refIndex + 1}: ${desc} — keep the same face, hairstyle and outfit as @ref${refIndex + 1})`;
  }
  return `${c.key} (${desc})`;
}

export interface BuildPromptOptions {
  cut: Cut;
  /** カットに登場するキャラ（cut.characters の順） */
  characters: CharacterSheet[];
  /** 参照画像として添付するキャラのキー（添付順 = @refN の順） */
  referenceKeys: string[];
  style: StylePresetKey;
  /** 修正指示を含めるか（再生成時） */
  includeEditNote?: boolean;
  /** 文字混入リカバリ: no text を強調する */
  emphasizeNoText?: boolean;
}

/**
 * 最終プロンプトを組み立てる。
 * テンプレート: {camera}, {scene/action}, {characters}, {location}, {time}, {style}, {negative}
 * 英訳（promptEn）が未取得の場合はト書き原文で代替する（Geminiは日本語も解釈可能）
 */
export function buildCutPrompt(opts: BuildPromptOptions): string {
  const { cut, characters, referenceKeys, style } = opts;
  const camera = CAMERA_PHRASES[cut.camera ?? "eye_level"];
  const action = cut.promptEn?.trim() || cut.textJa.trim();

  const charParts = characters.map((c) => {
    const refIndex = referenceKeys.indexOf(c.key);
    return characterPhrase(c, refIndex >= 0 ? refIndex : null);
  });

  const parts = [
    camera,
    action,
    ...charParts,
    cut.location?.trim(),
    cut.timeOfDay?.trim(),
    cut.emotionHint?.trim(),
    STYLE_PRESETS[style].suffix,
    opts.emphasizeNoText ? NO_TEXT_EMPHASIS : NEGATIVE_SUFFIX,
  ].filter((p): p is string => !!p);

  let prompt = parts.join(", ");
  if (opts.includeEditNote && cut.editNote?.trim()) {
    prompt += `\n\nRevision request (apply to the previous image): ${cut.editNote.trim()}`;
  }
  return prompt;
}

/** キャラシート（立ち姿基準画像）生成用プロンプト */
export function buildCharacterSheetPrompt(c: CharacterSheet, style: StylePresetKey): string {
  const desc = c.descriptionEn?.trim() || c.descriptionJa.trim() || c.key;
  return [
    "character reference sheet, single character, full body standing pose, front view, neutral expression, plain white background",
    desc,
    STYLE_PRESETS[style].suffix.replace(", 16:9", ""),
    NEGATIVE_SUFFIX,
  ].join(", ");
}
