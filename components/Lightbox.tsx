"use client";

import React, { useEffect } from "react";
import { Button } from "@/components/ui";
import { dataUrlToBlob, downloadBlob, extFromMime } from "@/lib/image";

export function Lightbox({
  image,
  onClose,
  onUseAsInput,
}: {
  image: { id: string; dataUrl: string; mimeType: string } | null;
  onClose: () => void;
  onUseAsInput: (dataUrl: string, mimeType: string) => void;
}) {
  useEffect(() => {
    if (!image) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    // 背面スクロールを止める
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
        <Button
          variant="default"
          onClick={() => {
            onUseAsInput(image.dataUrl, image.mimeType);
            onClose();
          }}
        >
          入力に使う
        </Button>
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
