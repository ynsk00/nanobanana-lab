"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Button, Panel } from "@/components/ui";
import { LibraryGrid } from "@/components/LibraryGrid";
import { ApiKeyModal } from "@/components/ApiKeyModal";
import { Lightbox } from "@/components/Lightbox";
import { getApiKey, maskKey } from "@/lib/settings";
import { MODELS, DEFAULT_MODEL_KEY, getModel } from "@/lib/pricing";
import type { Batch, GenerateResponse, ImageItem, PromptItem } from "@/lib/types";
import * as db from "@/lib/db";
import {
  approxBytes,
  compressForUpload,
  dataUrlToBlob,
  downloadBlob,
  extFromMime,
  fileToDataUrl,
  genId,
  makeThumbnail,
} from "@/lib/image";

// Vercelサーバーレス関数のリクエストボディ上限(約4.5MB)に対する安全マージン
const MAX_UPLOAD_BYTES = 4_000_000;

export default function Home() {
  // --- ライブラリ ---
  const [inputs, setInputs] = useState<ImageItem[]>([]);
  const [references, setReferences] = useState<ImageItem[]>([]);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);

  // --- 選択状態（添付） ---
  const [selInputIds, setSelInputIds] = useState<string[]>([]);
  const [selRefIds, setSelRefIds] = useState<string[]>([]);

  // --- 生成設定 ---
  const [promptText, setPromptText] = useState("");
  const [modelKey, setModelKey] = useState(DEFAULT_MODEL_KEY);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [count, setCount] = useState(1);

  // --- 生成中の状態 ---
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // --- APIキー ---
  const [apiKey, setApiKeyState] = useState("");
  const [keyModalOpen, setKeyModalOpen] = useState(false);

  // --- 拡大表示(ライトボックス) ---
  const [lightbox, setLightbox] = useState<{
    id: string;
    dataUrl: string;
    mimeType: string;
  } | null>(null);

  // --- クリップボード貼り付け先（クリックで選んだライブラリ） ---
  const [pasteTarget, setPasteTarget] = useState<"inputs" | "references">("inputs");
  const pasteTargetRef = useRef<"inputs" | "references">("inputs");
  useEffect(() => {
    pasteTargetRef.current = pasteTarget;
  }, [pasteTarget]);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const model = getModel(modelKey);

  // 初回ロード: IndexedDB から復元
  useEffect(() => {
    (async () => {
      const [i, r, p, b] = await Promise.all([
        db.getAll<ImageItem>("inputs"),
        db.getAll<ImageItem>("references"),
        db.getAll<PromptItem>("prompts"),
        db.getAll<Batch>("batches"),
      ]);
      setInputs(i.sort((a, b) => b.createdAt - a.createdAt));
      setReferences(r.sort((a, b) => b.createdAt - a.createdAt));
      setPrompts(p.sort((a, b) => b.createdAt - a.createdAt));
      setBatches(b.sort((a, b) => b.createdAt - a.createdAt));
    })();
    // APIキーを localStorage から復元。未設定なら設定モーダルを開く。
    const k = getApiKey();
    setApiKeyState(k);
    if (!k) setKeyModalOpen(true);
  }, []);

  // モデル変更時、選択中アスペクト比がそのモデルで無効なら先頭に寄せる
  useEffect(() => {
    if (!model.aspectRatios.includes(aspectRatio)) {
      setAspectRatio(model.aspectRatios[0]);
    }
  }, [model, aspectRatio]);

  // 生成中の経過時間タイマー
  useEffect(() => {
    if (!generating) return;
    const t0 = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Date.now() - t0), 100);
    return () => clearInterval(timer);
  }, [generating]);

  // --- ライブラリ操作 ---
  const addImagesToLibrary = useCallback(
    async (files: FileList | File[], store: "inputs" | "references") => {
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
        await db.put(store, item);
        items.push(item);
      }
      if (store === "inputs") setInputs((p) => [...items, ...p]);
      else setReferences((p) => [...items, ...p]);
    },
    []
  );

  // ⌘V / Ctrl+V でクリップボードの画像をアクティブなライブラリへ貼り付け
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
      if (files.length === 0) return; // 画像でなければ通常の貼り付けを妨げない
      e.preventDefault();
      addImagesToLibrary(files, pasteTargetRef.current);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addImagesToLibrary]);

  const deleteImage = useCallback(
    async (item: ImageItem, store: "inputs" | "references") => {
      await db.del(store, item.id);
      if (store === "inputs") {
        setInputs((p) => p.filter((x) => x.id !== item.id));
        setSelInputIds((p) => p.filter((id) => id !== item.id));
      } else {
        setReferences((p) => p.filter((x) => x.id !== item.id));
        setSelRefIds((p) => p.filter((id) => id !== item.id));
      }
    },
    []
  );

  const toggleSelect = useCallback(
    (item: ImageItem, kind: "input" | "ref") => {
      const setter = kind === "input" ? setSelInputIds : setSelRefIds;
      setter((prev) =>
        prev.includes(item.id)
          ? prev.filter((id) => id !== item.id)
          : [...prev, item.id]
      );
    },
    []
  );

  // 生成結果を入力ライブラリへ取り込む
  const useResultAsInput = useCallback(async (dataUrl: string, mimeType: string) => {
    const item: ImageItem = {
      id: genId("img_"),
      dataUrl,
      mimeType,
      name: `generated_${new Date().toISOString().slice(0, 19)}`,
      origin: "generated",
      createdAt: Date.now(),
    };
    await db.put("inputs", item);
    setInputs((p) => [item, ...p]);
    setSelInputIds((p) => [...p, item.id]);
  }, []);

  // --- プロンプト・シンタックス挿入 ---
  const insertToken = useCallback((token: string) => {
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
  }, [promptText]);

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

  // 選択中の画像（順序付き）
  const selectedInputs = useMemo(
    () => selInputIds.map((id) => inputs.find((x) => x.id === id)).filter(Boolean) as ImageItem[],
    [selInputIds, inputs]
  );
  const selectedRefs = useMemo(
    () => selRefIds.map((id) => references.find((x) => x.id === id)).filter(Boolean) as ImageItem[],
    [selRefIds, references]
  );

  const estCost = (count * model.pricePerImage).toFixed(3);

  // --- 生成実行 ---
  const generate = useCallback(async () => {
    setError(null);
    if (!apiKey) {
      setKeyModalOpen(true);
      setError("先に Gemini APIキーを設定してください。");
      return;
    }
    if (!promptText.trim() && selectedInputs.length === 0) {
      setError("プロンプトまたは入力画像を指定してください。");
      return;
    }
    setGenerating(true);
    try {
      // 送信前に画像を縮小・圧縮(ボディ上限対策)。原本はライブラリに残す。
      const [inputImages, referenceImages] = await Promise.all([
        Promise.all(selectedInputs.map((x) => compressForUpload(x.dataUrl))),
        Promise.all(selectedRefs.map((x) => compressForUpload(x.dataUrl))),
      ]);

      // それでも上限を超える場合は、より小さく再圧縮を試みる
      let payloadIn = inputImages;
      let payloadRef = referenceImages;
      let totalBytes = [...payloadIn, ...payloadRef].reduce(
        (s, d) => s + approxBytes(d),
        0
      );
      if (totalBytes > MAX_UPLOAD_BYTES) {
        [payloadIn, payloadRef] = await Promise.all([
          Promise.all(selectedInputs.map((x) => compressForUpload(x.dataUrl, 1024, 0.72))),
          Promise.all(selectedRefs.map((x) => compressForUpload(x.dataUrl, 1024, 0.72))),
        ]);
        totalBytes = [...payloadIn, ...payloadRef].reduce(
          (s, d) => s + approxBytes(d),
          0
        );
      }
      if (totalBytes > MAX_UPLOAD_BYTES) {
        throw new Error(
          `添付画像の合計サイズが大きすぎます(約${(totalBytes / 1_000_000).toFixed(1)}MB)。枚数を減らすか、より小さい画像を使ってください。`
        );
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gemini-api-key": apiKey,
        },
        body: JSON.stringify({
          modelKey,
          aspectRatio,
          count,
          prompt: promptText,
          inputImages: payloadIn,
          referenceImages: payloadRef,
        }),
      });
      if (!res.ok) {
        if (res.status === 413) {
          throw new Error(
            "送信データが大きすぎます(413)。入力画像の枚数を減らすか、小さい画像を使ってください。"
          );
        }
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `生成に失敗しました (${res.status})`);
      }
      const data: GenerateResponse = await res.json();

      const [inputThumbs, referenceThumbs] = await Promise.all([
        Promise.all(selectedInputs.map((x) => makeThumbnail(x.dataUrl))),
        Promise.all(selectedRefs.map((x) => makeThumbnail(x.dataUrl))),
      ]);

      const batch: Batch = {
        id: genId("batch_"),
        createdAt: Date.now(),
        modelKey,
        modelLabel: model.label,
        modelId: model.id,
        aspectRatio,
        requestedCount: count,
        prompt: promptText,
        inputThumbs,
        referenceThumbs,
        results: data.results,
        costUsd: data.costUsd,
        durationMs: data.durationMs,
        errors: data.errors || [],
      };
      await db.put("batches", batch);
      setBatches((p) => [batch, ...p]);
      if (data.results.length === 0) {
        setError(
          "画像が返却されませんでした: " +
            (data.errors?.join(" / ") || "理由不明")
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [
    apiKey,
    promptText,
    selectedInputs,
    selectedRefs,
    modelKey,
    aspectRatio,
    count,
    model,
  ]);

  // --- バッチ操作 ---
  const deleteBatch = useCallback(async (id: string) => {
    await db.del("batches", id);
    setBatches((p) => p.filter((x) => x.id !== id));
  }, []);

  const downloadBatchZip = useCallback(async (batch: Batch) => {
    const zip = new JSZip();
    const stamp = new Date(batch.createdAt)
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const folder = zip.folder(`batch_${stamp}`)!;
    batch.results.forEach((r, i) => {
      const blob = dataUrlToBlob(r.dataUrl);
      folder.file(`image_${String(i + 1).padStart(2, "0")}.${extFromMime(r.mimeType)}`, blob);
    });
    // メタデータも同梱
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

  const totalCost = useMemo(
    () => batches.reduce((s, b) => s + b.costUsd, 0),
    [batches]
  );

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-24">
      {/* ヘッダー */}
      <header className="sticky top-0 z-20 -mx-4 mb-4 flex items-center justify-between border-b border-zinc-800 bg-[#0b0b0f]/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-xl">🍌</span>
          <h1 className="text-lg font-bold">Nano Banana Lab</h1>
          <span className="text-xs text-zinc-500">Gemini 画像生成 実験サイト</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <span>
            バッチ数 <b className="text-zinc-200">{batches.length}</b>
          </span>
          <span>
            累計コスト概算 <b className="text-amber-400">${totalCost.toFixed(3)}</b>
          </span>
          <Button
            variant={apiKey ? "ghost" : "primary"}
            className="px-2.5 py-1 text-xs"
            onClick={() => setKeyModalOpen(true)}
            title={apiKey ? `設定済み: ${maskKey(apiKey)}` : "APIキー未設定"}
          >
            ⚙ APIキー
            <span
              className={`ml-1 inline-block h-2 w-2 rounded-full ${
                apiKey ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
          </Button>
        </div>
      </header>

      <ApiKeyModal
        open={keyModalOpen}
        onClose={() => setKeyModalOpen(false)}
        onSaved={(k) => setApiKeyState(k)}
      />

      <Lightbox
        image={lightbox}
        onClose={() => setLightbox(null)}
        onUseAsInput={useResultAsInput}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* 左: ライブラリ */}
        <aside className="flex flex-col gap-4">
          <ImageLibraryPanel
            title="入力画像ライブラリ"
            items={inputs}
            selectedIds={selInputIds}
            badgePrefix="in"
            store="inputs"
            active={pasteTarget === "inputs"}
            onActivate={() => setPasteTarget("inputs")}
            onUpload={(f) => addImagesToLibrary(f, "inputs")}
            onToggle={(it) => toggleSelect(it, "input")}
            onDelete={(it) => deleteImage(it, "inputs")}
          />
          <ImageLibraryPanel
            title="リファレンス画像ライブラリ"
            items={references}
            selectedIds={selRefIds}
            badgePrefix="ref"
            store="references"
            active={pasteTarget === "references"}
            onActivate={() => setPasteTarget("references")}
            onUpload={(f) => addImagesToLibrary(f, "references")}
            onToggle={(it) => toggleSelect(it, "ref")}
            onDelete={(it) => deleteImage(it, "references")}
          />
          <Panel title="プロンプトライブラリ">
            {prompts.length === 0 ? (
              <p className="py-2 text-center text-xs text-zinc-600">
                保存したプロンプトはありません
              </p>
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
          {/* コンポーザー */}
          <Panel
            title="生成"
            right={
              <span className="text-[11px] text-zinc-500">
                プロンプトで <code className="text-amber-400">@in1</code> /{" "}
                <code className="text-amber-400">@ref1</code> と書くと添付画像を参照できます
              </span>
            }
          >
            {/* 添付中の画像チップ */}
            {(selectedInputs.length > 0 || selectedRefs.length > 0) && (
              <div className="mb-3 flex flex-wrap gap-2">
                {selectedInputs.map((it, i) => (
                  <Chip
                    key={it.id}
                    label={`@in${i + 1}`}
                    dataUrl={it.dataUrl}
                    onInsert={() => insertToken(`@in${i + 1} `)}
                    onRemove={() => toggleSelect(it, "input")}
                  />
                ))}
                {selectedRefs.map((it, i) => (
                  <Chip
                    key={it.id}
                    label={`@ref${i + 1}`}
                    dataUrl={it.dataUrl}
                    accent
                    onInsert={() => insertToken(`@ref${i + 1} `)}
                    onRemove={() => toggleSelect(it, "ref")}
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
              <Button
                variant="ghost"
                onClick={() => setPromptText("")}
                disabled={!promptText}
              >
                クリア
              </Button>
            </div>

            {/* 設定行 */}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* モデル選択 */}
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
                <Label>出力枚数: {count}</Label>
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

            {/* 実行ボタン + 概算 */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                onClick={generate}
                disabled={generating}
                className="px-5 py-2 text-base"
              >
                {generating ? "生成中…" : "✨ 生成する"}
              </Button>
              <div className="text-xs text-zinc-400">
                概算コスト{" "}
                <b className="text-amber-400">${estCost}</b>
                <span className="text-zinc-600"> （{count}枚 × ${model.pricePerImage.toFixed(3)}）</span>
              </div>
              {generating && (
                <div className="text-xs text-zinc-400">
                  経過 <b className="tabular-nums text-zinc-200">{(elapsed / 1000).toFixed(1)}s</b>
                </div>
              )}
            </div>

            {error && (
              <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}
          </Panel>

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
                onUseAsInput={useResultAsInput}
                onOpenImage={setLightbox}
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
  return (
    <label className="mb-1 block text-xs font-medium text-zinc-400">
      {children}
    </label>
  );
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

function ImageLibraryPanel({
  title,
  items,
  selectedIds,
  badgePrefix,
  store,
  active,
  onActivate,
  onUpload,
  onToggle,
  onDelete,
}: {
  title: string;
  items: ImageItem[];
  selectedIds: string[];
  badgePrefix: string;
  store: "inputs" | "references";
  active: boolean;
  onActivate: () => void;
  onUpload: (files: FileList) => void;
  onToggle: (item: ImageItem) => void;
  onDelete: (item: ImageItem) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {title}
          {active && (
            <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
              ⌘V対象
            </span>
          )}
        </span>
      }
      className={active ? "ring-1 ring-amber-400/50" : ""}
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
          if (e.target.files) onUpload(e.target.files);
          e.target.value = "";
        }}
      />
      <div
        tabIndex={0}
        onClick={onActivate}
        onFocus={onActivate}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          onActivate();
          if (e.dataTransfer.files.length) onUpload(e.dataTransfer.files);
        }}
        className={`rounded-lg outline-none ${drag ? "ring-2 ring-amber-400" : ""}`}
      >
        <LibraryGrid
          items={items}
          selectedIds={selectedIds}
          badgePrefix={badgePrefix}
          onToggle={onToggle}
          onDelete={onDelete}
          emptyText="ドラッグ&ドロップ / ＋追加 / クリックして ⌘V で貼り付け"
        />
        <p className="mt-2 text-center text-[10px] text-zinc-600">
          このパネルをクリックして <kbd className="rounded bg-zinc-800 px-1">⌘V</kbd> でクリップボードの画像を貼り付け
        </p>
      </div>
    </Panel>
  );
}

function BatchCard({
  batch,
  onUseAsInput,
  onOpenImage,
  onDownloadZip,
  onDelete,
}: {
  batch: Batch;
  onUseAsInput: (dataUrl: string, mimeType: string) => void;
  onOpenImage: (img: { id: string; dataUrl: string; mimeType: string }) => void;
  onDownloadZip: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-800 px-4 py-2.5 text-xs">
        <span className="font-semibold text-zinc-200">{batch.modelLabel}</span>
        <span className="text-zinc-500">{batch.aspectRatio}</span>
        <span className="text-zinc-500">
          {batch.results.length}/{batch.requestedCount} 枚
        </span>
        <span className="text-amber-400">${batch.costUsd.toFixed(3)}</span>
        <span className="text-zinc-400">⏱ {(batch.durationMs / 1000).toFixed(1)}s</span>
        <span className="text-zinc-600">
          {new Date(batch.createdAt).toLocaleString("ja-JP")}
        </span>
        <div className="ml-auto flex items-center gap-1">
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

      {batch.prompt && (
        <p className="border-b border-zinc-800/60 px-4 py-2 text-xs text-zinc-400">
          {batch.prompt}
        </p>
      )}

      {batch.errors.length > 0 && (
        <p className="border-b border-zinc-800/60 bg-red-500/5 px-4 py-2 text-xs text-red-300">
          ⚠ {batch.errors.join(" / ")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4">
        {batch.results.map((r) => (
          <div key={r.id} className="group relative overflow-hidden rounded-lg border border-zinc-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={r.dataUrl}
              alt="result"
              className="w-full cursor-zoom-in object-cover"
              onClick={() => onOpenImage(r)}
              title="クリックで拡大表示"
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-full gap-1 bg-gradient-to-t from-black/80 to-transparent p-1.5 transition group-hover:translate-y-0 group-hover:pointer-events-auto">
              <Button
                variant="default"
                className="flex-1 px-2 py-1 text-[11px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onUseAsInput(r.dataUrl, r.mimeType);
                }}
              >
                入力に使う
              </Button>
              <Button
                variant="default"
                className="px-2 py-1 text-[11px]"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadBlob(
                    dataUrlToBlob(r.dataUrl),
                    `${r.id}.${extFromMime(r.mimeType)}`
                  );
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
