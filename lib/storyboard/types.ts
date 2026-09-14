// Storyboard(字コンテ→絵コンテ)機能の型定義

/** カメラアングル（高さ・視点）。ト書きの語彙から自動推定し、手動修正できる */
export type CameraAngle =
  | "eye_level"
  | "high_angle"
  | "low_angle"
  | "top_down"
  | "over_shoulder"
  | "pov"
  | "dutch";

export const CAMERA_LABELS: Record<CameraAngle, string> = {
  eye_level: "目線",
  high_angle: "ハイアングル",
  low_angle: "ローアングル",
  top_down: "真俯瞰",
  over_shoulder: "肩越し",
  pov: "POV(主観)",
  dutch: "ダッチアングル",
};

/** ショットサイズ（被写体との距離感） */
export type ShotSize =
  | "extreme_close_up"
  | "close_up"
  | "bust"
  | "waist"
  | "full_body"
  | "long"
  | "extreme_long";

export const SHOT_SIZE_LABELS: Record<ShotSize, string> = {
  extreme_close_up: "大写し",
  close_up: "寄り",
  bust: "バストアップ",
  waist: "ウエスト",
  full_body: "全身",
  long: "引き",
  extreme_long: "大引き",
};

/** 構図 */
export type Composition =
  | "rule_of_thirds"
  | "centered"
  | "symmetrical"
  | "diagonal"
  | "negative_space"
  | "frame_in_frame";

export const COMPOSITION_LABELS: Record<Composition, string> = {
  rule_of_thirds: "三分割",
  centered: "日の丸",
  symmetrical: "シンメトリー",
  diagonal: "対角線",
  negative_space: "余白活かし",
  frame_in_frame: "額縁構図",
};

/** 照明。ト書きの時間帯・光の手がかりから自動推定し、手動修正できる */
export type Lighting =
  | "soft_daylight"
  | "golden_hour"
  | "harsh_noon"
  | "overcast"
  | "backlit"
  | "window"
  | "night_street"
  | "low_key"
  | "high_key";

export const LIGHTING_LABELS: Record<Lighting, string> = {
  soft_daylight: "柔らかい自然光",
  golden_hour: "夕方・朝の斜光",
  harsh_noon: "真昼の硬い光",
  overcast: "曇天のフラット光",
  backlit: "逆光・リムライト",
  window: "室内の窓明かり",
  night_street: "夜の街灯・ネオン",
  low_key: "ローキー（暗く劇的）",
  high_key: "ハイキー（明るく軽い）",
};

/** レンズ・被写界深度。創作判断のため自動推定はしない */
export type Lens =
  | "wide_24"
  | "standard_35"
  | "normal_50"
  | "portrait_85"
  | "tele_135"
  | "macro";

export const LENS_LABELS: Record<Lens, string> = {
  wide_24: "24mm 広角・深い被写界深度",
  standard_35: "35mm 標準広角",
  normal_50: "50mm 標準",
  portrait_85: "85mm 中望遠・浅い被写界深度",
  tele_135: "135mm 望遠・圧縮効果",
  macro: "マクロ",
};

/**
 * オーバーレイの種類。
 * - NA: ナレーション（青字で画像上に重ねる）
 * - PROMPT_UI: `T：` 行。疑似チャットウィンドウ風に表示
 * - SE: 効果音ラベル
 * - DIALOGUE: セリフ。画像化・表示はしないが感情ヒントとして保持
 */
export type OverlayType = "NA" | "PROMPT_UI" | "SE" | "DIALOGUE";

/** オーバーレイ種別の表示ラベル（UI・シート出力共通） */
export const OVERLAY_LABELS: Record<OverlayType, string> = {
  NA: "NA",
  PROMPT_UI: "T",
  SE: "SE",
  DIALOGUE: "セリフ",
};

export interface Overlay {
  type: OverlayType;
  text: string;
  /** NA/DIALOGUE の話者名（表示名。プロンプトには渡さない） */
  speaker?: string;
}

export type CutStatus = "draft" | "queued" | "generating" | "done" | "error";

/**
 * シーン = 複数カットが共有する舞台設定（場所・時間帯・状況）。
 * ここに書いた内容はシーン内すべてのカットのプロンプトへ共通で反映され、
 * カット間の背景・ライティングのブレを抑える
 */
export interface Scene {
  id: string;
  /** 見出し（例: 朝の路地） */
  name: string;
  /** 共通のシーン規定（場所・時間帯・状況。日本語） */
  descriptionJa: string;
  /** assist で英訳したシーン記述（プロンプトに使用） */
  sceneEn?: string;
}

