"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Button, Panel } from "@/components/ui";
import { PoolGrid } from "@/components/PoolGrid";
import { ApiKeyModal } from "@/components/ApiKeyModal";
import { Lightbox, type LightboxImage } from "@/components/Lightbox";
import { PromptDiff } from "@/components/PromptDiff";
import { getApiKey, maskKey } from "@/lib/settings";
import { MODELS, DEFAULT_MODEL_KEY, getModel } from "@/lib/pricing";
import type {
  Batch,
  GenerateResponse,
  ImageItem,
  PromptItem,
  Role,
  UsedImage,
} from "@/lib/types";
import * as db from "@/lib/db";
import {
  dataUrlToBlob,
  downloadBlob,
  extFromMime,
  fileToDataUrl,
  genId,
  mimeFromDataUrl,
} from "@/lib/image";
import { compressList, requestGeneration } from "@/lib/generation";

interface SelEntry {
  id: string;
  role: Role;
}

type BatchMode = "combined" | "perInput";

/** バッチが使った画像を取り出す（旧バッチはthumbsからフォールバック） */
function getUsedImages(batch: Batch): UsedImage[] {
  if (batch.usedImages?.length) return batch.usedImages;
  const legacy: UsedImage[] = [];
  (batch.inputThumbs ?? []).forEach((d, i) =>
    legacy.push({ id: `legacy_in_${i}`, dataUrl: d, mimeType: mimeFromDataUrl(d), name: `in${i + 1}`, role: "input" })
  );
  (batch.referenceThumbs ?? []).forEach((d, i) =>
    legacy.push({ id: `legacy_ref_${i}`, dataUrl: d, mimeType: mimeFromDataUrl(d), name: `ref${i + 1}`, role: "reference" })
  );
  return legacy;
}

