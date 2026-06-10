"use client";

import React from "react";
import { Handle, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { MODELS, getModel } from "@/lib/pricing";
import { makeThumbnail } from "@/lib/image";
import type {
  GenerateNodeData,
  InputNodeData,
  OutputNodeData,
  PromptNodeData,
  ReferenceNodeData,
} from "@/lib/flow/types";
import type { ImageItem, ResultImage } from "@/lib/types";
import { useFlowCtx } from "@/components/flow/context";

const COLORS = {
  input: "#f59e0b",
  prompt: "#a78bfa",
  reference: "#38bdf8",
  generate: "#34d399",
  output: "#fb7185",
};

function NodeShell({
  title,
  color,
  onDelete,
  children,
}: {
  title: string;
  color: string;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative w-[264px] rounded-lg border bg-zinc-900/95 text-zinc-100 shadow-lg"
      style={{ borderColor: color }}
    >
      <div
        className="flex items-center justify-between rounded-t-lg px-2 py-1.5 text-xs font-semibold"
        style={{ background: `${color}22` }}
      >
        <span style={{ color }}>{title}</span>
        <button onClick={onDelete} className="nodrag text-zinc-500 hover:text-red-400">
          ×
        </button>
      </div>
      <div className="p-2">{children}</div>
    </div>
  );
}

function HandleLabel({ text, top, side }: { text: string; top: number; side: "left" | "right" }) {
  return (
    <span
      className="pointer-events-none absolute text-[9px] text-zinc-500"
      style={{ top: top - 6, [side]: 10 } as React.CSSProperties}
    >
      {text}
    </span>
  );
}

// ---------- 入力 ----------
export function InputNode({ id, data }: NodeProps<Node<InputNodeData>>) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { openPicker } = useFlowCtx();
  const pick = () =>
    openPicker(false, async (items: ImageItem[]) => {
      const it = items[0];
      if (!it) return;
      const thumbUrl = await makeThumbnail(it.dataUrl, 220);
      updateNodeData(id, { imageId: it.id, dataUrl: it.dataUrl, thumbUrl, name: it.name });
    });
  return (
    <NodeShell title="① 画像入力" color={COLORS.input} onDelete={() => deleteElements({ nodes: [{ id }] })}>
      {data.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.thumbUrl} alt={data.name} className="mb-2 aspect-square w-full rounded object-cover" />
      ) : (
        <div className="mb-2 flex aspect-square w-full items-center justify-center rounded border border-dashed border-zinc-700 text-[11px] text-zinc-600">
          未選択
        </div>
      )}
      <button onClick={pick} className="nodrag w-full rounded bg-zinc-800 py-1 text-xs hover:bg-zinc-700">
        {data.thumbUrl ? "変更" : "ライブラリから選択"}
      </button>
      <Handle type="source" position={Position.Right} id="image" style={{ top: 26 }} />
    </NodeShell>
  );
}

// ---------- プロンプト ----------
export function PromptNode({ id, data }: NodeProps<Node<PromptNodeData>>) {
  const { updateNodeData, deleteElements } = useReactFlow();
  return (
    <NodeShell title="② プロンプト" color={COLORS.prompt} onDelete={() => deleteElements({ nodes: [{ id }] })}>
      <textarea
        value={data.template}
        onChange={(e) => updateNodeData(id, { template: e.target.value })}
        placeholder="例: a portrait, wearing {red|blue|black} jacket, {smiling|serious}"
        className="nodrag nowheel min-h-[70px] w-full resize-y rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-violet-400/60"
      />
      <p className="mt-1 text-[9px] text-zinc-500">
        <code className="text-violet-300">{"{a|b|c}"}</code> は実行ごとにランダム選択
      </p>
      {data.lastResolved && (
        <p className="mt-1 rounded bg-zinc-800/60 px-1.5 py-1 text-[10px] text-zinc-300">→ {data.lastResolved}</p>
      )}
      <Handle type="source" position={Position.Right} id="text" style={{ top: 26 }} />
    </NodeShell>
  );
}

