// 生成プロンプトの組み立て（自然文テンプレート + カメラ/照明/レンズ辞書 + スタイルプリセット）
//
// Gemini/GPT Image は「場面を文章で描写する」「写真用語（レンズ・光・構図）を使う」
// 「ネガティブはキーワード列挙ではなく意味的に書く」ことを推奨しているため、
// カンマ連結のタグ列ではなく、空行区切りの段落からなる英語の自然文を組み立てる。
// 値が無い要素は段落ごと省略する。

import type {
  CameraAngle,
  CharacterSheet,
  Composition,
  Cut,
  Lens,
  Lighting,
  Scene,
  ShotSize,
  StoryboardProject,
  StylePresetKey,
} from "./types";

/** camera enum → 英語フレーズ（ショットサイズの句の後に続ける。"at eye level" 等） */
export const CAMERA_PHRASES: Record<CameraAngle, string> = {
  eye_level: "at eye level",
  high_angle: "from a high angle looking down",
  low_angle: "from a low angle looking up",
  top_down: "from directly overhead in a top-down aerial view",
  over_shoulder: "from over the shoulder of a nearby figure",
  pov: "from a first-person point of view",
  dutch: "with a tilted dutch angle",
};

/** shotSize enum → 英語フレーズ（冠詞付きの名詞句。文頭で大文字化して使う） */
export const SHOT_SIZE_PHRASES: Record<ShotSize, string> = {
  extreme_close_up: "an extreme close-up shot",
  close_up: "a close-up shot",
  bust: "a bust shot framed from the chest up",
  waist: "a waist-up medium shot",
  full_body: "a full body shot",
  long: "a wide long shot",
  extreme_long: "an extreme long shot from a distance",
};

/** composition enum → 英語フレーズ（"composed with ..." に続ける） */
export const COMPOSITION_PHRASES: Record<Composition, string> = {
  rule_of_thirds: "the rule of thirds",
  centered: "the subject centered in frame",
  symmetrical: "a symmetrical composition",
  diagonal: "a dynamic diagonal composition",
  negative_space: "generous negative space",
  frame_in_frame: "a frame-within-a-frame composition",
};

/** lighting enum → 英語フレーズ（Setting段落で文頭に立てて使う） */
export const LIGHTING_PHRASES: Record<Lighting, string> = {
  soft_daylight: "soft diffused natural daylight",
  golden_hour: "warm golden hour sunlight, long soft shadows",
  harsh_noon: "hard midday sun, short crisp shadows, high contrast",
  overcast: "flat overcast light, gentle even shadows",
  backlit: "strong backlight with rim light outlining the subject",
  window: "soft window light from one side, quiet interior",
  night_street: "night scene lit by streetlights and neon, deep shadows",
  low_key: "low-key dramatic lighting, single key light, dark surroundings",
  high_key: "bright high-key lighting, airy and clean, minimal shadows",
};

/** lens enum → 英語フレーズ（Shot段落の末尾に独立した1文として追加する） */
export const LENS_PHRASES: Record<Lens, string> = {
  wide_24: "shot on a 24mm wide-angle lens, deep focus, slight perspective stretch",
  standard_35: "shot on a 35mm lens, natural perspective, most of the scene in focus",
  normal_50: "shot on a 50mm lens, natural perspective, subject in focus",
  portrait_85: "shot on an 85mm portrait lens, shallow depth of field, softly blurred background",
  tele_135: "shot on a 135mm telephoto lens, compressed perspective, background pulled close",
  macro: "macro lens, extreme close detail, very shallow focus",
};

export interface StylePreset {
  key: StylePresetKey;
  label: string;
  /** 描画方法を説明する英語の自然文（Style段落の先頭に置く） */
  render: string;
  description: string;
}

/**
 * スタイルプリセット。描画方法を自然文で説明する。
 * 実写風プリセットの利用時は肖像権への配慮をUI側で促す
 */
