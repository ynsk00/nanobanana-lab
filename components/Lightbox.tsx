"use client";

import React, { useEffect } from "react";
import { Button } from "@/components/ui";
import { dataUrlToBlob, downloadBlob, extFromMime } from "@/lib/image";
import type { Role } from "@/lib/types";

export interface LightboxImage {
  id: string;
  dataUrl: string;
  mimeType: string;
  /** 入力/参照へ割り当て可能か（結果画像のときtrue） */
  assignable?: boolean;
}

export function Lightbox({
  image,
  onClose,
  onAssign,
}: {
  image: LightboxImage | null;
  onClose: () => void;
  onAssign: (dataUrl: string, mimeType: string, role: Role) => void;
}) {
  useEffect(() => {
    if (!image) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [image, onClose]);

  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* ツールバー */}
      <div
        className="flex items-center justify-end gap-2 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        {image.assignable && (
          <>
            <Button
              variant="default"
              onClick={() => {
                onAssign(image.dataUrl, image.mimeType, "input");
                onClose();
              }}
            >
              入力に使う
            </Button>
            <Button
              variant="default"
              onClick={() => {
                onAssign(image.dataUrl, image.mimeType, "reference");
                onClose();
              }}
            >
              参照に使う
            </Button>
          </>
        )}
        <Button
          variant="default"
          onClick={() =>
            downloadBlob(
              dataUrlToBlob(image.dataUrl),
              `${image.id}.${extFromMime(image.mimeType)}`
            )
          }
        >
          ⬇ ダウンロード
        </Button>
        <Button variant="ghost" onClick={onClose} title="閉じる (Esc)">
          ✕ 閉じる
        </Button>
      </div>

      {/* 画像本体 */}
      <div
        className="flex flex-1 items-center justify-center overflow-auto p-4"
        onClick={onClose}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.dataUrl}
          alt="拡大表示"
          className="max-h-full max-w-full cursor-zoom-out object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
