"use client";

// カット表。1行 = 1カット。ト書き編集・結合/分割・画角/秒数の修正・
// キャラ紐付けの切替を行う。行クリックでプレビュー対象を選択。

import React from "react";
import { Button } from "@/components/ui";
import { findNameViolations } from "@/lib/storyboard/guard";
import {
  CAMERA_LABELS,
  type CameraAngle,
  type CharacterSheet,
  type Cut,
  type Scene,
} from "@/lib/storyboard/types";

const STATUS_BADGE: Record<Cut["status"], { label: string; cls: string }> = {
  draft: { label: "未生成", cls: "bg-zinc-800 text-zinc-400" },
  queued: { label: "待機中", cls: "bg-sky-900/50 text-sky-300" },
  generating: { label: "生成中…", cls: "bg-amber-900/50 text-amber-300 animate-pulse" },
  done: { label: "完了", cls: "bg-emerald-900/50 text-emerald-300" },
  error: { label: "エラー", cls: "bg-red-900/50 text-red-300" },
};

const OVERLAY_STYLE: Record<string, string> = {
  NA: "bg-blue-900/40 text-blue-300",
  PROMPT_UI: "bg-violet-900/40 text-violet-300",
  SE: "bg-zinc-800 text-zinc-400",
  DIALOGUE: "bg-zinc-800/60 text-zinc-500",
};

/** シーン見出し行。共通の舞台設定をここで編集する（シーン内全カットに反映） */
function SceneHeader({
  scene,
  onUpdateScene,
}: {
  scene: Scene;
  onUpdateScene: (id: string, patch: Partial<Scene>) => void;
}) {
  return (
    <div className="rounded-md border border-sky-900/50 bg-sky-950/20 px-2.5 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-500">
          Scene
        </span>
        <input
          value={scene.name}
          onChange={(e) => onUpdateScene(scene.id, { name: e.target.value })}
          placeholder="シーン名"
          className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-sky-200 outline-none placeholder:text-sky-800"
        />
      </div>
      <textarea
        value={scene.descriptionJa}
        onChange={(e) =>
          // 内容が変わったら英訳は陳腐化するため破棄（次回英訳で再取得）
          onUpdateScene(scene.id, { descriptionJa: e.target.value, sceneEn: undefined })
        }
        placeholder="共通のシーン規定（場所・時間帯・天候・状況）。このシーンの全カットの背景に反映されます"
        rows={2}
        className="mt-1 w-full resize-none rounded border border-sky-900/40 bg-zinc-950/40 px-2 py-1 text-[11px] leading-relaxed text-zinc-300"
      />
      {scene.sceneEn && <p className="mt-0.5 text-[10px] text-sky-700">EN: {scene.sceneEn}</p>}
    </div>
  );
}

