"use client";

// 画面下の常設ドック。モーダルを廃し、1画面で設定を維持しながら作業できるようにする。
// 左: キャラシート（横並びカード） / 右: スタイル設定（プリセット・高画質化・トーン参照）

import React, { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { STYLE_PRESETS } from "@/lib/storyboard/prompt";
import type {
  CharacterSheet,
  StoryboardProject,
  StylePresetKey,
} from "@/lib/storyboard/types";

/** キャラ1体分のコンパクトカード */
function CharacterCard({
  c,
  busy,
  onUpdate,
  onDelete,
  onGenerate,
  onGenerateFromFace,
  onUpload,
}: {
  c: CharacterSheet;
  busy: boolean;
  onUpdate: (key: string, patch: Partial<CharacterSheet>) => void;
  onDelete: (key: string) => void;
  onGenerate: (key: string) => void;
  onGenerateFromFace: (key: string) => void;
  onUpload: (key: string, file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex w-[250px] shrink-0 gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
      {/* 基準画像 */}
      <div className="flex w-[72px] shrink-0 flex-col gap-1">
        <div className="flex h-[96px] w-[72px] items-center justify-center overflow-hidden rounded border border-zinc-700 bg-zinc-800">
          {c.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.thumbUrl} alt={c.key} className="h-full w-full object-cover" />
          ) : (
            <span className="px-1 text-center text-[9px] leading-tight text-zinc-500">
              基準画像
              <br />
              未設定
            </span>
          )}
        </div>
        <div className="flex gap-0.5">
          <Button
            className="flex-1 px-0 py-0.5 text-[10px]"
            disabled={busy || !c.descriptionJa.trim()}
            title="記述文から立ち姿を生成"
            onClick={() => onGenerate(c.key)}
          >
            生成
          </Button>
          <Button
            className="flex-1 px-0 py-0.5 text-[10px]"
            title="画像をアップロード（実在人物の顔写真も可。名前はAPIへ送られません）"
            onClick={() => fileRef.current?.click()}
          >
            ⬆
          </Button>
        </div>
        {c.imageAssetId && (
          <Button
            className="px-0 py-0.5 text-[9px]"
            disabled={busy}
            title="アップロードした顔写真から同一人物の立ち姿を生成"
            onClick={() => onGenerateFromFace(c.key)}
          >
            顔→立ち姿
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(c.key, f);
            e.target.value = "";
          }}
        />
      </div>
      {/* 名前・記述 */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1">
          <input
            value={c.displayName}
            onChange={(e) => onUpdate(c.key, { displayName: e.target.value })}
            placeholder="名前"
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs font-semibold"
            title="表示名（カット表のチップに表示。プロンプトには渡されません）"
          />
          <button
            className="shrink-0 text-xs text-zinc-600 hover:text-red-400"
            title="このキャラクターを削除"
            onClick={() => onDelete(c.key)}
          >
            ✕
          </button>
        </div>
        <input
          value={c.key}
          onChange={(e) =>
            onUpdate(c.key, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })
          }
          className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-amber-300/80"
          title="プレースホルダーキー（プロンプトにはこちらが渡ります）"
        />
        <textarea
          value={c.descriptionJa}
          onChange={(e) => onUpdate(c.key, { descriptionJa: e.target.value, descriptionEn: undefined })}
          placeholder="外見の記述（例: 30代の日本人男性、無精ひげ、スーツ）"
          rows={3}
          className="min-h-0 flex-1 resize-none rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-[11px] leading-snug"
          title={c.descriptionEn ? `EN: ${c.descriptionEn}` : undefined}
        />
        {busy && <span className="text-[10px] text-amber-400">生成中…</span>}
      </div>
    </div>
  );
}

