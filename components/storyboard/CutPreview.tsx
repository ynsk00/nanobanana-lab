"use client";

// 選択カットのプレビュー。画像に文字は焼かず、NA/T/SE を HTML/CSS の
// オーバーレイレイヤーとして重ねる。修正指示 → 参照付き編集での再生成もここから。

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import * as db from "@/lib/db";
import type { ImageAsset } from "@/lib/types";
import { CAMERA_LABELS, type Cut } from "@/lib/storyboard/types";

export function CutPreview({
  cut,
  index,
  busy,
  onUpdate,
  onRegenerate,
  onRegenerateNoText,
  onExportPng,
}: {
  cut: Cut | null;
  index: number;
  busy: boolean;
  onUpdate: (id: string, patch: Partial<Cut>) => void;
  /** 修正指示を反映して再生成（画像があれば参照付き編集） */
  onRegenerate: (id: string) => void;
  /** 文字混入リカバリ: no text 強調で再生成 */
  onRegenerateNoText: (id: string) => void;
  onExportPng: (id: string, withText: boolean) => void;
}) {
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [showText, setShowText] = useState(true);

  useEffect(() => {
    let alive = true;
    setFullUrl(null);
    if (cut?.resultAssetId) {
      db.get<ImageAsset>("assets", cut.resultAssetId).then((a) => {
        if (alive) setFullUrl(a?.dataUrl || cut.thumbUrl || null);
      });
    } else if (cut?.thumbUrl) {
      setFullUrl(cut.thumbUrl);
    }
    return () => {
      alive = false;
    };
  }, [cut?.id, cut?.resultAssetId, cut?.thumbUrl]);

  if (!cut) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-zinc-600">
        カット表から行を選択してください
      </div>
    );
  }

  const nas = cut.overlays.filter((o) => o.type === "NA");
  const prompts = cut.overlays.filter((o) => o.type === "PROMPT_UI");
  const ses = cut.overlays.filter((o) => o.type === "SE");

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-300">
          カット #{index + 1}
          <span className="ml-2 text-zinc-500">
            {cut.durationHint || "-"}／{cut.camera ? CAMERA_LABELS[cut.camera] : "人目線(自動)"}
          </span>
        </h3>
        <label className="flex items-center gap-1 text-[11px] text-zinc-400">
          <input
            type="checkbox"
            checked={showText}
            onChange={(e) => setShowText(e.target.checked)}
          />
          テキスト表示
        </label>
      </div>

      {/* 16:9 プレビュー + オーバーレイレイヤー */}
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
        {fullUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fullUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-700">
            {cut.status === "generating" ? "生成中…" : "未生成"}
          </div>
        )}

        {showText && (
          <>
            {/* PROMPT_UI: 疑似チャットウィンドウ（角丸・一行） */}
            <div className="pointer-events-none absolute inset-x-0 top-3 flex flex-col items-center gap-1.5 px-6">
              {prompts.map((o, i) => (
                <div
                  key={i}
                  className="max-w-full truncate rounded-full border border-black/20 bg-white/95 px-4 py-1.5 text-xs text-zinc-800 shadow"
                >
                  {o.text}
                </div>
              ))}
            </div>
            {/* SE: 右上ラベル */}
            <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1">
              {ses.map((o, i) => (
                <span key={i} className="rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                  SE: {o.text}
                </span>
              ))}
            </div>
            {/* NA: 下部・青字 */}
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-0.5 px-6">
              {nas.map((o, i) => (
                <p
                  key={i}
                  className="text-center text-sm font-bold text-blue-700"
                  style={{ textShadow: "0 0 3px rgba(255,255,255,.95), 0 0 6px rgba(255,255,255,.9)" }}
                >
                  {o.text}
                </p>
              ))}
            </div>
          </>
        )}
      </div>

      {cut.error && (
        <p className="rounded bg-red-950/40 px-2 py-1.5 text-[11px] text-red-300">{cut.error}</p>
      )}

      {/* 最終プロンプト（確認用） */}
      {cut.generatedPrompt && (
        <details className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1.5">
          <summary className="cursor-pointer text-[11px] text-zinc-500">送信プロンプト</summary>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-400">
            {cut.generatedPrompt}
          </p>
        </details>
      )}
      {cut.promptEn && !cut.generatedPrompt && (
        <p className="text-[11px] text-zinc-500">EN: {cut.promptEn}</p>
      )}

      {/* 修正指示 */}
      <div className="space-y-1.5">
        <textarea
          value={cut.editNote ?? ""}
          onChange={(e) => onUpdate(cut.id, { editNote: e.target.value })}
          placeholder="修正指示（例: 猫をもっと大きく、朝日を強調）。画像がある場合は参照付き編集として送信されます"
          rows={2}
          className="w-full resize-none rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 text-xs"
        />
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="primary"
            className="px-2.5 py-1 text-xs"
            disabled={busy || cut.status === "generating"}
            onClick={() => onRegenerate(cut.id)}
          >
            {cut.resultAssetId ? "🔁 修正して再生成" : "▶ 生成"}
          </Button>
          <Button
            className="px-2.5 py-1 text-xs"
            disabled={busy || cut.status === "generating" || !cut.resultAssetId}
            title="生成画像に文字が混入した場合: no text を強調して再生成"
            onClick={() => onRegenerateNoText(cut.id)}
          >
            🚫 文字が入った→再生成
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            className="px-2 py-1 text-[11px]"
            disabled={!cut.resultAssetId}
            onClick={() => onExportPng(cut.id, false)}
          >
            PNG
          </Button>
          <Button
            variant="ghost"
            className="px-2 py-1 text-[11px]"
            disabled={!cut.resultAssetId}
            onClick={() => onExportPng(cut.id, true)}
          >
            PNG(文字入り)
          </Button>
        </div>
      </div>
    </div>
  );
}