export function CutTable({
  cuts,
  scenes,
  characters,
  bannedNames,
  selectedId,
  busy,
  onSelect,
  onUpdate,
  onUpdateScene,
  onMerge,
  onSplit,
  onDelete,
  onToggleCharacter,
  onGenerateOne,
}: {
  cuts: Cut[];
  scenes: Scene[];
  characters: CharacterSheet[];
  bannedNames: string[];
  selectedId: string | null;
  /** キュー実行中は行単位の生成を無効化 */
  busy: boolean;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Cut>) => void;
  onUpdateScene: (id: string, patch: Partial<Scene>) => void;
  onMerge: (index: number) => void;
  onSplit: (index: number) => void;
  onDelete: (id: string) => void;
  onToggleCharacter: (cutId: string, charKey: string) => void;
  onGenerateOne: (id: string) => void;
}) {
  if (cuts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-zinc-600">
        左ペインに字コンテを貼り付けて「カット表に分解」を押してください
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      {cuts.map((cut, i) => {
        const selected = cut.id === selectedId;
        const badge = STATUS_BADGE[cut.status];
        const violations = findNameViolations(cut.textJa, bannedNames);
        // シーンの切り替わりで見出し（共通の舞台設定）を挟む
        const sceneHeader =
          cut.sceneId && cut.sceneId !== cuts[i - 1]?.sceneId
            ? scenes.find((s) => s.id === cut.sceneId)
            : undefined;
        return (
          <React.Fragment key={cut.id}>
          {sceneHeader && <SceneHeader scene={sceneHeader} onUpdateScene={onUpdateScene} />}
          <div
            onClick={() => onSelect(cut.id)}
            className={`cursor-pointer rounded-lg border p-2 transition ${
              selected
                ? "border-amber-500/60 bg-amber-500/5"
                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
            }`}
          >
            {/* 1行目: 番号・サムネ・状態・操作 */}
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-center font-mono text-xs text-zinc-500">
                #{i + 1}
              </span>
              <div className="flex h-12 w-[85px] shrink-0 items-center justify-center overflow-hidden rounded border border-zinc-800 bg-zinc-950">
                {cut.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cut.thumbUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[9px] text-zinc-700">16:9</span>
                )}
              </div>
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>
              <div className="flex-1" />
              <Button
                variant="ghost"
                className="px-1.5 py-0.5 text-[11px]"
                disabled={i === 0}
                title="上のカットと結合"
                onClick={(e) => {
                  e.stopPropagation();
                  onMerge(i);
                }}
              >
                ⤴ 結合
              </Button>
              <Button
                variant="ghost"
                className="px-1.5 py-0.5 text-[11px]"
                title="句点で2カットに分割"
                onClick={(e) => {
                  e.stopPropagation();
                  onSplit(i);
                }}
              >
                ✂ 分割
              </Button>
              <Button
                variant="danger"
                className="px-1.5 py-0.5 text-[11px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(cut.id);
                }}
              >
                ✕
              </Button>
            </div>

            {/* 2行目: ト書き */}
            <textarea
              value={cut.textJa}
              onChange={(e) =>
                onUpdate(cut.id, {
                  textJa: e.target.value,
                  // 内容が変わったら英訳・確定プロンプトは陳腐化するため破棄
                  promptEn: undefined,
                  generatedPrompt: undefined,
                })
              }
              onClick={(e) => e.stopPropagation()}
              rows={2}
              className="mt-1.5 w-full resize-none rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-xs leading-relaxed"
            />

            {/* 実在人名の警告 */}
            {violations.length > 0 && (
              <p className="mt-1 rounded bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
                ⚠ 実在人名/IP語: {violations.join("、")} — 生成前にプレースホルダーへ置換してください
              </p>
            )}

            {/* 3行目: 画角・秒数・キャラ・生成 */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <select
                value={cut.camera ?? ""}
                onChange={(e) =>
                  onUpdate(cut.id, {
                    camera: (e.target.value || null) as CameraAngle | null,
                    generatedPrompt: undefined,
                  })
                }
                onClick={(e) => e.stopPropagation()}
                className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-300"
                title="カメラ画角"
              >
                <option value="">画角: 自動(目線)</option>
                {(Object.keys(CAMERA_LABELS) as CameraAngle[]).map((k) => (
                  <option key={k} value={k}>
                    {CAMERA_LABELS[k]}
                  </option>
                ))}
              </select>
              <input
                value={cut.durationHint}
                onChange={(e) => onUpdate(cut.id, { durationHint: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                placeholder="秒数"
                className="w-14 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[11px]"
                title="秒数ヒント（表示用）"
              />
              {characters.map((c) => {
                const active = cut.characters.includes(c.key);
                return (
                  <button
                    key={c.key}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleCharacter(cut.id, c.key);
                    }}
                    className={`rounded-full px-2 py-0.5 text-[10px] transition ${
                      active
                        ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50"
                        : "bg-zinc-800/60 text-zinc-500 hover:text-zinc-300"
                    }`}
                    title={`${c.displayName || c.key} をこのカットに${active ? "含めない" : "含める"}（プロンプトには ${c.key} として渡ります）`}
                  >
                    {c.displayName || c.key}
                  </button>
                );
              })}
              <div className="flex-1" />
              <Button
                className="px-2 py-0.5 text-[11px]"
                disabled={busy || cut.status === "generating"}
                onClick={(e) => {
                  e.stopPropagation();
                  onGenerateOne(cut.id);
                }}
              >
                {cut.resultAssetId ? "🔁 再生成" : "▶ 生成"}
              </Button>
            </div>

            {/* オーバーレイ chips */}
            {cut.overlays.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {cut.overlays.map((ov, j) => (
                  <span
                    key={j}
                    className={`max-w-full truncate rounded px-1.5 py-0.5 text-[10px] ${OVERLAY_STYLE[ov.type]}`}
                    title={`${ov.type}${ov.speaker ? `(${ov.speaker})` : ""}: ${ov.text}`}
                  >
                    {ov.type === "DIALOGUE" ? `💬${ov.speaker ?? ""}` : ov.type}: {ov.text}
                  </span>
                ))}
              </div>
            )}
          </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
