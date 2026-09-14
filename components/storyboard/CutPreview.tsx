"use client";

// 選択カットのプレビュー。修正指示 → 参照付き編集での再生成もここから。

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import * as db from "@/lib/db";
import type { ImageAsset } from "@/lib/types";
import { qaVerdict } from "@/lib/storyboard/qa";
import {
  CAMERA_LABELS,
  COMPOSITION_LABELS,
  LENS_LABELS,
  LIGHTING_LABELS,
  SHOT_SIZE_LABELS,
  type CameraAngle,
  type Composition,
  type Cut,
  type Lens,
  type Lighting,
  type ShotSize,
} from "@/lib/storyboard/types";

export function CutPreview({
  cut,
  index,
  busy,
  promptPreview,
  onUpdate,
  onRegenerate,
  onRegenerateNoText,
  onRerunQa,
  onRegenerateWithHint,
  onExportPng,
  onSetSketch,
  onClearSketch,
  onZoom,
}: {
  cut: Cut | null;
  index: number;
  busy: boolean;
  /** 生成前に確認できる「実際に送信されるプロンプト」（親でcutPromptOptions/previewCutPromptから算出） */
  promptPreview: string;
  onUpdate: (id: string, patch: Partial<Cut>) => void;
  /** 修正指示を反映して再生成（画像があれば参照付き編集） */
  onRegenerate: (id: string) => void;
  /** 文字混入リカバリ: no text 強調で再生成 */
  onRegenerateNoText: (id: string) => void;
  /** 再生成はせず、現在の画像に対してAIチェック(QA)だけやり直す */
  onRerunQa: (id: string) => void;
  /** QAのrevisionHintを付けて参照付き編集で再生成 */
  onRegenerateWithHint: (id: string) => void;
  onExportPng: (id: string) => void;
  /** スケッチの登録・差し替え */
  onSetSketch: (id: string, file: File) => void;
  /** スケッチの削除 */
  onClearSketch: (id: string) => void;
  /** プレビュー画像をクリックで拡大表示 */
  onZoom: (fullUrl: string) => void;
}) {
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sketchUrl, setSketchUrl] = useState<string | null>(null);
  const sketchFileRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    setFullUrl(null);
    setCopied(false);
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

  useEffect(() => {
    let alive = true;
    setSketchUrl(null);
    if (cut?.sketchAssetId) {
      db.get<ImageAsset>("assets", cut.sketchAssetId).then((a) => {
        if (alive) setSketchUrl(a?.dataUrl || cut.sketchThumbUrl || null);
      });
    } else if (cut?.sketchThumbUrl) {
      setSketchUrl(cut.sketchThumbUrl);
    }
    return () => {
      alive = false;
    };
  }, [cut?.id, cut?.sketchAssetId, cut?.sketchThumbUrl]);

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

      {/* 手書きスケッチ（レイアウト参照）。結果画像と並べて比較できるように表示する */}
      {cut.sketchAssetId && (
        <div className="space-y-1.5 rounded border border-zinc-800 bg-zinc-900/40 p-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              ✏ スケッチ（レイアウト参照）
            </p>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                className="px-1.5 py-0.5 text-[10px]"
                onClick={() => sketchFileRef.current?.click()}
              >
                差し替え
              </Button>
              <Button
                variant="danger"
                className="px-1.5 py-0.5 text-[10px]"
                onClick={() => onClearSketch(cut.id)}
              >
                削除
              </Button>
              <input
                ref={sketchFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onSetSketch(cut.id, f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-16 w-28 shrink-0 overflow-hidden rounded border border-zinc-800 bg-zinc-950">
              {sketchUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sketchUrl}
                  alt="スケッチ"
                  title="クリックで拡大"
                  className="h-full w-full cursor-zoom-in object-contain"
                  onClick={() => sketchUrl && onZoom(sketchUrl)}
                />
              )}
            </div>
            <div className="flex flex-1 flex-col gap-1 text-[11px]">
              <span className="text-zinc-500">踏襲度</span>
              <div className="flex gap-1">
                <button
                  className={`rounded px-2 py-0.5 transition ${
                    (cut.sketchStrength ?? "strict") === "strict"
                      ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50"
                      : "bg-zinc-800/60 text-zinc-500 hover:text-zinc-300"
                  }`}
                  onClick={() => onUpdate(cut.id, { sketchStrength: "strict" })}
                >
                  厳密に再現
                </button>
                <button
                  className={`rounded px-2 py-0.5 transition ${
                    cut.sketchStrength === "loose"
                      ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50"
                      : "bg-zinc-800/60 text-zinc-500 hover:text-zinc-300"
                  }`}
                  onClick={() => onUpdate(cut.id, { sketchStrength: "loose" })}
                >
                  ゆるく参考
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
        <div className="flex gap-1.5">
          <select
            value={cut.lighting ?? ""}
            onChange={(e) =>
              onUpdate(cut.id, {
                lighting: (e.target.value || null) as Lighting | null,
                generatedPrompt: undefined,
              })
            }
            className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[11px]"
            title="照明"
          >
            <option value="">照明: 指定なし</option>
            {(Object.keys(LIGHTING_LABELS) as Lighting[]).map((k) => (
              <option key={k} value={k}>
                {LIGHTING_LABELS[k]}
              </option>
            ))}
          </select>
          <select
            value={cut.lens ?? ""}
            onChange={(e) =>
              onUpdate(cut.id, {
                lens: (e.target.value || null) as Lens | null,
                generatedPrompt: undefined,
              })
            }
            className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[11px]"
            title="レンズ"
          >
            <option value="">レンズ: 指定なし</option>
            {(Object.keys(LENS_LABELS) as Lens[]).map((k) => (
              <option key={k} value={k}>
                {LENS_LABELS[k]}
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

      {/* 送信プロンプト（生成前に確認できる。実際に送信される内容と同じ） */}
      <details className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1.5">
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          📝 送信プロンプト
        </summary>
        <p className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-zinc-800 bg-zinc-950/60 p-1.5 font-mono text-[11px] leading-relaxed text-zinc-400">
          {promptPreview}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <Button
            variant="ghost"
            className="px-2 py-0.5 text-[11px]"
            onClick={() => {
              navigator.clipboard.writeText(promptPreview);
              setCopied(true);
            }}
          >
            {copied ? "コピーしました" : "コピー"}
          </Button>
          {cut.generatedPrompt && cut.generatedPrompt !== promptPreview && (
            <span className="text-[10px] text-amber-400/80">前回送信時から変更があります</span>
          )}
        </div>
      </details>

      {/* 生成後のAIチェック(QA) */}
      {cut.resultAssetId && (
        <div className="space-y-1 rounded border border-zinc-800 bg-zinc-900/40 p-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              🔍 AIチェック
            </p>
            <Button
              variant="ghost"
              className="px-1.5 py-0.5 text-[10px]"
              disabled={busy || cut.status === "generating"}
              onClick={() => onRerunQa(cut.id)}
            >
              再チェック
            </Button>
          </div>
          {cut.qa ? (
            <>
              <p className="text-[11px] text-zinc-400">
                ト書き一致 {cut.qa.actionMatch}/5 ・ キャラ {cut.qa.characterMatch}/5 ・ スタイル{" "}
                {cut.qa.styleMatch}/5
                {cut.qa.layoutMatch != null && <> ・ レイアウト {cut.qa.layoutMatch}/5</>} ・
                文字混入 {cut.qa.textDetected ? "あり" : "なし"}
                {qaVerdict(cut.qa) === "retry" && cut.qa.autoRetried && "（自動再生成済）"}
              </p>
              {cut.qa.issues.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-amber-300/90">
                  {cut.qa.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              )}
              {cut.qa.revisionHint && (
                <Button
                  className="px-2 py-0.5 text-[11px]"
                  disabled={busy || cut.status === "generating"}
                  onClick={() => onRegenerateWithHint(cut.id)}
                >
                  この指摘で再生成
                </Button>
              )}
            </>
          ) : (
            <p className="text-[11px] text-zinc-600">未チェック</p>
          )}
        </div>
      )}

      {cut.error && (
        <p className="rounded bg-red-950/40 px-2 py-1.5 text-[11px] text-red-300">{cut.error}</p>
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