export const STYLE_PRESETS: Record<StylePresetKey, StylePreset> = {
  pencil_rough: {
    key: "pencil_rough",
    label: "鉛筆ラフ（デフォルト）",
    render:
      "Rendered as a rough pencil storyboard sketch: monochrome graphite, loose confident linework, minimal hatching for shadow, the kind of frame a director draws for a shooting board.",
    description: "コンテとして最も読みやすい",
  },
  gray_cinematic: {
    key: "gray_cinematic",
    label: "グレー・シネマティック",
    render:
      "Rendered as a grayscale digital painting in a film storyboard style: soft tonal shading, clear silhouettes, cinematic value structure.",
    description: "映画コンテ風のグレースケール",
  },
  anime_layout: {
    key: "anime_layout",
    label: "アニメレイアウト",
    render:
      "Rendered as an anime key-frame layout: clean line art, minimal flat shading, production-drawing feel.",
    description: "アニメ原画ラフ風",
  },
  ink_manga: {
    key: "ink_manga",
    label: "漫画ペン画",
    render:
      "Rendered as black-and-white manga ink art: confident pen lines, screentone shading, high contrast.",
    description: "モノクロ漫画・ペン画風",
  },
  watercolor: {
    key: "watercolor",
    label: "水彩",
    render:
      "Rendered as a soft watercolor illustration: gentle color bleeding, visible paper texture, airy light.",
    description: "やわらかい水彩イラスト",
  },
  flat_vector: {
    key: "flat_vector",
    label: "フラットイラスト",
    render:
      "Rendered as a flat vector illustration: bold simple shapes, limited palette, clean geometric composition.",
    description: "フラットデザイン・ベクター風",
  },
  rich_color: {
    key: "rich_color",
    label: "質感フルカラー",
    render:
      "Rendered as a fully colored, richly textured illustration: painterly light and shadow, detailed background, finished-quality artwork.",
    description: "質感のあるフルカラーイラスト（仕上げ寄り）",
  },
  cg_3d: {
    key: "cg_3d",
    label: "3DCG",
    render:
      "Rendered as a 3D CG still: soft global illumination, physically based materials, cinematic lighting.",
    description: "3DCGレンダリング風",
  },
  cinematic_photo: {
    key: "cinematic_photo",
    label: "シネマティック実写風",
    render:
      "Rendered as a photorealistic cinematic film still: natural film lighting, subtle color grading, high detail.",
    description: "実写映画のスチル風（肖像権に配慮して使用）",
  },
};

export const DEFAULT_STYLE: StylePresetKey = "pencil_rough";

/** 制約段落（文字焼き込み防止）の既定文 */
export const NO_TEXT_CONSTRAINT =
  "The image contains no text, letters, captions, subtitles, logos or watermarks.";

/** 文字混入時のリカバリ用・強調版 */
export const NO_TEXT_EMPHASIS =
  "IMPORTANT: the image must contain absolutely no text, letters, captions, subtitles, logos or watermarks anywhere.";

function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * キャラクターのプロンプト文を作る。
 * 表示名（実名の可能性がある）は使わず、キー + 記述文のみを使う。
 * 参照画像を添付する場合は @refN 対応を明示する（/api/generate が @refN ラベルを付ける）
 */
export function characterSentence(c: CharacterSheet, refIndex: number | null): string {
  const desc = c.descriptionEn?.trim() || c.descriptionJa.trim();
  const base = desc ? `${c.key} is ${desc}.` : `${c.key} appears in this shot.`;
  if (refIndex !== null) {
    return `${base} Keep exactly the same face, hairstyle and outfit as reference image @ref${refIndex + 1}.`;
  }
  return base;
}