// ---------- 参照セット ----------
export function ReferenceNode({ id, data }: NodeProps<Node<ReferenceNodeData>>) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { openPicker } = useFlowCtx();
  const items = data.items || [];
  const add = () =>
    openPicker(true, async (picked: ImageItem[]) => {
      const newItems = await Promise.all(
        picked.map(async (it) => ({
          imageId: it.id,
          dataUrl: it.dataUrl,
          thumbUrl: await makeThumbnail(it.dataUrl, 140),
          name: it.name,
          weight: 1,
        }))
      );
      updateNodeData(id, { items: [...items, ...newItems] });
    });
  const setWeight = (idx: number, w: number) => {
    const next = items.map((it, i) => (i === idx ? { ...it, weight: w } : it));
    updateNodeData(id, { items: next });
  };
  const remove = (idx: number) => updateNodeData(id, { items: items.filter((_, i) => i !== idx) });

  return (
    <NodeShell title="③ 参照セット（確率選択）" color={COLORS.reference} onDelete={() => deleteElements({ nodes: [{ id }] })}>
      <div className="nowheel max-h-44 space-y-1 overflow-y-auto">
        {items.length === 0 && <p className="py-2 text-center text-[11px] text-zinc-600">参照画像を追加</p>}
        {items.map((it, idx) => (
          <div
            key={it.imageId + idx}
            className={`flex items-center gap-1.5 rounded p-1 ${
              data.lastPicked?.includes(it.imageId) ? "bg-sky-400/15" : "bg-zinc-800/40"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.thumbUrl} alt={it.name} className="h-9 w-9 rounded object-cover" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[10px] text-zinc-400">{it.name}</div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-zinc-500">重み</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={it.weight}
                  onChange={(e) => setWeight(idx, Number(e.target.value))}
                  className="nodrag w-12 rounded border border-zinc-700 bg-zinc-950 px-1 text-[10px]"
                />
              </div>
            </div>
            <button onClick={() => remove(idx)} className="nodrag text-zinc-500 hover:text-red-400">
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <button onClick={add} className="nodrag flex-1 rounded bg-zinc-800 py-1 text-[11px] hover:bg-zinc-700">
          ＋画像を追加
        </button>
        <label className="flex items-center gap-1 text-[10px] text-zinc-400">
          毎回
          <input
            type="number"
            min={1}
            value={data.pickCount}
            onChange={(e) => updateNodeData(id, { pickCount: Math.max(1, Number(e.target.value)) })}
            className="nodrag w-10 rounded border border-zinc-700 bg-zinc-950 px-1 text-[10px]"
          />
          枚
        </label>
      </div>
      <Handle type="source" position={Position.Right} id="reference" style={{ top: 26 }} />
    </NodeShell>
  );
}

// ---------- 生成 ----------
export function GenerateNode({ id, data }: NodeProps<Node<GenerateNodeData>>) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { preview } = useFlowCtx();
  const model = getModel(data.modelKey);

  const onModel = (key: string) => {
    const m = getModel(key);
    const ar = m.aspectRatios.includes(data.aspectRatio) ? data.aspectRatio : m.aspectRatios[0];
    updateNodeData(id, { modelKey: key, aspectRatio: ar });
  };

  return (
    <NodeShell title="④ 生成" color={COLORS.generate} onDelete={() => deleteElements({ nodes: [{ id }] })}>
      <HandleLabel text="入力" top={30} side="left" />
      <Handle type="target" position={Position.Left} id="image" style={{ top: 30 }} />
      <HandleLabel text="参照" top={58} side="left" />
      <Handle type="target" position={Position.Left} id="reference" style={{ top: 58 }} />
      <HandleLabel text="文" top={86} side="left" />
      <Handle type="target" position={Position.Left} id="text" style={{ top: 86 }} />

      <input
        value={data.label}
        onChange={(e) => updateNodeData(id, { label: e.target.value })}
        className="nodrag mb-1.5 w-full rounded bg-transparent text-xs font-semibold text-zinc-200 outline-none"
      />
      <select
        value={data.modelKey}
        onChange={(e) => onModel(e.target.value)}
        className="nodrag mb-1 w-full rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-[11px]"
      >
        {Object.values(MODELS).map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>
      <div className="mb-1 flex gap-1">
        <select
          value={data.aspectRatio}
          onChange={(e) => updateNodeData(id, { aspectRatio: e.target.value })}
          className="nodrag flex-1 rounded border border-zinc-700 bg-zinc-950 px-1 py-1 text-[11px]"
        >
          {model.aspectRatios.map((ar) => (
            <option key={ar} value={ar}>
              {ar}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[10px] text-zinc-400">
          ×
          <input
            type="number"
            min={1}
            max={8}
            value={data.count}
            onChange={(e) => updateNodeData(id, { count: Math.min(8, Math.max(1, Number(e.target.value))) })}
            className="nodrag w-10 rounded border border-zinc-700 bg-zinc-950 px-1 text-[11px]"
          />
        </label>
      </div>
      <textarea
        value={data.promptOverride || ""}
        onChange={(e) => updateNodeData(id, { promptOverride: e.target.value })}
        placeholder="固定プロンプト（文入力が未接続のとき使用）"
        className="nodrag nowheel min-h-[44px] w-full resize-y rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-emerald-400/60"
      />

      {data.status === "running" && (
        <p className="mt-1 animate-pulse text-[11px] text-emerald-300">生成中…</p>
      )}
      {data.status === "error" && (
        <p className="mt-1 rounded bg-red-500/10 px-1.5 py-1 text-[10px] text-red-300">⚠ {data.error}</p>
      )}
      {data.results && data.results.length > 0 && (
        <>
          <div className="mt-1.5 grid grid-cols-3 gap-1">
            {data.results.map((r) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={r.id}
                src={r.thumbUrl || r.dataUrl}
                alt="r"
                onClick={() => preview(r)}
                className="nodrag aspect-square w-full cursor-zoom-in rounded object-cover"
              />
            ))}
          </div>
          <p className="mt-1 text-[9px] text-zinc-500">
            ${(data.costUsd ?? 0).toFixed(3)} ・ {((data.durationMs ?? 0) / 1000).toFixed(1)}s
          </p>
        </>
      )}
      <Handle type="source" position={Position.Right} id="image" style={{ top: 30 }} />
    </NodeShell>
  );
}

// ---------- 出力 ----------
export function OutputNode({
  id,
  data,
}: NodeProps<Node<OutputNodeData & { onContactSheet?: (r: ResultImage[]) => void }>>) {
  const { deleteElements } = useReactFlow();
  const { preview } = useFlowCtx();
  const results = data.results || [];
  return (
    <NodeShell title="⑤ 出力" color={COLORS.output} onDelete={() => deleteElements({ nodes: [{ id }] })}>
      <HandleLabel text="画像" top={30} side="left" />
      <Handle type="target" position={Position.Left} id="image" style={{ top: 30 }} />
      {results.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-zinc-600">生成ノードを接続して実行</p>
      ) : (
        <div className="nowheel grid max-h-48 grid-cols-3 gap-1 overflow-y-auto">
          {results.map((r) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={r.id}
              src={r.thumbUrl || r.dataUrl}
              alt="o"
              onClick={() => preview(r)}
              className="nodrag aspect-square w-full cursor-zoom-in rounded object-cover"
            />
          ))}
        </div>
      )}
      <p className="mt-1 text-center text-[10px] text-zinc-500">{results.length} 枚（下のツールバーで書き出し）</p>
    </NodeShell>
  );
}

export const nodeTypes = {
  input: InputNode,
  prompt: PromptNode,
  reference: ReferenceNode,
  generate: GenerateNode,
  output: OutputNode,
};
