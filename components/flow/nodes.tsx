"use client";

import React from "react";
import { Handle, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { MODELS, getModel } from "@/lib/pricing";
import { makeThumbnail } from "@/lib/image";
import type {
  ControlledGenerateNodeData,
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
  cgenerate: "#2dd4bf",
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

/** ノード左外側に置くハンドルのラベル */
function HandleLabel({ text, top }: { text: string; top: number }) {
  return (
    <span
      className="pointer-events-none absolute w-9 -translate-x-full pr-1.5 text-right text-[9px] text-zinc-500"
      style={{ top: top - 6, left: 0 }}
    >
      {text}
    </span>
  );
}

const HANDLE_COLOR: Record<string, string> = {
  image: "#34d399",
  reference: "#38bdf8",
  text: "#a78bfa",
  identity: "#f43f5e",
  control: "#f59e0b",
  style: "#e879f9",
};
type HandleType = "image" | "reference" | "text" | "identity" | "control" | "style";
function hStyle(type: HandleType, top: number): React.CSSProperties {
  return { top, width: 9, height: 9, background: HANDLE_COLOR[type], border: "1px solid #0b0b0f" };
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
      <Handle type="source" position={Position.Right} id="image" style={hStyle("image", 26)} />
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
      <Handle type="source" position={Position.Right} id="text" style={hStyle("text", 26)} />
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
      <Handle type="source" position={Position.Right} id="reference" style={hStyle("reference", 26)} />
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
      <HandleLabel text="入力" top={32} />
      <Handle type="target" position={Position.Left} id="image" style={hStyle("image", 32)} />
      <HandleLabel text="参照" top={62} />
      <Handle type="target" position={Position.Left} id="reference" style={hStyle("reference", 62)} />
      <HandleLabel text="文" top={92} />
      <Handle type="target" position={Position.Left} id="text" style={hStyle("text", 92)} />

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
        <div className="nowheel mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap break-words rounded bg-red-500/10 px-1.5 py-1 text-[10px] leading-snug text-red-300">
          ⚠ {data.error}
        </div>
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
      <Handle type="source" position={Position.Right} id="image" style={hStyle("image", 32)} />
    </NodeShell>
  );
}

// ---------- 制御生成（InstantID 等） ----------
export function ControlledGenerateNode({ id, data }: NodeProps<Node<ControlledGenerateNodeData>>) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { preview } = useFlowCtx();
  const model = getModel(data.modelKey);
  const caps = model.controls || {};
  // 制御能力を持つモデルのみ選択肢に
  const controlModels = Object.values(MODELS).filter((m) => m.controls);

  const onModel = (key: string) => {
    const m = getModel(key);
    const ar = m.aspectRatios.includes(data.aspectRatio) ? data.aspectRatio : m.aspectRatios[0];
    updateNodeData(id, { modelKey: key, aspectRatio: ar });
  };

  return (
    <NodeShell title="⑥ 制御生成（人物固定）" color={COLORS.cgenerate} onDelete={() => deleteElements({ nodes: [{ id }] })}>
      <HandleLabel text="入力" top={32} />
      <Handle type="target" position={Position.Left} id="image" style={hStyle("image", 32)} />
      <HandleLabel text="同一性" top={58} />
      <Handle type="target" position={Position.Left} id="identity" style={hStyle("identity", 58)} />
      <HandleLabel text="姿勢" top={84} />
      <Handle type="target" position={Position.Left} id="control" style={hStyle("control", 84)} />
      <HandleLabel text="画風" top={110} />
      <Handle type="target" position={Position.Left} id="style" style={hStyle("style", 110)} />
      <HandleLabel text="文" top={136} />
      <Handle type="target" position={Position.Left} id="text" style={hStyle("text", 136)} />

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
        {controlModels.map((m) => (
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
            max={4}
            value={data.count}
            onChange={(e) => updateNodeData(id, { count: Math.min(4, Math.max(1, Number(e.target.value))) })}
            className="nodrag w-9 rounded border border-zinc-700 bg-zinc-950 px-1 text-[11px]"
          />
        </label>
      </div>

      {/* 強度スライダー */}
      {caps.identity && (
        <Slider label="同一性" value={data.identityStrength} onChange={(v) => updateNodeData(id, { identityStrength: v })} />
      )}
      {caps.control && (
        <Slider label="姿勢" value={data.controlStrength} onChange={(v) => updateNodeData(id, { controlStrength: v })} />
      )}
      {caps.style && (
        <Slider label="画風" value={data.styleStrength} onChange={(v) => updateNodeData(id, { styleStrength: v })} />
      )}

      <textarea
        value={data.promptOverride || ""}
        onChange={(e) => updateNodeData(id, { promptOverride: e.target.value })}
        placeholder="固定プロンプト（文入力が未接続のとき使用）"
        className="nodrag nowheel mt-1 min-h-[40px] w-full resize-y rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-teal-400/60"
      />

      {/* seed 行 */}
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-400">
        <button
          onClick={() => updateNodeData(id, { fixedSeed: !data.fixedSeed })}
          className={`nodrag rounded px-1.5 py-0.5 ${data.fixedSeed ? "bg-teal-400/20 text-teal-300" : "bg-zinc-800"}`}
        >
          {data.fixedSeed ? "seed固定" : "seedランダム"}
        </button>
        {data.fixedSeed ? (
          <input
            type="number"
            value={data.seed ?? 0}
            onChange={(e) => updateNodeData(id, { seed: Number(e.target.value) })}
            className="nodrag w-20 rounded border border-zinc-700 bg-zinc-950 px-1 text-[10px]"
          />
        ) : (
          <span className="text-zinc-500">{data.usedSeed != null ? `直近: ${data.usedSeed}` : "—"}</span>
        )}
        <label className="ml-auto flex items-center gap-1">
          steps
          <input
            type="number"
            min={1}
            max={60}
            value={data.steps}
            onChange={(e) => updateNodeData(id, { steps: Math.min(60, Math.max(1, Number(e.target.value))) })}
            className="nodrag w-10 rounded border border-zinc-700 bg-zinc-950 px-1 text-[10px]"
          />
        </label>
      </div>

      {data.status === "running" && <p className="mt-1 animate-pulse text-[11px] text-teal-300">生成中…</p>}
      {data.status === "error" && (
        <div className="nowheel mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap break-words rounded bg-red-500/10 px-1.5 py-1 text-[10px] leading-snug text-red-300">
          ⚠ {data.error}
        </div>
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
      <Handle type="source" position={Position.Right} id="image" style={hStyle("image", 32)} />
    </NodeShell>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
      <span className="w-8 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="nodrag flex-1 accent-teal-400"
      />
      <span className="w-7 shrink-0 text-right tabular-nums">{value.toFixed(2)}</span>
    </div>
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
      <HandleLabel text="画像" top={32} />
      <Handle type="target" position={Position.Left} id="image" style={hStyle("image", 32)} />
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
  cgenerate: ControlledGenerateNode,
  output: OutputNode,
};
