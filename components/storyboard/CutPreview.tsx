"use client";

// 選択カットのプレビュー。修正指示 → 参照付き編集での再生成もここから。

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import * as db from "@/lib/db";
import type { ImageAsset } from "@/lib/types";
import {
  CAMERA_LABELS,
  COMPOSITION_LABELS,
  SHOT_SIZE_LABELS,
  type CameraAngle,
  type Composition,
  type Cut,
  type ShotSize,
} from "@/lib/storyboard/types";

export function CutPreview({
  cut,
  index,
  busy,
  onUpdate,
  onRegenerate,
  onRegenerateNoText,
  onExportPng,
  onZoom,
}: {
  cut: Cut | null;
  index: number;
  busy: boolean;
  onUpdate: (id: string, patch: Partial<Cut>) => void;
  /** 修正指示を反映して再生成（画像があれば参照付き編集） */
  onRegenerate: (id: string) => void;
  /** 文字混入リカバリ: no text 強調で再生成 */
  onRegenerateNoText: (id: string) => void;
  onExportPng: (id: string) => void;
  /** プレビュー画像をクリックで拡大表示 */
  onZoom: (fullUrl: string) => void;
}) {
  const [fullUrl, setFullUrl] = useState<string | null>(null);

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

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-300">
          カット #{index + 1}
          <span className="ml-2 text-zinc-500">
            {cut.durationHint || "-"}／
            {cut.camera ? CAMERA_LABELS[cut.camera] : "目線(自動)"}
            {cut.shotSize ? `・${SHOT_SIZE_LABELS[cut.shotSize]}` : ""}
          </span>
        </h3>
      </div>

      {/* 16:9 プレビュー */}
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
        {fullUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fullUrl}
            alt=""
            className="h-full w-full cursor-zoom-in object-contain"
            title="クリックで拡大"
            onClick={() => fullUrl && onZoom(fullUrl)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-700">
            {cut.status === "generating" ? "生成中…" : "未生成"}
          </div>
        )}
      </div>

      {/* ショット設計（アングル/サイズ/構図/ポーズ/背景） */}
      <div className="space-y-1.5 rounded border border-zinc-800 bg-zinc-900/40 p-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          🎥 ショット設計
        </p>
        <div className="flex gap-1.5">
          <select
            value={cut.camera ?? ""}
            onChange={(e) =>
              onUpdate(cut.id, {
                camera: (e.target.value || null) as CameraAngle | null,
                generatedPrompt: undefined,
              })
            }
            className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[11px]"
            title="カメラアングル"
          >
            <option value="">アングル</option>
            {(Object.keys(CAMERA_LABELS) as CameraAngle[]).map((k) => (
              <option key={k} value={k}>
                {CAMERA_LABELS[k]}
              </option>
            ))}
          </select>
          <select
            value={cut.shotSize ?? ""}
            onChange={(e) =>
              onUpdate(cut.id, {
                shotSize: (e.target.value || null) as ShotSize | null,
                generatedPrompt: undefined,
              })
            }
            className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[11px]"
            title="ショットサイズ"
          >
            <option value="">サイズ</option>
            {(Object.keys(SHOT_SIZE_LABELS) as ShotSize[]).map((k) => (
              <option key={k} value={k}>
                {SHOT_SIZE_LABELS[k]}
              </option>
            ))}
          </select>
          <select
            value={cut.composition ?? ""}
            onChange={(e) =>
              onUpdate(cut.id, {
                composition: (e.target.value || null) as Composition | null,
                generatedPrompt: undefined,
              })
            }
            className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[11px]"
            title="構図"
          >
            <option value="">構図: 指定なし</option>
            {(Object.keys(COMPOSITION_LABELS) as Composition[]).map((k) => (
              <option key={k} value={k}>
                {COMPOSITION_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <input
          value={cut.poseNote ?? ""}
          onChange={(e) =>
            onUpdate(cut.id, { poseNote: e.target.value, generatedPrompt: undefined })
          }
          placeholder="被写体のポーズ（例: しゃがんで猫に手を伸ばす）"
          className="w-full rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[11px]"
        />
        <input
          value={cut.backgroundNote ?? ""}
          onChange={(e) =>
            onUpdate(cut.id, { backgroundNote: e.target.value, generatedPrompt: undefined })
          }
          placeholder="背景の指定（例: ブロック塀と朝日を背景に）"
          className="w-full rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[11px]"
        />
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
            onClick={() => onExportPng(cut.id)}
          >
            PNG
          </Button>
        </div>
      </div>
    </div>
  );
}