export function BottomDock({
  project,
  charBusyKey,
  analyzing,
  onPatch,
  onUpdateChar,
  onAddChar,
  onDeleteChar,
  onGenerateChar,
  onGenerateCharFromFace,
  onUploadChar,
  onUploadStyleImage,
  onAnalyzeStyleImage,
  onClearStyleImage,
  onAddBanned,
  onRemoveBanned,
}: {
  project: StoryboardProject;
  charBusyKey: string | null;
  analyzing: boolean;
  onPatch: (p: Partial<StoryboardProject>) => void;
  onUpdateChar: (key: string, patch: Partial<CharacterSheet>) => void;
  onAddChar: () => void;
  onDeleteChar: (key: string) => void;
  onGenerateChar: (key: string) => void;
  onGenerateCharFromFace: (key: string) => void;
  onUploadChar: (key: string, file: File) => void;
  onUploadStyleImage: (file: File) => void;
  onAnalyzeStyleImage: () => void;
  onClearStyleImage: () => void;
  onAddBanned: (name: string) => void;
  onRemoveBanned: (name: string) => void;
}) {
  const styleFileRef = useRef<HTMLInputElement>(null);
  const [banInput, setBanInput] = useState("");

  return (
    <div className="flex h-[220px] shrink-0 border-t border-zinc-800 bg-zinc-950/60">
      {/* ===== キャラシート（横並び） ===== */}
      <div className="flex min-w-0 flex-1 flex-col border-r border-zinc-800">
        <div className="flex items-center gap-2 border-b border-zinc-800/60 px-2 py-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            🎭 キャラシート
          </span>
          <span className="text-[10px] text-zinc-600">
            基準画像は全カット生成に参照として同梱。名前は表示用でプロンプトへはキー+記述文が渡ります
          </span>
          <div className="flex-1" />
          <Button className="px-2 py-0.5 text-[11px]" onClick={onAddChar}>
            ＋ 追加
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 items-stretch gap-2 overflow-x-auto p-2">
          {project.characters.length === 0 && (
            <p className="self-center px-3 text-xs text-zinc-600">
              カット表に分解するとキャラ候補が自動で並びます（＋追加で手動登録も可）
            </p>
          )}
          {project.characters.map((c) => (
            <CharacterCard
              key={c.key}
              c={c}
              busy={charBusyKey === c.key}
              onUpdate={onUpdateChar}
              onDelete={onDeleteChar}
              onGenerate={onGenerateChar}
              onGenerateFromFace={onGenerateCharFromFace}
              onUpload={onUploadChar}
            />
          ))}
        </div>
      </div>

      {/* ===== スタイル設定 ===== */}
      <div className="flex w-[420px] shrink-0 flex-col overflow-y-auto">
        <div className="flex items-center gap-2 border-b border-zinc-800/60 px-2 py-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            🎨 スタイル（全カット共通）
          </span>
        </div>
        <div className="space-y-2 p-2">
          <div className="flex items-center gap-2">
            <select
              value={project.stylePreset}
              onChange={(e) => onPatch({ stylePreset: e.target.value as StylePresetKey })}
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs"
              title="表現スタイルのプリセット"
            >
              {Object.values(STYLE_PRESETS).map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label} — {s.description}
                </option>
              ))}
            </select>
          </div>
          {project.stylePreset === "cinematic_photo" && (
            <p className="rounded bg-amber-950/40 px-2 py-1 text-[10px] leading-snug text-amber-300">
              ⚠ 実写風は実在人物に酷似した画像が生成される可能性があります。肖像権に配慮できる用途でご利用ください。
            </p>
          )}

          <div>
            <label className="mb-0.5 block text-[10px] text-zinc-500">
              高画質化プロンプト（全生成の末尾に付与）
            </label>
            <textarea
              value={project.qualityPrompt ?? ""}
              onChange={(e) => onPatch({ qualityPrompt: e.target.value })}
              placeholder="masterpiece, best quality, highly detailed, ..."
              rows={2}
              className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-[11px]"
            />
          </div>

          <div>
            <label className="mb-0.5 block text-[10px] text-zinc-500">
              共通トーン指定（自由記述・日本語可）
            </label>
            <textarea
              value={project.styleNotes ?? ""}
              onChange={(e) => onPatch({ styleNotes: e.target.value })}
              placeholder="例: 朝の柔らかい光、彩度低め、余白のある構図"
              rows={2}
              className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px]"
            />
          </div>

          {/* トーン参照画像 */}
          <div className="flex gap-2">
            <div
              className="flex h-[54px] w-[96px] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded border border-zinc-700 bg-zinc-800"
              title="トーン参照画像（この絵のトーンにしたい画像）"
              onClick={() => styleFileRef.current?.click()}
            >
              {project.styleImageThumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={project.styleImageThumb} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-center text-[9px] leading-tight text-zinc-500">
                  トーン参照
                  <br />＋
                </span>
              )}
            </div>
            <input
              ref={styleFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadStyleImage(f);
                e.target.value = "";
              }}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="primary"
                  className="px-1.5 py-0.5 text-[10px]"
                  disabled={!project.styleImageAssetId || analyzing}
                  title="画像のトーン（色調・質感・光）をAIが言語化して全カットへ反映"
                  onClick={onAnalyzeStyleImage}
                >
                  {analyzing ? "解析中…" : "✨ トーンを言語化"}
                </Button>
                {project.styleImageAssetId && (
                  <Button variant="danger" className="px-1.5 py-0.5 text-[10px]" onClick={onClearStyleImage}>
                    削除
                  </Button>
                )}
              </div>
              <label className="flex items-center gap-1 text-[10px] text-zinc-400">
                <input
                  type="checkbox"
                  checked={project.attachStyleImage !== false}
                  onChange={(e) => onPatch({ attachStyleImage: e.target.checked })}
                  disabled={!project.styleImageAssetId}
                />
                参照画像として毎カットに同梱
              </label>
            </div>
          </div>
          {project.styleImageEn !== undefined && (
            <textarea
              value={project.styleImageEn}
              onChange={(e) => onPatch({ styleImageEn: e.target.value })}
              rows={2}
              title="言語化されたトーン（編集可・全カットに反映）"
              className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-[10px] text-zinc-300"
            />
          )}

          {/* 実在人名辞書 */}
          <details className="rounded border border-red-900/40 bg-red-950/15 px-2 py-1">
            <summary className="cursor-pointer text-[10px] font-semibold text-red-300">
              🚫 実在人名・IP辞書 ({project.bannedNames.length}) — 含まれるプロンプトは送信ブロック
            </summary>
            <div className="mt-1 flex flex-wrap gap-1">
              {project.bannedNames.map((n) => (
                <span
                  key={n}
                  className="inline-flex items-center gap-1 rounded-full bg-red-900/40 px-1.5 py-0.5 text-[10px] text-red-200"
                >
                  {n}
                  <button className="text-red-400 hover:text-red-200" onClick={() => onRemoveBanned(n)}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <form
              className="mt-1 flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (banInput.trim()) onAddBanned(banInput.trim());
                setBanInput("");
              }}
            >
              <input
                value={banInput}
                onChange={(e) => setBanInput(e.target.value)}
                placeholder="人名・IP語を追加"
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px]"
              />
              <Button type="submit" className="px-1.5 py-0.5 text-[10px]">追加</Button>
            </form>
          </details>
        </div>
      </div>
    </div>
  );
}