/** 1カット = 1画像 */
export interface Cut {
  id: string;
  /** ト書き原文（画の本体。カット生成の唯一のソース） */
  textJa: string;
  /** 秒数ヒント（表示用。生成には使わない） */
  durationHint: string;
  /** null = 未推定（生成時は eye_level 扱い） */
  camera: CameraAngle | null;
  /** ショットサイズ。null = 未指定 */
  shotSize?: ShotSize | null;
  /** 構図。null = 未指定 */
  composition?: Composition | null;
  /** 照明。null = 未指定（assistがト書きの手がかりから推定する場合がある） */
  lighting?: Lighting | null;
  /** レンズ・被写界深度。null = 未指定（創作判断のため自動推定はしない） */
  lens?: Lens | null;
  /** 被写体のポーズ指定（自由記述。プロンプトに Pose: として付与） */
  poseNote?: string;
  /** 背景の指定（自由記述。プロンプトに Background: として付与） */
  backgroundNote?: string;
  /** 所属シーン（StoryboardProject.scenes の id）。無所属も可 */
  sceneId?: string;
  overlays: Overlay[];
  /** 登場キャラクターのキー（CharacterSheet.key） */
  characters: string[];
  /** セリフから抽出した感情ヒント（英語。プロンプトに追記） */
  emotionHint?: string;

  // --- 翻訳結果（/api/storyboard/assist が埋める） ---
  /** 英訳済みのシーン+アクション記述（30語以内目安） */
  promptEn?: string;
  location?: string;
  timeOfDay?: string;

  /** 実際にAPIへ送った最終プロンプト（確認用） */
  generatedPrompt?: string;
  /** 修正指示（再生成時に追記） */
  editNote?: string;

  /** 生成画像（フル解像度は assets ストア、サムネはインライン保持） */
  resultAssetId?: string;
  thumbUrl?: string;
  status: CutStatus;
  error?: string;

  /**
   * 生成後のAIチェック(視覚モデルによる自己採点)結果。undefined = 未チェック。
   * /api/storyboard/qa の結果をそのまま保持する（qaVerdict で ok/warn/retry を判定）
   */
  qa?: {
    /** 画像内に文字・字幕・ロゴ・透かしがあるか */
    textDetected: boolean;
    /** ト書きの出来事が描かれているか(0-5) */
    actionMatch: number;
    /** 登場人物の人数・外見の一致度(0-5) */
    characterMatch: number;
    /** 指定スタイルらしさ(0-5) */
    styleMatch: number;
    /** 日本語の短い指摘（最大5件） */
    issues: string[];
    /** 再生成時にプロンプトへ足す英語1文（問題なければ空文字） */
    revisionHint: string;
    /** チェック実行時刻 */
    checkedAt: number;
    /** この結果が自動リトライ後のものか（true なら以降は自動リトライしない） */
    autoRetried: boolean;
  };
}

/** キャラシート。表示名 → プレースホルダー記述文 + 基準画像 */
export interface CharacterSheet {
  /** プロンプトに渡す安全なプレースホルダーキー（例: MAN_A, CAT_A） */
  key: string;
  /** 字コンテ上の表示名（例: 男、猫）。プロンプトには渡さない */
  displayName: string;
  /** プレースホルダー記述文（日本語） */
  descriptionJa: string;
  /** assist で英訳した記述文（プロンプトに使用） */
  descriptionEn?: string;
  /** 基準画像（立ち姿）。assets ストアのキー */
  imageAssetId?: string;
  thumbUrl?: string;
}

/** スタイルプリセットのキー */
export type StylePresetKey =
  | "pencil_rough"
  | "gray_cinematic"
  | "anime_layout"
  | "ink_manga"
  | "watercolor"
  | "flat_vector"
  | "rich_color"
  | "cg_3d"
  | "cinematic_photo";

export interface StoryboardProject {
  id: string;
  title: string;
  /** 左ペインの字コンテ原文 */
  scriptText: string;
  cuts: Cut[];
  /** シーン一覧（カットの sceneId が参照） */
  scenes?: Scene[];
  characters: CharacterSheet[];
  stylePreset: StylePresetKey;
  /** 共通スタイルの自由記述（全カットのプロンプトに追記。日本語可） */
  styleNotes?: string;
  /** トーン参照画像（assets ストアのキー）。全カット生成の参照に同梱できる */
  styleImageAssetId?: string;
  styleImageThumb?: string;
  /** トーン参照画像を視覚モデルで言語化した英語記述（全カットに反映） */
  styleImageEn?: string;
  /** トーン参照画像を参照画像として毎カットに添付するか（既定: true） */
  attachStyleImage?: boolean;
  /** 生成後にAIチェック(視覚モデルでの自己採点)を走らせるか（既定: true） */
  autoQa?: boolean;
  /** 避けたい要素（ネガティブ）。Geminiにはnegative_promptパラメータが無いため "Do not include: ..." としてプロンプトに埋め込む */
  negativePrompt?: string;
  modelKey: string;
  /** Google用: 出力解像度 ("1K"/"2K"/"4K")。未設定は "1K" 扱い。対応モデルのみ有効 */
  imageSize?: string;
  /**
   * 実在人名・実在IP語の辞書（プロジェクト単位）。
   * ここに載った語がプロンプトに含まれると送信をブロックする。
   */
  bannedNames: string[];
  createdAt: number;
  updatedAt: number;
}
