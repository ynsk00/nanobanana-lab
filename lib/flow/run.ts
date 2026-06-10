// ワークフロー実行エンジン（トポロジカル順に生成ノードを実行）と乱数ユーティリティ

import type { Edge, Node } from "@xyflow/react";
import type { ResultImage } from "@/lib/types";
import { requestGeneration } from "@/lib/generation";
import type { FlowNodeData, GenerateNodeData, ReferenceNodeData } from "@/lib/flow/types";

/** {a|b|c} 形式の可変スロットをランダムに1つ選んで展開する */
export function resolvePromptTemplate(template: string): string {
  return (template || "").replace(/\{([^{}]*)\}/g, (whole, body: string) => {
    if (!body.includes("|")) return whole; // パイプが無ければ素通し
    const opts = body
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (opts.length === 0) return "";
    return opts[Math.floor(Math.random() * opts.length)];
  });
}

/** 重み付きで k 個を非復元抽出 */
export function pickWeighted<T>(items: { item: T; weight: number }[], k: number): T[] {
  const pool = items.map((it) => ({ ...it, weight: Math.max(0, it.weight) || 0 }));
  const out: T[] = [];
  const n = Math.min(k, pool.length);
  for (let i = 0; i < n; i++) {
    const total = pool.reduce((s, p) => s + p.weight, 0);
    if (total <= 0) {
      // 重みが全て0なら等確率
      const idx = Math.floor(Math.random() * pool.length);
      out.push(pool[idx].item);
      pool.splice(idx, 1);
      continue;
    }
    let r = Math.random() * total;
    let idx = 0;
    for (let j = 0; j < pool.length; j++) {
      r -= pool[j].weight;
      if (r <= 0) {
        idx = j;
        break;
      }
    }
    out.push(pool[idx].item);
    pool.splice(idx, 1);
  }
  return out;
}

type FNode = Node<FlowNodeData>;

export interface RunContext {
  geminiKey: string;
  openaiKey: string;
  /** 実行結果のフル画像をassetsへ保存しサムネ化して ResultImage を返す */
  storeResults: (raw: ResultImage[]) => Promise<ResultImage[]>;
  /** ノードの data を部分更新（プレビュー・状態反映） */
  patchNode: (id: string, patch: Partial<FlowNodeData>) => void;
  /** 中断フラグ */
  isAborted?: () => boolean;
}

interface RunResult {
  ok: boolean;
  errors: string[];
}