/** ショット段落（サイズ/アングル/構図/レンズ）を組み立てる。全未指定なら標準の目線ミディアム */
function buildShotParagraph(cut: Pick<Cut, "shotSize" | "camera" | "composition" | "lens">): string {
  const sizePhrase = cut.shotSize ? SHOT_SIZE_PHRASES[cut.shotSize] : "a medium shot";
  const cameraPhrase = cut.camera ? CAMERA_PHRASES[cut.camera] : "at eye level";
  let sentence = `${capitalize(sizePhrase)} ${cameraPhrase}`;
  if (cut.composition) sentence += `, composed with ${COMPOSITION_PHRASES[cut.composition]}`;
  sentence += ".";
  if (cut.lens) sentence += ` ${capitalize(LENS_PHRASES[cut.lens])}.`;
  return sentence;
}

/** 舞台設定段落（シーン規定/場所/時間帯/照明）。どれも無ければ段落自体を省く */
function buildSettingParagraph(
  cut: Pick<Cut, "location" | "timeOfDay" | "lighting">,
  sceneText?: string
): string | undefined {
  const parts: string[] = [];
  if (sceneText) parts.push(`Setting: ${sceneText}.`);
  const locTime = [cut.location?.trim(), cut.timeOfDay?.trim()].filter(Boolean).join(", ");
  if (locTime) parts.push(`Location: ${locTime}.`);
  if (cut.lighting) parts.push(`${capitalize(LIGHTING_PHRASES[cut.lighting])}.`);
  return parts.length ? parts.join(" ") : undefined;
}

/**
 * レイアウト段落（手書きスケッチを @inN として添付した場合のみ）。Shot段落の直後に置く。
 * strict = 構図・配置を厳密に再現 / loose = 大まかな参考として扱う
 */
function buildLayoutParagraph(
  sketchInputIndex: number | null | undefined,
  sketchStrength: Cut["sketchStrength"]
): string | undefined {
  if (sketchInputIndex == null) return undefined;
  const n = sketchInputIndex + 1;
  if (sketchStrength === "loose") {
    return `Use input image @in${n} as a loose composition reference: keep the general framing and where the subjects are placed, but you may refine poses, proportions and details.`;
  }
  return `Use input image @in${n} as the layout guide: reproduce its composition, camera framing, and the placement, scale and poses of every subject faithfully. It is a rough hand-drawn sketch — keep its framing exactly, but render a finished image in the style described below, adding detail, materials and light.`;
}

/** 補足段落（ポーズ/背景/感情ヒント）。どれも無ければ段落自体を省く */
function buildNotesParagraph(cut: Pick<Cut, "poseNote" | "backgroundNote" | "emotionHint">): string | undefined {
  const parts: string[] = [];
  if (cut.poseNote?.trim()) parts.push(`Pose: ${cut.poseNote.trim()}.`);
  if (cut.backgroundNote?.trim()) parts.push(`Background: ${cut.backgroundNote.trim()}.`);
  if (cut.emotionHint?.trim()) parts.push(`Mood: ${cut.emotionHint.trim()}.`);
  return parts.length ? parts.join(" ") : undefined;
}

export interface BuildPromptOptions {
  cut: Cut;
  /** カットに登場するキャラ（cut.characters の順） */
  characters: CharacterSheet[];
  /** 参照画像として添付するキャラのキー（添付順 = @refN の順） */
  referenceKeys: string[];
  /**
   * カットが所属するシーン（共通の舞台設定）。
   * シーン内の全カットに同じ記述を入れて背景・時間帯・雰囲気を揃える
   */
  scene?: Scene | null;
  style: StylePresetKey;
  /**
   * プロジェクト共通のスタイル記述（自由記述 + トーン参照画像の言語化結果）。
   * 全カットに同一の文字列を渡すことで絵のトーンを揃える
   */
  styleText?: string;
  /** トーン参照画像を @refN として添付した場合のインデックス（0始まり） */
  styleRefIndex?: number | null;
  /** スケッチを入力画像として添付した場合の @inN インデックス（0始まり）。null = 添付なし */
  sketchInputIndex?: number | null;
  /** 修正指示の対象（直前の生成画像）を入力画像として添付した場合の @inN インデックス。null = 添付なし */
  revisionInputIndex?: number | null;
  /** 避けたい要素。"Do not include: ..." として埋め込む */
  negativeText?: string;
  /** 修正指示を含めるか（再生成時） */
  includeEditNote?: boolean;
  /** 文字混入リカバリ: no text を強調する */
  emphasizeNoText?: boolean;
  /**
   * AIチェック(QA)の指摘から再生成に足す英語1文（自動リトライ用）。
   * editNote とは独立した段落として付与する（editNoteは汚さない）
   */
  extraRevision?: string;
}

