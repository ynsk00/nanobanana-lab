"use client";

import React from "react";
import type { ImageItem } from "@/lib/types";

/** 入力 / リファレンス画像ライブラリのサムネイルグリッド */
export function LibraryGrid({
  items,
  selectedIds,
  badgePrefix,
  onToggle,
  onDelete,
  emptyText,
}: {
  items: ImageItem[];
  selectedIds: string[];
  badgePrefix: string;
  onToggle: (item: ImageItem) => void;
  onDelete: (item: ImageItem) => void;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <p className="py-3 text-center text-xs text-zinc-600">{emptyText}</p>;
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((item) => {
        const idx = selectedIds.indexOf(item.id);
        const selected = idx >= 0;
        return (
          <div
            key={item.id}
            className={`group relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 transition ${
              selected ? "border-amber-400" : "border-transparent hover:border-zinc-600"
            }`}
            onClick={() => onToggle(item)}
            title={item.name}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.dataUrl}
              alt={item.name}
              className="h-full w-full object-cover"
            />
            {selected && (
              <span className="absolute left-1 top-1 rounded bg-amber-400 px-1 text-[10px] font-bold text-zinc-900">
                {badgePrefix}
                {idx + 1}
              </span>
            )}
            {item.origin === "generated" && (
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] text-zinc-200">
                gen
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item);
              }}
              className="absolute right-0.5 top-0.5 hidden h-5 w-5 items-center justify-center rounded bg-black/60 text-zinc-200 hover:bg-red-500/80 group-hover:flex"
              title="削除"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