/** ワークフローを実行する */
export async function runWorkflow(
  nodes: FNode[],
  edges: Edge[],
  ctx: RunContext
): Promise<RunResult> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // 実行中に各ノードが下流へ渡す「フル画像」を保持
  const imageOut = new Map<string, string[]>(); // nodeId -> full dataUrls
  const textOut = new Map<string, string>();
  const resultsOut = new Map<string, ResultImage[]>(); // generateノード -> 保存済み結果
  const errors: string[] = [];

  // 入力ノード・プロンプトノード・参照ノードの出力を先に確定
  for (const n of nodes) {
    const d = n.data;
    if (d.kind === "input" && d.dataUrl) {
      imageOut.set(n.id, [d.dataUrl]);
    } else if (d.kind === "prompt") {
      const resolved = resolvePromptTemplate(d.template);
      textOut.set(n.id, resolved);
      ctx.patchNode(n.id, { lastResolved: resolved });
    }
  }

  // 参照ノードは実行ごとに確率選択
  function resolveReference(node: FNode): string[] {
    const d = node.data as ReferenceNodeData;
    if (!d.items?.length) return [];
    const picked = pickWeighted(
      d.items.map((it) => ({ item: it, weight: it.weight })),
      Math.max(1, d.pickCount || 1)
    );
    ctx.patchNode(node.id, { lastPicked: picked.map((p) => p.imageId) });
    return picked.map((p) => p.dataUrl);
  }

  // 生成ノードの依存関係（画像edgeで上流に生成ノードがある場合）
  const generateNodes = nodes.filter((n) => n.data.kind === "generate");
  const incoming = (nodeId: string) => edges.filter((e) => e.target === nodeId);

  const done = new Set<string>();
  const remaining = new Set(generateNodes.map((n) => n.id));

  // トポロジカルに順次実行
  let guard = 0;
  while (remaining.size > 0) {
    if (ctx.isAborted?.()) {
      errors.push("中断されました");
      break;
    }
    guard++;
    if (guard > 1000) {
      errors.push("依存関係が解決できません（循環の可能性）");
      break;
    }

    // 依存（上流の生成ノード）がすべて完了しているノードを探す
    const ready: FNode[] = [];
    for (const id of remaining) {
      const ups = incoming(id)
        .map((e) => e.source)
        .filter((src) => byId.get(src)?.data.kind === "generate");
      if (ups.every((src) => done.has(src))) ready.push(byId.get(id)!);
    }
    if (ready.length === 0) {
      errors.push("実行できる生成ノードがありません（接続を確認してください）");
      break;
    }

    // 並列実行
    await Promise.all(
      ready.map(async (node) => {
        remaining.delete(node.id);
        const d = node.data as GenerateNodeData;
        ctx.patchNode(node.id, { status: "running", error: undefined });

        // 入力を解決
        const inEdges = incoming(node.id);
        const inputImages: string[] = [];
        const referenceImages: string[] = [];
        let prompt = d.promptOverride || "";

        for (const e of inEdges) {
          const src = byId.get(e.source);
          if (!src) continue;
          const handle = e.targetHandle || "image";
          if (handle === "text") {
            if (src.data.kind === "prompt") prompt = textOut.get(src.id) || prompt;
          } else if (handle === "reference") {
            if (src.data.kind === "reference") referenceImages.push(...resolveReference(src));
            else if (src.data.kind === "input" && (src.data as { dataUrl?: string }).dataUrl)
              referenceImages.push((src.data as { dataUrl: string }).dataUrl);
            else referenceImages.push(...(imageOut.get(src.id) || []));
          } else {
            // image
            if (src.data.kind === "reference") inputImages.push(...resolveReference(src));
            else inputImages.push(...(imageOut.get(src.id) || []));
          }
        }

        if (!prompt.trim() && inputImages.length === 0) {
          ctx.patchNode(node.id, {
            status: "error",
            error: "プロンプトまたは入力画像が必要です",
          });
          errors.push(`${d.label}: 入力不足`);
          done.add(node.id);
          return;
        }

        try {
          const data = await requestGeneration(
            {
              geminiKey: ctx.geminiKey,
              openaiKey: ctx.openaiKey,
              modelKey: d.modelKey,
              aspectRatio: d.aspectRatio,
              count: d.count,
              prompt,
            },
            inputImages,
            referenceImages
          );
          const stored = await ctx.storeResults(data.results);
          resultsOut.set(node.id, stored);
          // 下流へは最初の結果を画像として渡す（パイプライン）
          const forward = data.results
            .map((r) => r.dataUrl)
            .filter((x): x is string => !!x);
          imageOut.set(node.id, forward.length ? [forward[0]] : []);
          ctx.patchNode(node.id, {
            status: data.results.length ? "done" : "error",
            results: stored,
            costUsd: data.costUsd,
            durationMs: data.durationMs,
            usedPrompt: prompt,
            error: data.results.length ? undefined : data.errors.join(" / ") || "画像が返りませんでした",
          });
          if (!data.results.length) errors.push(`${d.label}: 画像が返りませんでした`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          ctx.patchNode(node.id, { status: "error", error: msg });
          errors.push(`${d.label}: ${msg}`);
          imageOut.set(node.id, []);
        } finally {
          done.add(node.id);
        }
      })
    );
  }

  // 出力ノードに上流結果を集約
  for (const n of nodes) {
    if (n.data.kind !== "output") continue;
    const collected: ResultImage[] = [];
    for (const e of incoming(n.id)) {
      const src = byId.get(e.source);
      if (src?.data.kind === "generate") {
        collected.push(...(resultsOut.get(src.id) || []));
      }
    }
    ctx.patchNode(n.id, { results: collected });
  }

  return { ok: errors.length === 0, errors };
}