/**
 * 最終プロンプトを組み立てる。
 * 段落を空行(\n\n)で区切った英語の自然文にする。空の要素は段落ごと省略する。
 * 英訳（promptEn）が未取得の場合はト書き原文で代替する（Geminiは日本語も解釈可能）
 */
export function buildCutPrompt(opts: BuildPromptOptions): string {
  const { cut, characters, referenceKeys, style } = opts;

  const shotParagraph = buildShotParagraph(cut);
  const layoutParagraph = buildLayoutParagraph(opts.sketchInputIndex, cut.sketchStrength);
  const action = cut.promptEn?.trim() || cut.textJa.trim();

  const charParts = characters.map((c) => {
    const refIndex = referenceKeys.indexOf(c.key);
    return characterSentence(c, refIndex >= 0 ? refIndex : null);
  });
  const charactersParagraph = charParts.length ? charParts.join(" ") : undefined;

  const sceneText = opts.scene
    ? opts.scene.sceneEn?.trim() || opts.scene.descriptionJa?.trim() || undefined
    : undefined;
  const settingParagraph = buildSettingParagraph(cut, sceneText);
  const notesParagraph = buildNotesParagraph(cut);

  const preset = STYLE_PRESETS[style];
  const styleParts = [preset.render];
  // styleText はカンマ区切りの句の連結（文の体裁ではない）ため、
  // 末尾の句読点・空白を落としたうえで1つの完結した文に包む
  const styleTextSentence = opts.styleText?.trim().replace(/[.\s]+$/, "");
  if (styleTextSentence) styleParts.push(`Overall look: ${styleTextSentence}.`);
  if (opts.styleRefIndex != null) {
    styleParts.push(
      `Match the overall tone, palette, texture and rendering of reference image @ref${opts.styleRefIndex + 1} (use it only as a style reference; do not copy its subjects).`
    );
  }
  const styleParagraph = styleParts.join(" ");

  const constraintParts = [opts.emphasizeNoText ? NO_TEXT_EMPHASIS : NO_TEXT_CONSTRAINT];
  if (opts.negativeText?.trim()) {
    constraintParts.push(`Do not include: ${opts.negativeText.trim()}.`);
  }
  const constraintsParagraph = constraintParts.join(" ");

  const paragraphs = [
    shotParagraph,
    layoutParagraph,
    action,
    charactersParagraph,
    settingParagraph,
    notesParagraph,
    styleParagraph,
    constraintsParagraph,
  ].filter((p): p is string => !!p && p.trim().length > 0);

  let prompt = paragraphs.join("\n\n");

  // 修正指示(editNote)とQA指摘(extraRevision)は独立した段落として扱う。
  // editNoteはユーザーの手入力なので上書きせず、両方あれば両方付与する
  const revisionParagraphs: string[] = [];
  if (opts.includeEditNote && cut.editNote?.trim()) {
    const target =
      opts.revisionInputIndex != null
        ? `input image @in${opts.revisionInputIndex + 1}`
        : "the previous image";
    revisionParagraphs.push(`Revision request (apply to ${target}): ${cut.editNote.trim()}`);
  }
  if (opts.extraRevision?.trim()) {
    revisionParagraphs.push(`Fix for this attempt: ${opts.extraRevision.trim()}`);
  }
  if (revisionParagraphs.length) {
    prompt += `\n\n${revisionParagraphs.join("\n\n")}`;
  }
  return prompt;
}

