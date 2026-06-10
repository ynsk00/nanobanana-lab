"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import JSZip from "jszip";

import { Button } from "@/components/ui";
import { ApiKeyModal } from "@/components/ApiKeyModal";
import { nodeTypes } from "@/components/flow/nodes";
import { ImagePicker } from "@/components/flow/ImagePicker";
import { FlowContext } from "@/components/flow/context";
import * as db from "@/lib/db";
import { getApiKey } from "@/lib/settings";
import { getModel, DEFAULT_MODEL_KEY } from "@/lib/pricing";
import { genId, makeThumbnail, dataUrlToBlob, downloadBlob, extFromMime } from "@/lib/image";
import { getFullImage } from "@/lib/results";
import { buildContactSheet } from "@/lib/contactSheet";
import { runWorkflow } from "@/lib/flow/run";
import {
  buildExport,
  buildMarkdownSpec,
  parseImport,
  listWorkflows,
  saveWorkflow,
  deleteWorkflow,
} from "@/lib/flow/storage";
import type { FlowNodeData, SavedWorkflow } from "@/lib/flow/types";
import type { ImageAsset, ImageItem, ResultImage } from "@/lib/types";

type FNode = Node<FlowNodeData>;

function defaultData(kind: FlowNodeData["kind"]): FlowNodeData {
  switch (kind) {
    case "input":
      return { kind: "input", label: "画像入力" };
    case "prompt":
      return { kind: "prompt", label: "プロンプト", template: "" };
    case "reference":
      return { kind: "reference", label: "参照セット", items: [], pickCount: 1 };
    case "generate":
      return {
        kind: "generate",
        label: "生成ステージ",
        modelKey: DEFAULT_MODEL_KEY,
        aspectRatio: "1:1",
        count: 1,
        status: "idle",
      };
    case "output":
      return { kind: "output", label: "出力" };
  }
}

