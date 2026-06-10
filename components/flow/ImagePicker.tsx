"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import * as db from "@/lib/db";
import type { ImageItem } from "@/lib/types";

/** 画像ライブラリ(プール)から選択するモーダル */
export function ImagePicker({
  open,
  multi,
  onClose,
  onPick,
}: {
  open: boolean;
  multi: boolean;
  onClose: () => void;
  onPick: (items: ImageItem[]) => void;
}) {
  const [pool, setPool] = useState<ImageItem[]>([]);
  const [sel, setSel] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setSel([]);
    db.getAll<ImageItem>("pool").then((items) =>
      setPool(items.sort((a, b) => b.createdAt - a.createdAt))
    );
  }, [open]);

  if (!open) return null;

  function toggle(id: string) {
    if (!multi) {
      const item = pool.find((p) => p.id === id);
      if (item) {
        onPick([item]);
        onClose();
      }
      return;
    }
    setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  function confirm() {
    const items = sel
      .map((id) => pool.find((p) => p.id === id))
      .filter((x): x is ImageItem => !!x);
    onPick(items);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">
            画像を選択{multi ? "（複数可）" : ""}
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            ×
          </button>
        </div>

        {pool.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-500">
            ライブラリに画像がありません。先に Lab ページ（🍌）でプールに画像を登録してください。
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
            {pool.map((item) => {
              const i = sel.indexOf(item.id);
              const selected = i >= 0;
              return (
                <button
                  key={item.id}
                  onClick={() => toggle(item.id)}
                  className={`relative aspect-square overflow-hidden rounded-lg border-2 ${
                    selected ? "border-amber-400" : "border-transparent hover:border-zinc-600"
                  }`}
                  title={item.name}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.dataUrl} alt={item.name} loading="lazy" className="h-full w-full object-cover" />
                  {selected && (
                    <span className="absolute left-1 top-1 rounded bg-amber-400 px-1 text-[10px] font-bold text-zinc-900">
                      {i + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {multi && (
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              キャンセル
            </Button>
            <Button variant="primary" onClick={confirm} disabled={sel.length === 0}>
              {sel.length} 枚を追加
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
