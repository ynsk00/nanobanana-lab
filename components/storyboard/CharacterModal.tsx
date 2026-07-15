"use client";

// キャラシート管理モーダル。
// 表示名 → プレースホルダー記述文の辞書を編集し、基準画像（立ち姿）を
// 生成 or アップロードで確定する。実在人名辞書（禁止語）もここで管理する。

import React, { useRef, useState } from "react";
import { Button } from "@/components/ui";
import type { CharacterSheet } from "@/lib/storyboard/types";

export function CharacterModal({
  characters,
  bannedNames,
  busyKey,
  onClose,
  onUpdate,
  onAdd,
  onDelete,
  onGenerate,
  onUpload,
  onAddBanned,
  onRemoveBanned,
}: {
  characters: CharacterSheet[];
  bannedNames: string[];
  /** 基準画像を生成中のキャラキー（ボタン無効化用） */
  busyKey: string | null;
  onClose: () => void;
  onUpdate: (key: string, patch: Partial<CharacterSheet>) => void;
  onAdd: () => void;
  onDelete: (key: string) => void;
  onGenerate: (key: string) => void;
  onUpload: (key: string, file: File) => void;
  onAddBanned: (name: string) => void;
  onRemoveBanned: (name: string) => void;
}) {
  const [banInput, setBanInput] = useState("");
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">🎭 キャラシート管理</h2>
          <Button variant="ghost" onClick={onClose}>✕ 閉じる</Button>
        </div>

        <p className="mb-3 text-xs text-zinc-500">
          キャラクターはプレースホルダーキー（例: MAN_A）と記述文でプロンプトへ渡されます。
          基準画像（立ち姿）を確定すると、全カット生成に参照画像として同梱されます。
        </p>

        <div className="space-y-3">
          {characters.map((c) => (
            <div
              key={c.key}
              className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3"
            >
              {/* 基準画像 */}
              <div className="flex w-28 shrink-0 flex-col items-center gap-1.5">
                <div className="flex h-36 w-28 items-center justify-center overflow-hidden rounded-md border border-zinc-700 bg-zinc-800">
                  {c.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbUrl} alt={c.key} className="h-full w-full object-cover" />
                  ) : (
                    <span className="px-2 text-center text-[10px] text-zinc-500">
                      基準画像
                      <br />
                      未設定
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    className="px-2 py-0.5 text-[11px]"
                    disabled={busyKey !== null || !c.descriptionJa.trim()}
                    onClick={() => onGenerate(c.key)}
                    title="記述文から立ち姿(正面・全身)を生成"
                  >
                    {busyKey === c.key ? "生成中…" : "生成"}
                  </Button>
                  <Button
                    className="px-2 py-0.5 text-[11px]"
                    onClick={() => fileRefs.current[c.key]?.click()}
                  >
                    ⬆
                  </Button>
                  <input
                    ref={(el) => {
                      fileRefs.current[c.key] = el;
                    }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onUpload(c.key, f);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>

              {/* 情報 */}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    value={c.key}
                    onChange={(e) =>
                      onUpdate(c.key, {
                        key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""),
                      })
                    }
                    className="w-32 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs text-amber-300"
                    title="プレースホルダーキー（プロンプトに渡る）"
                  />
                  <input
                    value={c.displayName}
                    onChange={(e) => onUpdate(c.key, { displayName: e.target.value })}
                    placeholder="字コンテ上の表示名（例: 男）"
                    className="w-40 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs"
                    title="字コンテ上の表示名。プロンプトには渡されません"
                  />
                  <div className="flex-1" />
                  <Button variant="danger" className="px-2 py-0.5 text-[11px]" onClick={() => onDelete(c.key)}>
                    削除
                  </Button>
                </div>
                <textarea
                  value={c.descriptionJa}
                  onChange={(e) => onUpdate(c.key, { descriptionJa: e.target.value, descriptionEn: undefined })}
                  placeholder="プレースホルダー記述文（例: 30代の日本人男性、無精ひげ、黒髪ミディアム、スーツ）"
                  rows={2}
                  className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs"
                />
                {c.descriptionEn && (
                  <p className="text-[11px] text-zinc-500">EN: {c.descriptionEn}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <Button className="mt-3" onClick={onAdd}>＋ キャラクターを追加</Button>

        {/* 実在人名辞書 */}
        <div className="mt-5 rounded-lg border border-red-900/50 bg-red-950/20 p-3">
          <h3 className="mb-1 text-xs font-semibold text-red-300">
            🚫 実在人名・実在IP辞書（プロンプト送信をブロック）
          </h3>
          <p className="mb-2 text-[11px] text-zinc-500">
            ここに登録された語が含まれるプロンプトはAPIへ送信されません。
            英訳時にも自動検出され追加されます。
          </p>
          <div className="flex flex-wrap gap-1.5">
            {bannedNames.map((n) => (
              <span
                key={n}
                className="inline-flex items-center gap-1 rounded-full bg-red-900/40 px-2 py-0.5 text-[11px] text-red-200"
              >
                {n}
                <button
                  className="text-red-400 hover:text-red-200"
                  onClick={() => onRemoveBanned(n)}
                  title="辞書から削除"
                >
                  ✕
                </button>
              </span>
            ))}
            {bannedNames.length === 0 && (
              <span className="text-[11px] text-zinc-600">（未登録）</span>
            )}
          </div>
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (banInput.trim()) onAddBanned(banInput.trim());
              setBanInput("");
            }}
          >
            <input
              value={banInput}
              onChange={(e) => setBanInput(e.target.value)}
              placeholder="人名・IP語を追加"
              className="w-52 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs"
            />
            <Button type="submit" className="px-2 py-0.5 text-[11px]">追加</Button>
          </form>
        </div>
      </div>
    </div>
  );
}