function Editor() {
  const [nodes, setNodes, onNodesChange] = useNodesState<FNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("新しいワークフロー");
  const [currentId, setCurrentId] = useState<string | null>(null);

  const [geminiKey, setGeminiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [keyModalOpen, setKeyModalOpen] = useState(false);

  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [picker, setPicker] = useState<{ multi: boolean; onPick: (i: ImageItem[]) => void } | null>(null);
  const [savedList, setSavedList] = useState<SavedWorkflow[] | null>(null);

  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setGeminiKey(getApiKey("gemini"));
    setOpenaiKey(getApiKey("openai"));
  }, []);

  const ctxValue = useMemo(
    () => ({
      openPicker: (multi: boolean, onPick: (i: ImageItem[]) => void) => setPicker({ multi, onPick }),
      preview: async (r: ResultImage) => setPreviewUrl(await getFullImage(r)),
    }),
    []
  );

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, animated: true }, eds)),
    [setEdges]
  );

  const isValidConnection = useCallback((c: Connection | Edge) => {
    const s = c.sourceHandle;
    const t = c.targetHandle;
    if (t === "image") return s === "image";
    if (t === "text") return s === "text";
    if (t === "reference") return s === "reference" || s === "image";
    return false;
  }, []);

  const addNode = useCallback(
    (kind: FlowNodeData["kind"]) => {
      const id = genId("n_");
      setNodes((nds) => [
        ...nds,
        {
          id,
          type: kind,
          position: { x: 120 + (nds.length % 5) * 60, y: 80 + nds.length * 24 },
          data: defaultData(kind),
        } as FNode,
      ]);
    },
    [setNodes]
  );

  const patchNode = useCallback(
    (id: string, patch: Partial<FlowNodeData>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } as FlowNodeData } : n))
      );
    },
    [setNodes]
  );

  const storeResults = useCallback(async (raw: ResultImage[]): Promise<ResultImage[]> => {
    const out: ResultImage[] = [];
    for (const r of raw) {
      const full = r.dataUrl || "";
      if (!full) {
        out.push(r);
        continue;
      }
      await db.put<ImageAsset>("assets", { id: r.id, dataUrl: full });
      const thumbUrl = await makeThumbnail(full, 300);
      out.push({ id: r.id, thumbUrl, assetId: r.id, mimeType: r.mimeType, sourceName: r.sourceName });
    }
    return out;
  }, []);

  const run = useCallback(async () => {
    setMsg(null);
    if (!geminiKey && !openaiKey) {
      setKeyModalOpen(true);
      setMsg("APIキーを設定してください。");
      return;
    }
    setRunning(true);
    try {
      const res = await runWorkflow(nodes, edges, { geminiKey, openaiKey, storeResults, patchNode });
      if (!res.ok) setMsg(res.errors.join(" / "));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [nodes, edges, geminiKey, openaiKey, storeResults, patchNode]);

  // 出力結果の集約（出力ノード優先、無ければ全生成ノード）
  const collectResults = useCallback((): ResultImage[] => {
    const outs = nodes.filter((n) => n.data.kind === "output");
    const acc: ResultImage[] = [];
    if (outs.length) {
      outs.forEach((n) => acc.push(...(((n.data as { results?: ResultImage[] }).results) || [])));
    } else {
      nodes
        .filter((n) => n.data.kind === "generate")
        .forEach((n) => acc.push(...(((n.data as { results?: ResultImage[] }).results) || [])));
    }
    return acc;
  }, [nodes]);

  const exportContactSheet = useCallback(async () => {
    const results = collectResults();
    if (!results.length) return setMsg("出力する結果がありません。先に実行してください。");
    const items = await Promise.all(
      results.map(async (r, i) => ({ url: await getFullImage(r), caption: String(i + 1) }))
    );
    const blob = await buildContactSheet(items, { title: name, subtitle: `${results.length}枚` });
    if (blob) downloadBlob(blob, `flow_contact_${Date.now().toString(36)}.png`);
  }, [collectResults, name]);

  const exportZip = useCallback(async () => {
    const results = collectResults();
    if (!results.length) return setMsg("出力する結果がありません。");
    const zip = new JSZip();
    const folder = zip.folder("flow_output")!;
    for (let i = 0; i < results.length; i++) {
      const full = await getFullImage(results[i]);
      if (full) folder.file(`image_${String(i + 1).padStart(2, "0")}.${extFromMime(results[i].mimeType)}`, dataUrlToBlob(full));
    }
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `flow_output_${Date.now().toString(36)}.zip`);
  }, [collectResults]);

  const saveToPool = useCallback(async () => {
    const results = collectResults();
    if (!results.length) return setMsg("保存する結果がありません。");
    for (const r of results) {
      const full = await getFullImage(r);
      if (!full) continue;
      const item: ImageItem = {
        id: genId("img_"),
        dataUrl: full,
        mimeType: r.mimeType,
        name: `flow_${new Date().toISOString().slice(0, 19)}`,
        origin: "generated",
        createdAt: Date.now(),
      };
      await db.put("pool", item);
    }
    setMsg(`${results.length} 枚をライブラリ(プール)に保存しました。`);
  }, [collectResults]);

  // 保存/読込
  const save = useCallback(async () => {
    const id = currentId || genId("wf_");
    const now = Date.now();
    const wf: SavedWorkflow = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      nodes: nodes as unknown[],
      edges: edges as unknown[],
    };
    await saveWorkflow(wf);
    setCurrentId(id);
    setMsg("保存しました。");
  }, [currentId, name, nodes, edges]);

  const openLoadList = useCallback(async () => setSavedList(await listWorkflows()), []);

  const loadWorkflow = useCallback(
    (wf: SavedWorkflow) => {
      setNodes(wf.nodes as FNode[]);
      setEdges(wf.edges as Edge[]);
      setName(wf.name);
      setCurrentId(wf.id);
      setSavedList(null);
    },
    [setNodes, setEdges]
  );

  const exportJson = useCallback(() => {
    const data = buildExport(name, nodes, edges, Date.now());
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${name.replace(/\s+/g, "_") || "workflow"}.flow.json`);
  }, [name, nodes, edges]);

  const exportMarkdown = useCallback(() => {
    const md = buildMarkdownSpec(name, nodes, edges);
    downloadBlob(new Blob([md], { type: "text/markdown" }), `${name.replace(/\s+/g, "_") || "workflow"}.md`);
  }, [name, nodes, edges]);

  const onImportFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const data = parseImport(text);
        setNodes(data.nodes as FNode[]);
        setEdges(data.edges as Edge[]);
        setName(data.name || "読み込んだワークフロー");
        setCurrentId(null);
        setMsg("インポートしました。");
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "読み込みに失敗しました。");
      }
    },
    [setNodes, setEdges]
  );

  const memoNodeTypes = useMemo(() => nodeTypes, []);

  return (
    <FlowContext.Provider value={ctxValue}>
      <div className="flex h-screen flex-col bg-[#0b0b0f]">
        {/* ヘッダー / ツールバー */}
        <header className="z-20 flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <a href="/" className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-amber-400/60 hover:text-amber-300">
            🍌 Lab
          </a>
          <span className="text-sm font-bold">🔀 Flow</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs outline-none focus:border-amber-400/60"
          />
          <span className="mx-1 text-zinc-700">|</span>
          <span className="text-[11px] text-zinc-500">追加:</span>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => addNode("input")}>①入力</Button>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => addNode("prompt")}>②プロンプト</Button>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => addNode("reference")}>③参照</Button>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => addNode("generate")}>④生成</Button>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => addNode("output")}>⑤出力</Button>

          <span className="mx-1 text-zinc-700">|</span>
          <Button variant="primary" className="px-3 py-1 text-xs" onClick={run} disabled={running}>
            {running ? "実行中…" : "▶ 実行"}
          </Button>

          <span className="ml-auto flex items-center gap-1">
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={save}>💾保存</Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={openLoadList}>📂読込</Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={exportJson} title="再現用JSONを書き出し">⬇JSON</Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => importRef.current?.click()}>⬆読込</Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={exportMarkdown} title="手順書(Markdown)">📝手順書</Button>
            <Button
              variant={geminiKey || openaiKey ? "ghost" : "primary"}
              className="px-2 py-1 text-xs"
              onClick={() => setKeyModalOpen(true)}
            >
              ⚙キー
            </Button>
          </span>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) onImportFile(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </header>

        {msg && (
          <div className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-amber-200">
            {msg}
            <button className="ml-2 text-zinc-500 hover:text-zinc-200" onClick={() => setMsg(null)}>×</button>
          </div>
        )}

        {/* キャンバス */}
        <div className="relative flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            nodeTypes={memoNodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ animated: true }}
          >
            <Background color="#27272a" gap={18} />
            <Controls />
            <MiniMap pannable zoomable className="!bg-zinc-900" />
          </ReactFlow>

          {/* 出力ツールバー */}
          <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/90 px-3 py-1.5 shadow-lg backdrop-blur">
            <span className="text-[11px] text-zinc-500">出力:</span>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={exportContactSheet}>🗂 コンタクトシート</Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={exportZip}>⬇ Zip</Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={saveToPool}>📥 ライブラリ保存</Button>
          </div>
        </div>
      </div>

      <ApiKeyModal
        open={keyModalOpen}
        onClose={() => setKeyModalOpen(false)}
        onSaved={() => {
          setGeminiKey(getApiKey("gemini"));
          setOpenaiKey(getApiKey("openai"));
        }}
      />

      <ImagePicker
        open={!!picker}
        multi={picker?.multi || false}
        onClose={() => setPicker(null)}
        onPick={(items) => picker?.onPick(items)}
      />

      {savedList && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={() => setSavedList(null)}>
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold">保存済みワークフロー</h2>
              <button onClick={() => setSavedList(null)} className="text-zinc-500 hover:text-zinc-200">×</button>
            </div>
            {savedList.length === 0 ? (
              <p className="py-6 text-center text-xs text-zinc-500">保存されたワークフローはありません。</p>
            ) : (
              <ul className="max-h-80 space-y-1 overflow-y-auto">
                {savedList.map((wf) => (
                  <li key={wf.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-zinc-800/60">
                    <button className="flex-1 text-left text-zinc-200" onClick={() => loadWorkflow(wf)}>
                      {wf.name}
                      <span className="ml-2 text-zinc-600">{new Date(wf.updatedAt).toLocaleString("ja-JP")}</span>
                    </button>
                    <button
                      className="text-zinc-500 hover:text-red-400"
                      onClick={async () => {
                        await deleteWorkflow(wf.id);
                        setSavedList(await listWorkflows());
                      }}
                    >
                      削除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {previewUrl && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4" onClick={() => setPreviewUrl(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="preview" className="max-h-full max-w-full cursor-zoom-out object-contain" />
        </div>
      )}
    </FlowContext.Provider>
  );
}

export default function FlowEditor() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}
