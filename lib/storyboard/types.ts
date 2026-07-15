// Storyboard(字コンテ→絵コンテ)機能の型定義

/** カメラ画角。ト書きの語彙から自動推定し、カット表で手動修正できる */
export type CameraAngle =
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

export const CAMERA_LABELS: Record<CameraAngle, string> = {
  top_down: "真俯瞰",
  high_angle: "ハイアングル",
  eye_level: "目線",
  low_angle: "ローアングル",
  close_up: "寄り",
  bust_shot: "バストアップ",
  full_shot: "全身",
  wide: "引き",
  over_shoulder: "肩越し",
  pov: "POV(主観)",
};

/**
 * オーバーレイの種類。
 * - NA: ナレーション（青字で画像上に重ねる）
 * - PROMPT_UI: `T：` 行。疑似チャットウィンドウ風に表示
 * - SE: 効果音ラベル
 * - DIALOGUE: セリフ。画像化・表示はしないが感情ヒントとして保持
 */
export type OverlayType = "NA" | "PROMPT_UI" | "SE" | "DIALOGUE";

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
  /** 高画質化・クオリティアップ用のプロンプト（全生成に付与。編集可） */
  qualityPrompt?: string;
  modelKey: string;
  /**
   * 実在人名・実在IP語の辞書（プロジェクト単位）。
   * ここに載った語がプロンプトに含まれると送信をブロックする。
   */
  bannedNames: string[];
  createdAt: number;
  updatedAt: number;
}
