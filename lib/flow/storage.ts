// ワークフローの保存/読込・エクスポート/インポート

import type { Edge, Node } from "@xyflow/react";
import * as db from "@/lib/db";
import { getModel } from "@/lib/pricing";
import type { FlowNodeData, GenerateNodeData, SavedWorkflow } from "@/lib/flow/types";

const EXPORT_VERSION = 1;

/** エクスポートJSON（受け渡し・再現用）。結果やステータスは落として軽量化 */
export interface WorkflowExport {
  app: "nanobanana-lab-flow";
  version: number;
  name: string;
  exportedAt: number;
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
}

/** 実行結果やステータスを除いた、設計情報だけのノードに整える */
function sanitizeNodes(nodes: Node<FlowNodeData>[]): Node<FlowNodeData>[] {
  return nodes.map((n) => {
    const data = { ...n.data } as FlowNodeData & Record<string, unknown>;
    if (data.kind === "generate" || data.kind === "cgenerate") {
      // 実行時フィールドは落とす。制御パラメータと usedSeed は再現用に残す。
      delete (data as Partial<GenerateNodeData>).results;
      delete (data as Partial<GenerateNodeData>).status;
      delete (data as Partial<GenerateNodeData>).error;
      delete (data as Partial<GenerateNodeData>).costUsd;
      delete (data as Partial<GenerateNodeData>).durationMs;
      delete (data as Partial<GenerateNodeData>).usedPrompt;
    }
    if (data.kind === "output") delete (data as { results?: unknown }).results;
    if (data.kind === "prompt") delete (data as { lastResolved?: unknown }).lastResolved;
    if (data.kind === "reference") delete (data as { lastPicked?: unknown }).lastPicked;
    return { ...n, data: data as FlowNodeData, selected: false };
  });
}

export function buildExport(
  name: string,
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  now: number
): WorkflowExport {
  return {
    app: "nanobanana-lab-flow",
    version: EXPORT_VERSION,
    name,
    exportedAt: now,
    nodes: sanitizeNodes(nodes),
    edges: edges.map((e) => ({ ...e, selected: false })),
  };
}

export function parseImport(text: string): WorkflowExport {
  const obj = JSON.parse(text) as WorkflowExport;
  if (obj.app !== "nanobanana-lab-flow" || !Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    throw new Error("対応していないワークフローファイルです。");
  }
  return obj;
}

/** 人が読む手順書(Markdown)。実装チームへの共有用 */
export function buildMarkdownSpec(
  name: string,
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lines: string[] = [];
  lines.push(`# ワークフロー: ${name || "(無題)"}`);
  lines.push("");
  lines.push(`- ノード数: ${nodes.length} / 接続数: ${edges.length}`);
  lines.push("");

  const gens = nodes.filter((n) => n.data.kind === "generate");
  lines.push(`## 生成ステージ (${gens.length})`);
  gens.forEach((n, i) => {
    const d = n.data as GenerateNodeData;
    const m = getModel(d.modelKey);
    const ups = edges
      .filter((e) => e.target === n.id)
      .map((e) => {
        const s = byId.get(e.source);
        return s ? `${s.data.label || s.data.kind}(${e.targetHandle || "image"})` : e.source;
      });
    lines.push("");
    lines.push(`### ${i + 1}. ${d.label}`);
    lines.push(`- モデル: ${m.label} / 比率: ${d.aspectRatio} / 枚数: ${d.count}`);
    if (d.promptOverride) lines.push(`- 固定プロンプト: ${d.promptOverride}`);
    lines.push(`- 入力: ${ups.length ? ups.join(", ") : "(なし)"}`);
  });

  const cgens = nodes.filter((n) => n.data.kind === "cgenerate");
  if (cgens.length) {
    lines.push("");
    lines.push(`## 制御生成ステージ (${cgens.length})`);
    cgens.forEach((n, i) => {
      const d = n.data as {
        label: string;
        modelKey: string;
        aspectRatio: string;
        count: number;
        controlType: string;
        identityStrength: number;
        controlStrength: number;
        styleStrength: number;
        steps: number;
        fixedSeed: boolean;
        seed: number | null;
        usedSeed?: number;
        promptOverride?: string;
      };
      const m = getModel(d.modelKey);
      const ups = edges
        .filter((e) => e.target === n.id)
        .map((e) => {
          const s = byId.get(e.source);
          return s ? `${s.data.label || s.data.kind}(${e.targetHandle || "image"})` : e.source;
        });
      lines.push("");
      lines.push(`### ${i + 1}. ${d.label}`);
      lines.push(`- モデル: ${m.label} / 比率: ${d.aspectRatio} / 枚数: ${d.count} / 制御: ${d.controlType}`);
      lines.push(
        `- 強度 同一性:${d.identityStrength} 姿勢:${d.controlStrength} 画風:${d.styleStrength} / steps:${d.steps}`
      );
      lines.push(`- seed: ${d.fixedSeed ? `固定 ${d.seed}` : `ランダム（直近 ${d.usedSeed ?? "—"}）`}`);
      if (d.promptOverride) lines.push(`- 固定プロンプト: ${d.promptOverride}`);
      lines.push(`- 入力: ${ups.length ? ups.join(", ") : "(なし)"}`);
    });
  }

  const prompts = nodes.filter((n) => n.data.kind === "prompt");
  if (prompts.length) {
    lines.push("");
    lines.push("## プロンプト（可変スロット {a|b|c} はランダム選択）");
    prompts.forEach((n) => {
      const d = n.data as { label: string; template: string };
      lines.push(`- **${d.label}**: ${d.template}`);
    });
  }

  const refs = nodes.filter((n) => n.data.kind === "reference");
  if (refs.length) {
    lines.push("");
    lines.push("## 参照セット（重み付き確率選択）");
    refs.forEach((n) => {
      const d = n.data as { label: string; pickCount: number; items: { name: string; weight: number }[] };
      lines.push(`- **${d.label}** (毎回 ${d.pickCount} 枚選択)`);
      d.items.forEach((it) => lines.push(`  - ${it.name} … 重み ${it.weight}`));
    });
  }

  return lines.join("\n");
}

// --- IndexedDB ---
export async function listWorkflows(): Promise<SavedWorkflow[]> {
  const all = await db.getAll<SavedWorkflow>("workflows");
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveWorkflow(wf: SavedWorkflow): Promise<void> {
  await db.put("workflows", wf);
}

export async function deleteWorkflow(id: string): Promise<void> {
  await db.del("workflows", id);
}
