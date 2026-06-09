"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { getApiKey, setApiKey } from "@/lib/settings";

export function ApiKeyModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (key: string) => void;
}) {
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<
    { type: "idle" | "checking" | "ok" | "error"; msg?: string }
  >({ type: "idle" });

  useEffect(() => {
    if (open) {
      setValue(getApiKey());
      setStatus({ type: "idle" });
      setShow(false);
    }
  }, [open]);

  if (!open) return null;

  async function validate(): Promise<boolean> {
    setStatus({ type: "checking" });
    try {
      const res = await fetch("/api/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: value.trim() }),
      });
      const data = await res.json();
      if (data.valid) {
        setStatus({ type: "ok", msg: "有効なキーです。" });
        return true;
      }
      setStatus({ type: "error", msg: data.error || "キーが無効です。" });
      return false;
    } catch (e) {
      setStatus({
        type: "error",
        msg: e instanceof Error ? e.message : "検証に失敗しました。",
      });
      return false;
    }
  }

  async function handleSave() {
    const ok = await validate();
    if (!ok) return;
    setApiKey(value.trim());
    onSaved(value.trim());
    onClose();
  }

  function handleClear() {
    setApiKey("");
    setValue("");
    onSaved("");
    setStatus({ type: "idle" });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">⚙ Gemini APIキー設定</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            ×
          </button>
        </div>

        <p className="mb-3 text-xs leading-relaxed text-zinc-400">
          キーは{" "}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="text-amber-400 underline"
          >
            Google AI Studio
          </a>{" "}
          で取得できます。入力したキーは<b className="text-zinc-200">このブラウザ内（localStorage）にのみ</b>
          保存され、生成時にあなたのリクエストからGoogleへ直接送られます。サーバーには保存されません。
        </p>

        <div className="flex gap-2">
          <input
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="AIza..."
            autoComplete="off"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-amber-400/60"
          />
          <Button variant="ghost" onClick={() => setShow((s) => !s)}>
            {show ? "隠す" : "表示"}
          </Button>
        </div>

        {status.type !== "idle" && (
          <p
            className={`mt-2 text-xs ${
              status.type === "ok"
                ? "text-emerald-400"
                : status.type === "error"
                ? "text-red-400"
                : "text-zinc-400"
            }`}
          >
            {status.type === "checking" ? "検証中…" : status.msg}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between">
          <Button variant="danger" onClick={handleClear} disabled={!value}>
            キーを削除
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => validate()} disabled={!value.trim() || status.type === "checking"}>
              接続テスト
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={!value.trim() || status.type === "checking"}>
              保存して有効化
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