export default function Home() {
  // --- データ ---
  const [pool, setPool] = useState<ImageItem[]>([]);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);

  // --- 選択（役割付き） ---
  const [selection, setSelection] = useState<SelEntry[]>([]);

  // --- 生成設定 ---
  const [promptText, setPromptText] = useState("");
  const [modelKey, setModelKey] = useState(DEFAULT_MODEL_KEY);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [count, setCount] = useState(1);
  const [batchMode, setBatchMode] = useState<BatchMode>("combined");

  // --- 実行中ジョブ（複数同時実行可） ---
  const [jobs, setJobs] = useState<{ id: string; startedAt: number; label: string }[]>([]);
  const [, setTick] = useState(0); // 実行中の経過時間表示を更新するための再描画トリガ
  const [error, setError] = useState<string | null>(null);

  // --- APIキー（プロバイダ別） ---
  const [geminiKey, setGeminiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [keyModalOpen, setKeyModalOpen] = useState(false);

  // --- 拡大表示 ---
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);

  // --- 基準（良かった結果）---
  const [baselineId, setBaselineId] = useState<string | null>(null);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const model = getModel(modelKey);
  // 選択中モデルのプロバイダに対応するキー
  const activeKey = model.provider === "openai" ? openaiKey : geminiKey;

  // 初回ロード（旧 inputs/references → pool へ移行）
  useEffect(() => {
    (async () => {
      const [poolItems, oldIn, oldRef, p, b] = await Promise.all([
        db.getAll<ImageItem>("pool"),
        db.getAll<ImageItem>("inputs"),
        db.getAll<ImageItem>("references"),
        db.getAll<PromptItem>("prompts"),
        db.getAll<Batch>("batches"),
      ]);
      let merged = poolItems;
      const migrated =
        typeof window !== "undefined" && localStorage.getItem("nbl_pool_migrated");
      if (merged.length === 0 && !migrated && (oldIn.length || oldRef.length)) {
        const map = new Map<string, ImageItem>();
        [...oldIn, ...oldRef].forEach((it) => map.set(it.id, it));
        merged = Array.from(map.values());
        for (const it of merged) await db.put("pool", it);
        localStorage.setItem("nbl_pool_migrated", "1");
      }
      setPool(merged.sort((a, b) => b.createdAt - a.createdAt));
      setPrompts(p.sort((a, b) => b.createdAt - a.createdAt));
      setBatches(b.sort((a, b) => b.createdAt - a.createdAt));
      // 基準バッチIDを復元（存在するもののみ）
      const savedBaseline =
        typeof window !== "undefined" ? localStorage.getItem("nbl_baseline_id") : null;
      if (savedBaseline && b.some((x) => x.id === savedBaseline)) {
        setBaselineId(savedBaseline);
      }
    })();
    const gk = getApiKey("gemini");
    const ok = getApiKey("openai");
    setGeminiKey(gk);
    setOpenaiKey(ok);
    if (!gk && !ok) setKeyModalOpen(true);
  }, []);

  // モデル変更時のアスペクト比補正
  useEffect(() => {
    if (!model.aspectRatios.includes(aspectRatio)) {
      setAspectRatio(model.aspectRatios[0]);
    }
  }, [model, aspectRatio]);

  // 実行中ジョブがある間、経過時間表示を更新
  useEffect(() => {
    if (jobs.length === 0) return;
    const timer = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(timer);
  }, [jobs.length]);

  // --- プール操作 ---
  const addImagesToPool = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const items: ImageItem[] = [];
    for (const f of arr) {
      const dataUrl = await fileToDataUrl(f);
      const item: ImageItem = {
        id: genId("img_"),
        dataUrl,
        mimeType: f.type || "image/png",
        name: f.name || "image",
        origin: "upload",
        createdAt: Date.now(),
      };
      await db.put("pool", item);
      items.push(item);
    }
    if (items.length) setPool((p) => [...items, ...p]);
  }, []);

  // ⌘V でクリップボードの画像をプールへ
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const dt = e.clipboardData;
      if (!dt) return;
      const files: File[] = [];
      for (const item of Array.from(dt.items || [])) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length === 0 && dt.files) {
        for (const f of Array.from(dt.files)) {
          if (f.type.startsWith("image/")) files.push(f);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      addImagesToPool(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addImagesToPool]);

  const deletePoolItem = useCallback(async (item: ImageItem) => {
    await db.del("pool", item.id);
    setPool((p) => p.filter((x) => x.id !== item.id));
    setSelection((prev) => prev.filter((s) => s.id !== item.id));
  }, []);

  // 役割割り当て（同じ役割を再クリックで解除、別役割で上書き）
  const setRole = useCallback((item: ImageItem, role: Role) => {
    setSelection((prev) => {
      const ex = prev.find((s) => s.id === item.id);
      if (ex && ex.role === role) return prev.filter((s) => s.id !== item.id);
      return [...prev.filter((s) => s.id !== item.id), { id: item.id, role }];
    });
  }, []);

  const removeFromSelection = useCallback((id: string) => {
    setSelection((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // 生成結果をプールへ取り込み、入力/参照に割り当て
  const addResultToPool = useCallback(
    async (dataUrl: string, mimeType: string, role: Role) => {
      const item: ImageItem = {
        id: genId("img_"),
        dataUrl,
        mimeType,
        name: `generated_${new Date().toISOString().slice(0, 19)}`,
        origin: "generated",
        createdAt: Date.now(),
      };
      await db.put("pool", item);
      setPool((p) => [item, ...p]);
      setSelection((prev) => [...prev.filter((s) => s.id !== item.id), { id: item.id, role }]);
    },
    []
  );

  // --- プロンプト ---
  const insertToken = useCallback(
    (token: string) => {
      const ta = promptRef.current;
      if (!ta) {
        setPromptText((p) => `${p}${token}`);
        return;
      }
      const start = ta.selectionStart ?? promptText.length;
      const end = ta.selectionEnd ?? promptText.length;
      const next = promptText.slice(0, start) + token + promptText.slice(end);
      setPromptText(next);
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + token.length;
        ta.setSelectionRange(pos, pos);
      });
    },
    [promptText]
  );

  const savePrompt = useCallback(async () => {
    if (!promptText.trim()) return;
    const item: PromptItem = {
      id: genId("pr_"),
      text: promptText.trim(),
      name: promptText.trim().slice(0, 40),
      createdAt: Date.now(),
    };
    await db.put("prompts", item);
    setPrompts((p) => [item, ...p]);
  }, [promptText]);

  const deletePrompt = useCallback(async (id: string) => {
    await db.del("prompts", id);
    setPrompts((p) => p.filter((x) => x.id !== id));
  }, []);

  // 選択画像（順序付き）
  const selectedInputs = useMemo(
    () =>
      selection
        .filter((s) => s.role === "input")
        .map((s) => pool.find((x) => x.id === s.id))
        .filter(Boolean) as ImageItem[],
    [selection, pool]
  );
  const selectedRefs = useMemo(
    () =>
      selection
        .filter((s) => s.role === "reference")
        .map((s) => pool.find((x) => x.id === s.id))
        .filter(Boolean) as ImageItem[],
    [selection, pool]
  );

  // 「入力ごと」モードは入力枚数 × count が総出力枚数
  const totalImages =
    batchMode === "perInput" ? Math.max(1, selectedInputs.length) * count : count;
  const estCost = (totalImages * model.pricePerImage).toFixed(3);

  // --- 生成（複数同時実行可。送信時の設定をスナップショットして独立に走らせる） ---
  const generate = useCallback(async () => {
    setError(null);
    if (!activeKey) {
      setKeyModalOpen(true);
      setError(
        model.provider === "openai"
          ? "先に OpenAI APIキーを設定してください。"
          : "先に Gemini APIキーを設定してください。"
      );
      return;
    }
    if (!promptText.trim() && selectedInputs.length === 0) {
      setError("プロンプトまたは入力画像を指定してください。");
      return;
    }
    if (batchMode === "perInput" && selectedInputs.length === 0) {
      setError("「入力ごとに生成」には入力画像を1枚以上選んでください。");
      return;
    }

    // この生成の設定を固定（以降のフォーム変更や他ジョブと干渉しない）
    const jobStart = Date.now();
    const jobId = genId("job_");
    const snap = {
      prompt: promptText,
      mode: batchMode,
      modelKey,
      modelLabel: model.label,
      modelId: model.id,
      aspectRatio,
      count,
      inputs: selectedInputs,
      refs: selectedRefs,
    };
    const jobTotal =
      snap.mode === "perInput" ? Math.max(1, snap.inputs.length) * snap.count : snap.count;
    const jobLabel =
      snap.mode === "perInput"
        ? `${snap.modelLabel} 入力${snap.inputs.length}×${snap.count}`
        : `${snap.modelLabel} ×${snap.count}`;
    setJobs((prev) => [...prev, { id: jobId, startedAt: jobStart, label: jobLabel }]);

    try {
      // 履歴スナップショット（再編集時のフォールバック。プールに原本が残っていれば原本を優先）
      const inComp = await compressList(snap.inputs);
      const refComp = await compressList(snap.refs);
      const refOriginals = snap.refs.map((x) => x.dataUrl);
      const params = {
        geminiKey,
        openaiKey,
        modelKey: snap.modelKey,
        aspectRatio: snap.aspectRatio,
        count: snap.count,
        prompt: snap.prompt,
      };

      // モードに応じて1回 or 入力ごとに並列実行
      let results: GenerateResponse["results"] = [];
      let costUsd = 0;
      let sentInputCount = 0;
      let sentReferenceCount = 0;
      const errors: string[] = [];

      if (snap.mode === "perInput") {
        const settled = await Promise.allSettled(
          snap.inputs.map((inp) => requestGeneration(params, [inp.dataUrl], refOriginals))
        );
        settled.forEach((s, idx) => {
          const srcName = snap.inputs[idx].name;
          if (s.status === "fulfilled") {
            costUsd += s.value.costUsd;
            sentInputCount += s.value.sentInputCount ?? 0;
            sentReferenceCount = Math.max(sentReferenceCount, s.value.sentReferenceCount ?? 0);
            errors.push(...s.value.errors.map((e) => `${srcName}: ${e}`));
            results.push(...s.value.results.map((r) => ({ ...r, sourceName: srcName })));
          } else {
            errors.push(`${srcName}: ${s.reason?.message ?? s.reason}`);
          }
        });
      } else {
        const data = await requestGeneration(params, snap.inputs.map((x) => x.dataUrl), refOriginals);
        results = data.results;
        costUsd = data.costUsd;
        sentInputCount = data.sentInputCount ?? 0;
        sentReferenceCount = data.sentReferenceCount ?? 0;
        errors.push(...data.errors);
      }

      const usedImages: UsedImage[] = [
        ...snap.inputs.map((x, i) => ({
          id: x.id,
          dataUrl: inComp[i],
          mimeType: mimeFromDataUrl(inComp[i]),
          name: x.name,
          role: "input" as Role,
        })),
        ...snap.refs.map((x, i) => ({
          id: x.id,
          dataUrl: refComp[i],
          mimeType: mimeFromDataUrl(refComp[i]),
          name: x.name,
          role: "reference" as Role,
        })),
      ];

      const batch: Batch = {
        id: genId("batch_"),
        createdAt: Date.now(),
        modelKey: snap.modelKey,
        modelLabel: snap.modelLabel,
        modelId: snap.modelId,
        aspectRatio: snap.aspectRatio,
        requestedCount: jobTotal,
        prompt: snap.prompt,
        usedImages,
        results,
        costUsd,
        durationMs: Date.now() - jobStart,
        errors,
        sentInputCount,
        sentReferenceCount,
      };
      await db.put("batches", batch);
      setBatches((p) => [batch, ...p]);
      if (results.length === 0) {
        setError("画像が返却されませんでした: " + (errors.join(" / ") || "理由不明"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    }
  }, [activeKey, geminiKey, openaiKey, promptText, batchMode, selectedInputs, selectedRefs, modelKey, aspectRatio, count, model]);

  // --- バッチ操作 ---
  const deleteBatch = useCallback(async (id: string) => {
    await db.del("batches", id);
    setBatches((p) => p.filter((x) => x.id !== id));
    setBaselineId((cur) => (cur === id ? null : cur));
    if (typeof window !== "undefined" && localStorage.getItem("nbl_baseline_id") === id) {
      localStorage.removeItem("nbl_baseline_id");
    }
  }, []);

  // 基準（良かった結果）に設定/解除
  const toggleBaseline = useCallback((id: string) => {
    setBaselineId((cur) => {
      const next = cur === id ? null : id;
      if (typeof window !== "undefined") {
        if (next) localStorage.setItem("nbl_baseline_id", next);
        else localStorage.removeItem("nbl_baseline_id");
      }
      return next;
    });
  }, []);

  // バッチ内容を編集部へ復元（再編集・再生成）
  const reEdit = useCallback(
    async (batch: Batch) => {
      setPromptText(batch.prompt);
      setModelKey(batch.modelKey);
      setAspectRatio(batch.aspectRatio);
      setCount(batch.requestedCount);

      const used = getUsedImages(batch);
      let working = pool;
      const toAdd: ImageItem[] = [];
      const newSel: SelEntry[] = [];
      for (const u of used) {
        const existing = working.find((x) => x.id === u.id);
        if (existing) {
          newSel.push({ id: existing.id, role: u.role });
        } else {
          const item: ImageItem = {
            id: genId("img_"),
            dataUrl: u.dataUrl,
            mimeType: u.mimeType,
            name: u.name,
            origin: "generated",
            createdAt: Date.now(),
          };
          toAdd.push(item);
          working = [item, ...working];
          newSel.push({ id: item.id, role: u.role });
        }
      }
      if (toAdd.length) {
        for (const it of toAdd) await db.put("pool", it);
        setPool(working);
      }
      setSelection(newSel);
      setError(null);
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [pool]
  );

  const downloadBatchZip = useCallback(async (batch: Batch) => {
    const zip = new JSZip();
    const stamp = new Date(batch.createdAt).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const folder = zip.folder(`batch_${stamp}`)!;
    batch.results.forEach((r, i) => {
      folder.file(
        `image_${String(i + 1).padStart(2, "0")}.${extFromMime(r.mimeType)}`,
        dataUrlToBlob(r.dataUrl)
      );
    });
    folder.file(
      "metadata.json",
      JSON.stringify(
        {
          createdAt: new Date(batch.createdAt).toISOString(),
          model: batch.modelLabel,
          modelId: batch.modelId,
          aspectRatio: batch.aspectRatio,
          requestedCount: batch.requestedCount,
          returnedCount: batch.results.length,
          prompt: batch.prompt,
          usedImages: getUsedImages(batch).map((u) => ({ name: u.name, role: u.role })),
          costUsd: batch.costUsd,
          durationMs: batch.durationMs,
          errors: batch.errors,
        },
        null,
        2
      )
    );
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `nanobanana_batch_${stamp}.zip`);
  }, []);

  const totalCost = useMemo(() => batches.reduce((s, b) => s + b.costUsd, 0), [batches]);
  const baselineBatch = useMemo(
    () => batches.find((b) => b.id === baselineId) ?? null,
    [batches, baselineId]
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-24">
      {/* ヘッダー */}
      <header className="sticky top-0 z-20 -mx-4 mb-4 flex items-center justify-between border-b border-zinc-800 bg-[#0b0b0f]/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-xl">🍌</span>
          <h1 className="text-lg font-bold">Nano Banana Lab</h1>
          <span className="hidden text-xs text-zinc-500 sm:inline">Gemini 画像生成 実験サイト</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <span>
            バッチ <b className="text-zinc-200">{batches.length}</b>
          </span>
          <span>
            累計概算 <b className="text-amber-400">${totalCost.toFixed(3)}</b>
          </span>
          <Button
            variant={activeKey ? "ghost" : "primary"}
            className="px-2.5 py-1 text-xs"
            onClick={() => setKeyModalOpen(true)}
            title={
              activeKey
                ? `${model.provider === "openai" ? "OpenAI" : "Gemini"}: ${maskKey(activeKey)}`
                : `${model.provider === "openai" ? "OpenAI" : "Gemini"} APIキー未設定`
            }
          >
            ⚙ APIキー
            <span
              className={`ml-1 inline-block h-2 w-2 rounded-full ${activeKey ? "bg-emerald-400" : "bg-red-400"}`}
            />
          </Button>
        </div>
      </header>

      <ApiKeyModal
        open={keyModalOpen}
        onClose={() => setKeyModalOpen(false)}
        onSaved={() => {
          setGeminiKey(getApiKey("gemini"));
          setOpenaiKey(getApiKey("openai"));
        }}
      />

      <Lightbox
        image={lightbox}
        onClose={() => setLightbox(null)}
        onAssign={addResultToPool}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        {/* 左: 画像プール + プロンプト */}
        <aside className="flex flex-col gap-4">
          <Panel
            title="画像ライブラリ（プール）"
            right={
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => fileRef.current?.click()}>
                ＋追加
              </Button>
            }
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addImagesToPool(e.target.files);
                e.target.value = "";
              }}
            />
            <p className="mb-2 text-[11px] leading-relaxed text-zinc-500">
              各画像の <span className="text-amber-300">入力</span> /{" "}
              <span className="text-sky-300">参照</span> ボタンで役割を割り当て（クリックで拡大）。
            </p>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                if (e.dataTransfer.files.length) addImagesToPool(e.dataTransfer.files);
              }}
              className={`rounded-lg ${drag ? "ring-2 ring-amber-400" : ""}`}
            >
              <PoolGrid
                items={pool}
                selection={selection}
                onSetRole={setRole}
                onDelete={deletePoolItem}
                onEnlarge={(it) =>
                  setLightbox({ id: it.id, dataUrl: it.dataUrl, mimeType: it.mimeType, assignable: false })
                }
                emptyText="ドラッグ&ドロップ / ＋追加 / ⌘V で画像を登録"
              />
            </div>
          </Panel>

          <Panel title="プロンプトライブラリ">
            {prompts.length === 0 ? (
              <p className="py-2 text-center text-xs text-zinc-600">保存したプロンプトはありません</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {prompts.map((p) => (
                  <li
                    key={p.id}
                    className="group flex items-start gap-1 rounded-md px-2 py-1.5 text-xs hover:bg-zinc-800/60"
                  >
                    <button
                      className="flex-1 text-left text-zinc-300"
                      onClick={() => setPromptText(p.text)}
                      title="クリックでプロンプト欄に読み込み"
                    >
                      {p.text.length > 80 ? p.text.slice(0, 80) + "…" : p.text}
                    </button>
                    <button
                      className="hidden text-zinc-500 hover:text-red-400 group-hover:block"
                      onClick={() => deletePrompt(p.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>

        {/* 右: コンポーザー + 結果 */}
        <main className="flex flex-col gap-4">
          <div ref={composerRef}>
            <Panel
              title="生成"
              right={
                <span className="hidden text-[11px] text-zinc-500 sm:inline">
                  プロンプトで <code className="text-amber-400">@in1</code> /{" "}
                  <code className="text-sky-400">@ref1</code> で添付画像を参照
                </span>
              }
            >
              {baselineBatch && (
                <div className="mb-3 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-300">
                      ★ 基準（良かった結果）との差分
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        className="px-2 py-0.5 text-[11px]"
                        onClick={() => setPromptText(baselineBatch.prompt)}
                        disabled={baselineBatch.prompt === promptText}
                        title="基準のプロンプトを編集欄に戻す"
                      >
                        基準を読込
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-2 py-0.5 text-[11px]"
                        onClick={() => toggleBaseline(baselineBatch.id)}
                      >
                        解除
                      </Button>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    {baselineBatch.results[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={baselineBatch.results[0].dataUrl}
                        alt="基準"
                        className="h-16 w-16 shrink-0 cursor-zoom-in rounded border border-amber-400/40 object-cover"
                        onClick={() =>
                          setLightbox({
                            ...baselineBatch.results[0],
                            assignable: true,
                          })
                        }
                        title="クリックで拡大"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <PromptDiff baseline={baselineBatch.prompt} current={promptText} />
                      <SettingsDiff
                        baseline={baselineBatch}
                        currentModel={model.label}
                        currentAspect={aspectRatio}
                      />
                    </div>
                  </div>
                </div>
              )}

              {(selectedInputs.length > 0 || selectedRefs.length > 0) && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {selectedInputs.map((it, i) => (
                    <Chip
                      key={it.id}
                      label={`@in${i + 1}`}
                      dataUrl={it.dataUrl}
                      onInsert={() => insertToken(`@in${i + 1} `)}
                      onRemove={() => removeFromSelection(it.id)}
                    />
                  ))}
                  {selectedRefs.map((it, i) => (
                    <Chip
                      key={it.id}
                      label={`@ref${i + 1}`}
                      dataUrl={it.dataUrl}
                      accent
                      onInsert={() => insertToken(`@ref${i + 1} `)}
                      onRemove={() => removeFromSelection(it.id)}
                    />
                  ))}
                </div>
              )}

              <textarea
                ref={promptRef}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="生成したい画像の説明を入力… 例: @in1 の人物を @ref1 の画風で、夜の街を背景に描いて"
                className="min-h-[110px] w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm outline-none focus:border-amber-400/60"
              />

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button variant="ghost" onClick={savePrompt} disabled={!promptText.trim()}>
                  💾 プロンプトを保存
                </Button>
                <Button variant="ghost" onClick={() => setPromptText("")} disabled={!promptText}>
                  クリア
                </Button>
                {selection.length > 0 && (
                  <Button variant="ghost" onClick={() => setSelection([])}>
                    画像選択をクリア
                  </Button>
                )}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>バッチ方式</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        {
                          key: "combined" as BatchMode,
                          title: "まとめて生成",
                          desc: "選択した入力画像を1回の生成にまとめて渡す（count枚出力）",
                        },
                        {
                          key: "perInput" as BatchMode,
                          title: "入力ごとに生成",
                          desc: "入力画像1枚ずつに同じプロンプト/参照を適用（入力枚数×count）",
                        },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.key}
                        onClick={() => setBatchMode(m.key)}
                        className={`rounded-lg border px-3 py-2 text-left transition ${
                          batchMode === m.key
                            ? "border-amber-400 bg-amber-400/10"
                            : "border-zinc-700 hover:border-zinc-500"
                        }`}
                      >
                        <div className="text-sm font-semibold">{m.title}</div>
                        <div className="mt-0.5 text-[11px] leading-tight text-zinc-400">{m.desc}</div>
                      </button>
                    ))}
                  </div>
                  {batchMode === "perInput" && (
                    <p className="mt-1 text-[11px] text-amber-300/80">
                      入力 {selectedInputs.length} 枚 × {count} = 合計 {totalImages} 枚を一括生成します。
                    </p>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <Label>モデル</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.values(MODELS).map((m) => (
                      <button
                        key={m.key}
                        onClick={() => setModelKey(m.key)}
                        className={`rounded-lg border px-3 py-2 text-left transition ${
                          modelKey === m.key
                            ? "border-amber-400 bg-amber-400/10"
                            : "border-zinc-700 hover:border-zinc-500"
                        }`}
                      >
                        <div className="text-sm font-semibold">{m.label}</div>
                        <div className="mt-0.5 text-[11px] leading-tight text-zinc-400">
                          {m.description}
                        </div>
                        <div className="mt-1 text-[11px] text-amber-400">
                          ≈ ${m.pricePerImage.toFixed(3)} / 枚
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label>アスペクト比</Label>
                  <select
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm outline-none focus:border-amber-400/60"
                  >
                    {model.aspectRatios.map((ar) => (
                      <option key={ar} value={ar}>
                        {ar}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label>
                    {batchMode === "perInput" ? `1入力あたりの枚数: ${count}` : `出力枚数: ${count}`}
                  </Label>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                    className="w-full accent-amber-400"
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={generate} className="px-5 py-2 text-base">
                  ✨ 生成する{jobs.length > 0 ? `（実行中 ${jobs.length}）` : ""}
                </Button>
                <div className="text-xs text-zinc-400">
                  概算コスト <b className="text-amber-400">${estCost}</b>
                  <span className="text-zinc-600"> （合計{totalImages}枚 × ${model.pricePerImage.toFixed(3)}）</span>
                </div>
              </div>

              {jobs.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {jobs.map((j) => (
                    <span
                      key={j.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-200"
                    >
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                      {j.label}
                      <b className="tabular-nums">{((Date.now() - j.startedAt) / 1000).toFixed(1)}s</b>
                    </span>
                  ))}
                </div>
              )}

              {error && (
                <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {error}
                </p>
              )}
            </Panel>
          </div>

          {/* 結果一覧 */}
          <div className="flex flex-col gap-4">
            {batches.length === 0 && (
              <div className="rounded-xl border border-dashed border-zinc-800 py-16 text-center text-sm text-zinc-600">
                まだ生成結果はありません。上のフォームから生成してください。
              </div>
            )}
            {batches.map((batch) => (
              <BatchCard
                key={batch.id}
                batch={batch}
                isBaseline={batch.id === baselineId}
                onToggleBaseline={() => toggleBaseline(batch.id)}
                onAddToPool={addResultToPool}
                onOpenImage={setLightbox}
                onReEdit={() => reEdit(batch)}
                onDownloadZip={() => downloadBatchZip(batch)}
                onDelete={() => deleteBatch(batch.id)}
              />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-zinc-400">{children}</label>;
}

function Chip({
  label,
  dataUrl,
  accent,
  onInsert,
  onRemove,
}: {
  label: string;
  dataUrl: string;
  accent?: boolean;
  onInsert: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-1.5 text-xs ${
        accent ? "border-sky-500/50 bg-sky-500/10" : "border-amber-400/50 bg-amber-400/10"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dataUrl} alt={label} className="h-6 w-6 rounded-full object-cover" />
      <button onClick={onInsert} title="プロンプトに挿入" className="font-mono">
        {label}
      </button>
      <button onClick={onRemove} className="text-zinc-500 hover:text-red-400">
        ×
      </button>
    </div>
  );
}

function BatchCard({
  batch,
  isBaseline,
  onToggleBaseline,
  onAddToPool,
  onOpenImage,
  onReEdit,
  onDownloadZip,
  onDelete,
}: {
  batch: Batch;
  isBaseline: boolean;
  onToggleBaseline: () => void;
  onAddToPool: (dataUrl: string, mimeType: string, role: Role) => void;
  onOpenImage: (img: LightboxImage) => void;
  onReEdit: () => void;
  onDownloadZip: () => void;
  onDelete: () => void;
}) {
  const used = getUsedImages(batch);
  const usedInputs = used.filter((u) => u.role === "input");
  const usedRefs = used.filter((u) => u.role === "reference");

  return (
    <div
      className={`rounded-xl border bg-zinc-900/40 ${
        isBaseline ? "border-amber-400 ring-1 ring-amber-400/40" : "border-zinc-800"
      }`}
    >
      {/* メタ情報 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-800 px-4 py-2.5 text-xs">
        {isBaseline && (
          <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-zinc-900">
            ★ 基準
          </span>
        )}
        <span className="font-semibold text-zinc-200">{batch.modelLabel}</span>
        <span className="text-zinc-500">{batch.aspectRatio}</span>
        <span className="text-zinc-500">
          {batch.results.length}/{batch.requestedCount} 枚
        </span>
        <span className="text-amber-400">${batch.costUsd.toFixed(3)}</span>
        <span className="text-zinc-400">⏱ {(batch.durationMs / 1000).toFixed(1)}s</span>
        {(batch.sentInputCount !== undefined || batch.sentReferenceCount !== undefined) && (
          <span
            className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300"
            title="この生成でGeminiへ実際に添付された枚数"
          >
            送信 入力<b className="text-amber-300">{batch.sentInputCount ?? 0}</b> / 参照
            <b className={batch.sentReferenceCount ? "text-sky-300" : "text-zinc-500"}>
              {batch.sentReferenceCount ?? 0}
            </b>
          </span>
        )}
        <span className="text-zinc-600">{new Date(batch.createdAt).toLocaleString("ja-JP")}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={isBaseline ? "primary" : "ghost"}
            className="px-2 py-1 text-xs"
            onClick={onToggleBaseline}
            title="良かった結果として基準に設定（現在のプロンプトとの差分を表示）"
          >
            {isBaseline ? "★ 基準中" : "☆ 基準にする"}
          </Button>
          <Button variant="default" className="px-2 py-1 text-xs" onClick={onReEdit} title="この内容を編集部へ読み込み">
            ↑ 再編集
          </Button>
          <Button
            variant="ghost"
            className="px-2 py-1 text-xs"
            onClick={onDownloadZip}
            disabled={batch.results.length === 0}
          >
            ⬇ Zip一括DL
          </Button>
          <Button variant="danger" className="px-2 py-1 text-xs" onClick={onDelete}>
            削除
          </Button>
        </div>
      </div>

      {/* 履歴: 使用した画像 + プロンプト */}
      <div className="space-y-2 border-b border-zinc-800/60 px-4 py-3 text-xs">
        {(usedInputs.length > 0 || usedRefs.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {usedInputs.length > 0 && (
              <HistoryThumbs label="入力" accent="amber" prefix="in" images={usedInputs} onOpenImage={onOpenImage} />
            )}
            {usedRefs.length > 0 && (
              <HistoryThumbs label="参照" accent="sky" prefix="ref" images={usedRefs} onOpenImage={onOpenImage} />
            )}
          </div>
        )}
        {batch.prompt ? (
          <p className="whitespace-pre-wrap text-zinc-300">
            <span className="text-zinc-500">プロンプト: </span>
            {batch.prompt}
          </p>
        ) : (
          <p className="text-zinc-600">プロンプトなし（画像のみ）</p>
        )}
      </div>

      {batch.errors.length > 0 && (
        <p className="border-b border-zinc-800/60 bg-red-500/5 px-4 py-2 text-xs text-red-300">
          ⚠ {batch.errors.join(" / ")}
        </p>
      )}

      {/* 結果画像 */}
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4">
        {batch.results.map((r) => (
          <div key={r.id} className="group relative overflow-hidden rounded-lg border border-zinc-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={r.dataUrl}
              alt="result"
              className="w-full cursor-zoom-in object-cover"
              onClick={() => onOpenImage({ ...r, assignable: true })}
              title="クリックで拡大表示"
            />
            {r.sourceName && (
              <span className="absolute left-1 top-1 max-w-[90%] truncate rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-zinc-200">
                ← {r.sourceName}
              </span>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-full items-stretch gap-1 bg-gradient-to-t from-black/85 to-transparent p-1.5 transition group-hover:translate-y-0 group-hover:pointer-events-auto">
              <Button
                variant="default"
                className="flex-1 px-1.5 py-1 text-[10px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToPool(r.dataUrl, r.mimeType, "input");
                }}
              >
                入力に
              </Button>
              <Button
                variant="default"
                className="flex-1 px-1.5 py-1 text-[10px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToPool(r.dataUrl, r.mimeType, "reference");
                }}
              >
                参照に
              </Button>
              <Button
                variant="default"
                className="px-1.5 py-1 text-[10px]"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadBlob(dataUrlToBlob(r.dataUrl), `${r.id}.${extFromMime(r.mimeType)}`);
                }}
              >
                ⬇
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsDiff({
  baseline,
  currentModel,
  currentAspect,
}: {
  baseline: Batch;
  currentModel: string;
  currentAspect: string;
}) {
  const diffs: { label: string; from: string; to: string }[] = [];
  if (baseline.modelLabel !== currentModel)
    diffs.push({ label: "モデル", from: baseline.modelLabel, to: currentModel });
  if (baseline.aspectRatio !== currentAspect)
    diffs.push({ label: "比率", from: baseline.aspectRatio, to: currentAspect });
  if (diffs.length === 0) return null;
  return (
    <p className="mt-1.5 text-[11px] text-zinc-400">
      {diffs.map((d, i) => (
        <span key={i} className="mr-3 whitespace-nowrap">
          {d.label}: <span className="text-red-300 line-through">{d.from}</span> →{" "}
          <span className="text-emerald-300">{d.to}</span>
        </span>
      ))}
    </p>
  );
}

function HistoryThumbs({
  label,
  accent,
  prefix,
  images,
  onOpenImage,
}: {
  label: string;
  accent: "amber" | "sky";
  prefix: string;
  images: UsedImage[];
  onOpenImage: (img: LightboxImage) => void;
}) {
  const color = accent === "amber" ? "text-amber-300" : "text-sky-300";
  const ring = accent === "amber" ? "border-amber-400/60" : "border-sky-400/60";
  return (
    <div className="flex items-center gap-1.5">
      <span className={`font-semibold ${color}`}>{label}</span>
      {images.map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={u.id + i}
          src={u.dataUrl}
          alt={`${prefix}${i + 1}`}
          title={`@${prefix}${i + 1} をクリックで拡大`}
          onClick={() =>
            onOpenImage({ id: `${u.id}_${i}`, dataUrl: u.dataUrl, mimeType: u.mimeType, assignable: false })
          }
          className={`h-10 w-10 cursor-zoom-in rounded border ${ring} object-cover`}
        />
      ))}
    </div>
  );
}
