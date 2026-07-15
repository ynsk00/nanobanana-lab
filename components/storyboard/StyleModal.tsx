"use client";

// プロジェクト共通のスタイル設定モーダル。
// カットごとに絵のトーンがばらつかないよう、プリセット・自由記述・
// トーン参照画像（言語化 + 参照同梱）をここで一元管理する。

import React, { useRef } from "react";
import { Button } from "@/components/ui";
import { STYLE_PRESETS } from "@/lib/storyboard/prompt";
import type { StoryboardProject, StylePresetKey } from "@/lib/storyboard/types";

export function StyleModal({
  project,
  analyzing,
  onClose,
  onPatch,
  onUploadStyleImage,
  onAnalyzeStyleImage,
  onClearStyleImage,
}: {
  project: StoryboardProject;
  /** トーン言語化の実行中フラグ */
  analyzing: boolean;
  onClose: () => void;
  onPatch: (p: Partial<StoryboardProject>) => void;
  onUploadStyleImage: (file: File) => void;
  onAnalyzeStyleImage: () => void;
  onClearStyleImage: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">🎨 スタイル設定（全カット共通）</h2>
          <Button variant="ghost" onClick={onClose}>✕ 閉じる</Button>
        </div>
        <p className="mb-3 text-xs text-zinc-500">
          ここで設定した内容はすべてのカット・キャラシート生成に同じ形で反映され、
          絵のトーンを揃えます。変更後の生成から適用されます。
        </p>

        {/* プリセット */}
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold text-zinc-400">プリセット</h3>
          {Object.values(STYLE_PRESETS).map((s) => (
            <label
              key={s.key}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition ${
                project.stylePreset === s.key
                  ? "border-amber-500/60 bg-amber-500/5"
                  : "border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <input
                type="radio"
                name="style-preset"
                checked={project.stylePreset === s.key}
                onChange={() => onPatch({ stylePreset: s.key as StylePresetKey })}
              />
              <span className="w-40 shrink-0 text-zinc-200">{s.label}</span>
              <span className="text-zinc-500">{s.description}</span>
            </label>
          ))}
          {project.stylePreset === "cinematic_photo" && (
            <p className="rounded bg-amber-950/40 px-2 py-1 text-[11px] text-amber-300">
              ⚠ 実写風は実在人物に酷似した画像が生成される可能性があります。
              肖像権・パブリシティ権に配慮できる用途（出演契約済みの企画コンテ等）でご利用ください。
            </p>
          )}
        </div>

        {/* 自由記述 */}
        <div className="mt-4">
          <h3 className="mb-1 text-xs font-semibold text-zinc-400">共通トーン指定（自由記述）</h3>
          <textarea
            value={project.styleNotes ?? ""}
            onChange={(e) => onPatch({ styleNotes: e.target.value })}
            placeholder="例: 朝の柔らかい光、フィルムグレイン、彩度低め、余白のある構図（日本語可）"
            rows={2}
            className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs"
          />
        </div>

        {/* トーン参照画像 */}
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <h3 className="mb-1 text-xs font-semibold text-zinc-400">
            トーン参照画像（この絵のトーンにしたい）
          </h3>
          <p className="mb-2 text-[11px] text-zinc-500">
            画像をアップロード →「トーンを言語化」で、色調・質感・ライティングをAIが解釈して
            全カットのプロンプトに反映します。画像そのものも参照として毎カットに同梱できます。
          </p>
          <div className="flex gap-3">
            <div className="flex h-24 w-40 shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-700 bg-zinc-800">
              {project.styleImageThumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={project.styleImageThumb} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-[10px] text-zinc-500">未設定</span>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap gap-1.5">
                <Button className="px-2 py-0.5 text-[11px]" onClick={() => fileRef.current?.click()}>
                  ⬆ アップロード
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadStyleImage(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="primary"
                  className="px-2 py-0.5 text-[11px]"
                  disabled={!project.styleImageAssetId || analyzing}
                  onClick={onAnalyzeStyleImage}
                >
                  {analyzing ? "解析中…" : "✨ トーンを言語化"}
                </Button>
                {project.styleImageAssetId && (
                  <Button variant="danger" className="px-2 py-0.5 text-[11px]" onClick={onClearStyleImage}>
                    削除
                  </Button>
                )}
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <input
                  type="checkbox"
                  checked={project.attachStyleImage !== false}
                  onChange={(e) => onPatch({ attachStyleImage: e.target.checked })}
                  disabled={!project.styleImageAssetId}
                />
                この画像を参照画像として毎カットに同梱する（トーンの再現性が上がります）
              </label>
            </div>
          </div>
          {project.styleImageEn !== undefined && (
            <div className="mt-2">
              <h4 className="mb-1 text-[11px] text-zinc-500">言語化されたスタイル（編集可・全カットに反映）</h4>
              <textarea
                value={project.styleImageEn}
                onChange={(e) => onPatch({ styleImageEn: e.target.value })}
                rows={3}
                className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 font-mono text-[11px] text-zinc-300"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
