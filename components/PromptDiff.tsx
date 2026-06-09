"use client";

import React, { useMemo } from "react";
import { diffChars } from "@/lib/diff";

/** 基準プロンプト → 現在のプロンプト の差分をインライン表示 */
export function PromptDiff({
  baseline,
  current,
}: {
  baseline: string;
  current: string;
}) {
  const parts = useMemo(() => diffChars(baseline, current), [baseline, current]);

  if (baseline.trim() === current.trim()) {
    return <p className="text-xs text-emerald-400">基準と同じプロンプトです。</p>;
  }

  return (
    <div className="text-xs leading-relaxed">
      <p className="mb-1 whitespace-pre-wrap break-words">
        {parts.map((p, i) =>
          p.type === "equal" ? (
            <span key={i} className="text-zinc-400">
              {p.text}
            </span>
          ) : p.type === "add" ? (
            <span key={i} className="rounded-sm bg-emerald-500/20 text-emerald-300">
              {p.text}
            </span>
          ) : (
            <span key={i} className="rounded-sm bg-red-500/20 text-red-300 line-through">
              {p.text}
            </span>
          )
        )}
      </p>
      <p className="text-[10px] text-zinc-500">
        <span className="text-emerald-300">緑=現在で追加</span> /{" "}
        <span className="text-red-300 line-through">赤=基準から削除</span>
      </p>
    </div>
  );
}
