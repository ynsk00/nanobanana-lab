"use client";

import React from "react";
import type { ImageItem, Role } from "@/lib/types";

/** 統合画像プールのグリッド。各カードで「入力」「参照」の役割を割り当てる。 */
export function PoolGrid({
  items,
  selection,
  onSetRole,
  onDelete,
  onEnlarge,
  emptyText,
}: {
  items: ImageItem[];
  selection: { id: string; role: Role }[];
  onSetRole: (item: ImageItem, role: Role) => void;
  onDelete: (item: ImageItem) => void;
  onEnlarge: (item: ImageItem) => void;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-xs text-zinc-600">{emptyText}</p>;
  }
  const inputIds = selection.filter((s) => s.role === "input").map((s) => s.id);
  const refIds = selection.filter((s) => s.role === "reference").map((s) => s.id);

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => {
        const role = selection.find((s) => s.id === item.id)?.role;
        const inNo = inputIds.indexOf(item.id) + 1;
        const refNo = refIds.indexOf(item.id) + 1;
        return (
          <div
            key={item.id}
            className={`group overflow-hidden rounded-lg border ${
              role === "input"
                ? "border-amber-400"
                : role === "reference"
                ? "border-sky-400"
                : "border-zinc-700"
            }`}
          >
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.dataUrl}
                alt={item.name}
                className="aspect-square w-full cursor-zoom-in object-cover"
                onClick={() => onEnlarge(item)}
                title="クリックで拡大"
              />
              {role && (
                <span
                  className={`absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    role === "input"
                      ? "bg-amber-400 text-zinc-900"
                      : "bg-sky-400 text-zinc-900"
                  }`}
                >
                  {role === "input" ? `@in${inNo}` : `@ref${refNo}`}
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
                className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded bg-black/60 text-zinc-200 hover:bg-red-500/80 group-hover:flex"
                title="プールから削除"
              >
                ×
              </button>
            </div>
            {/* 役割割り当てボタン */}
            <div className="grid grid-cols-2 divide-x divide-zinc-800 border-t border-zinc-800 text-[11px] font-medium">
              <button
                onClick={() => onSetRole(item, "input")}
                className={`py-1.5 transition ${
                  role === "input"
                    ? "bg-amber-400/20 text-amber-300"
                    : "text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                入力{role === "input" ? " ✓" : ""}
              </button>
              <button
                onClick={() => onSetRole(item, "reference")}
                className={`py-1.5 transition ${
                  role === "reference"
                    ? "bg-sky-400/20 text-sky-300"
                    : "text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                参照{role === "reference" ? " ✓" : ""}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
