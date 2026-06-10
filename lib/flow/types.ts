// ノードワークフローの型定義

import type { ResultImage } from "@/lib/types";

export type FlowNodeKind = "input" | "prompt" | "reference" | "generate" | "output";

/** 画像入力ノード: ライブラリ(プール)の画像を1枚出力 */
export interface InputNodeData {
  // React Flow の Node<T> は T extends Record<string, unknown> を要求する
  [key: string]: unknown;
  kind: "input";
  label: string;
  imageId?: string;
  /** 表示用サムネ */
  thumbUrl?: string;
  /** 送信用フル画像 */
  dataUrl?: string;
  name?: string;
}

/** プロンプトノード: 可変スロット {a|b|c} を含むテンプレート。出力はテキスト */
export interface PromptNodeData {
  [key: string]: unknown;
  kind: "prompt";
  label: string;
  template: string;
  /** 直近の実行で展開された結果(プレビュー用) */
  lastResolved?: string;
}

export interface RefItem {
  imageId: string;
  thumbUrl: string;
  dataUrl: string;
  name: string;
  weight: number;
}

/** 参照セットノード: 重み付きで pickCount 枚を確率選択して出力 */
export interface ReferenceNodeData {
  [key: string]: unknown;
  kind: "reference";
  label: string;
  items: RefItem[];
  pickCount: number;
  /** 直近の実行で選ばれたID(プレビュー用) */
  lastPicked?: string[];
}

/** 生成ノード: 入力画像＋参照画像＋プロンプトから画像を生成 */
export interface GenerateNodeData {
  [key: string]: unknown;
  kind: "generate";
  label: string;
  modelKey: string;
  aspectRatio: string;
  count: number;
  /** プロンプト入力が未接続のときに使う固定プロンプト */
  promptOverride?: string;
  // --- 実行結果(プレビュー/受け渡し用) ---
  results?: ResultImage[];
  status?: "idle" | "running" | "done" | "error";
  error?: string;
  costUsd?: number;
  durationMs?: number;
  /** この実行で実際に使われたプロンプト(履歴) */
  usedPrompt?: string;
}

/** 出力ノード: 上流の結果を集約(コンタクトシート/Zip/ライブラリ保存) */
export interface OutputNodeData {
  [key: string]: unknown;
  kind: "output";
  label: string;
  results?: ResultImage[];
}

export type FlowNodeData =
  | InputNodeData
  | PromptNodeData
  | ReferenceNodeData
  | GenerateNodeData
  | OutputNodeData;

/** 保存されるワークフロー */
export interface SavedWorkflow {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodes: unknown[]; // React Flow ノード(シリアライズ済)
  edges: unknown[];
}