/** キャラシート（立ち姿基準画像）生成用プロンプト */
export function buildCharacterSheetPrompt(
  c: CharacterSheet,
  style: StylePresetKey,
  styleText?: string,
  negativeText?: string
): string {
  const desc = c.descriptionEn?.trim() || c.descriptionJa.trim() || c.key;
  const preset = STYLE_PRESETS[style];
  const parts = [
    "A character reference sheet of a single character: full body, standing, front view, neutral expression, plain white background.",
    `${desc}.`,
    styleText?.trim(),
    preset.render,
    negativeText?.trim() ? `Do not include: ${negativeText.trim()}.` : undefined,
    NO_TEXT_CONSTRAINT,
  ].filter((p): p is string => !!p);
  return parts.join(" ");
}

/** プロジェクト共通のスタイル記述（言語化済みトーン + 自由記述） */
export function projectStyleText(p: StoryboardProject): string | undefined {
  const text = [p.styleImageEn, p.styleNotes]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(", ");
  return text || undefined;
}

/**
 * カット生成用の BuildPromptOptions を組み立てる（純粋関数。アセットの実ロードはしない）。
 * styleRefIndex は「参照画像を持つキャラ数」を基にした見積もりで、
 * 実際のアセットロード結果（読み込み失敗で枚数が変わる場合がある）は
 * 呼び出し側（generateOne）で上書きする
 */
export function cutPromptOptions(
  p: StoryboardProject,
  cut: Cut,
  extra?: { includeEditNote?: boolean; emphasizeNoText?: boolean; extraRevision?: string }
): BuildPromptOptions {
  const characters = p.characters.filter((c) => cut.characters.includes(c.key));
  const refChars = characters.filter((c) => c.imageAssetId);
  const styleRefIndex =
    p.attachStyleImage !== false && p.styleImageAssetId ? refChars.length : null;

  // スケッチ・修正参照画像の見積もり(実際のアセットロード結果は generateOne 側で上書きする)
  const sketchInputIndex = cut.sketchAssetId ? 0 : null;
  const revisionInputIndex =
    extra?.includeEditNote && cut.editNote?.trim() && cut.resultAssetId
      ? cut.sketchAssetId
        ? 1
        : 0
      : null;

  return {
    cut,
    characters,
    referenceKeys: refChars.map((c) => c.key),
    scene: (p.scenes ?? []).find((s) => s.id === cut.sceneId) ?? null,
    style: p.stylePreset,
    styleText: projectStyleText(p),
    styleRefIndex,
    sketchInputIndex,
    revisionInputIndex,
    negativeText: p.negativePrompt,
    includeEditNote: extra?.includeEditNote,
    emphasizeNoText: extra?.emphasizeNoText,
    extraRevision: extra?.extraRevision,
  };
}

/** 生成前に「実際に送信されるプロンプト」を確認するための純粋関数 */
export function previewCutPrompt(p: StoryboardProject, cut: Cut): string {
  return buildCutPrompt(cutPromptOptions(p, cut));
}

/**
 * アップロードした顔写真（@in1）から立ち姿の基準画像を作るプロンプト。
 * 顔の同一性を保ったままプロジェクトのスタイルに変換する
 */
export function buildStandingFromFacePrompt(
  c: CharacterSheet,
  style: StylePresetKey,
  styleText?: string,
  negativeText?: string
): string {
  const desc = c.descriptionEn?.trim() || c.descriptionJa.trim() || "";
  const preset = STYLE_PRESETS[style];
  const parts = [
    "Using the person in input image @in1, draw the exact same person (same face, same hairstyle) as a character reference sheet: full body, standing, front view, neutral expression, plain white background.",
    desc ? `${desc}.` : undefined,
    styleText?.trim(),
    preset.render,
    negativeText?.trim() ? `Do not include: ${negativeText.trim()}.` : undefined,
    NO_TEXT_CONSTRAINT,
  ].filter((p): p is string => !!p);
  return parts.join(" ");
}
