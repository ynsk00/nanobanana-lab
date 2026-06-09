"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import {
  getApiKey,
  setApiKey,
  PROVIDER_LABELS,
  PROVIDER_DOCS,
  type KeyProvider,
} from "@/lib/settings";

type Status = { type: "idle" | "checking" | "ok" | "error"; msg?: string };

export function ApiKeyModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<KeyProvider, string>>({ gemini: "", openai: "" });
  const [show, setShow] = useState<Record<KeyProvider, boolean>>({ gemini: false, openai: false });
  const [status, setStatus] = useState<Record<KeyProvider, Status>>({
    gemini: { type: "idle" },
    openai: { type: "idle" },
  });

  useEffect(() => {
    if (open) {
      setValues({ gemini: getApiKey("gemini"), openai: getApiKey("openai") });
      setStatus({ gemini: { type: "idle" }, openai: { type: "idle" } });
      setShow({ gemini: false, openai: false });
    }
  }, [open]);

  if (!open) return null;

  async function validate(provider: KeyProvider): Promise<boolean> {
    const key = values[provider].trim();
    if (!key) return true; // 空欄は検証スキップ（クリア扱い）
    setStatus((s) => ({ ...s, [provider]: { type: "checking" } }));
    try {
      const res = await fetch("/api/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key, provider }),
      });
      const data = await res.json();
      if (data.valid) {
        setStatus((s) => ({ ...s, [provider]: { type: "ok", msg: "有効なキーです。" } }));
        return true;
      }
      setStatus((s) => ({ ...s, [provider]: { type: "error", msg: data.error || "キーが無効です。" } }));
      return false;
    } catch (e) {
      setStatus((s) => ({
        ...s,
        [provider]: { type: "error", msg: e instanceof Error ? e.message : "検証に失敗しました。" },
      }));
      return false;
    }
  }

  async function handleSave() {
    // 入力されたキーはまとめて検証してから保存
    const providers: KeyProvider[] = ["gemini", "openai"];
    const oks = await Promise.all(providers.map((p) => validate(p)));
    if (oks.some((ok) => !ok)) return;
    providers.forEach((p) => setApiKey(p, values[p].trim()));
    onSaved();
    onClose();
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
          <h2 className="text-base font-bold">⚙ APIキー設定</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            ×
          </button>
        </div>

        <p className="mb-4 text-xs leading-relaxed text-zinc-400">
          使うモデルに応じてキーを設定してください。Nano Banana は <b className="text-zinc-200">Gemini</b>、
          GPT Image は <b className="text-zinc-200">OpenAI</b> のキーが必要です。キーは
          <b className="text-zinc-200">このブラウザ内(localStorage)にのみ</b>保存され、サーバーには保存されません。
        </p>

        <div className="space-y-4">
          {(["gemini", "openai"] as KeyProvider[]).map((provider) => {
            const st = status[provider];
            return (
              <div key={provider}>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-200">
                    {PROVIDER_LABELS[provider]}
                  </label>
                  <a
                    href={PROVIDER_DOCS[provider]}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-amber-400 underline"
                  >
                    キーを取得
                  </a>
                </div>
                <div className="flex gap-2">
                  <input
                    type={show[provider] ? "text" : "password"}
                    value={values[provider]}
                    onChange={(e) => setValues((v) => ({ ...v, [provider]: e.target.value }))}
                    placeholder={provider === "gemini" ? "AIza..." : "sk-..."}
                    autoComplete="off"
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-amber-400/60"
                  />
                  <Button
                    variant="ghost"
                    onClick={() => setShow((s) => ({ ...s, [provider]: !s[provider] }))}
                  >
                    {show[provider] ? "隠す" : "表示"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => validate(provider)}
                    disabled={!values[provider].trim() || st.type === "checking"}
                  >
                    テスト
                  </Button>
                </div>
                {st.type !== "idle" && (
                  <p
                    className={`mt-1 text-xs ${
                      st.type === "ok"
                        ? "text-emerald-400"
                        : st.type === "error"
                        ? "text-red-400"
                        : "text-zinc-400"
                    }`}
                  >
                    {st.type === "checking" ? "検証中…" : st.msg}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            閉じる
          </Button>
          <Button variant="primary" onClick={handleSave}>
            保存して有効化
          </Button>
        </div>
      </div>
    </div>
  );
}
