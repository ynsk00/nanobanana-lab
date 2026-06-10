"use client";

import dynamic from "next/dynamic";

// React Flow はクライアント専用のため SSR を無効化して読み込む
const FlowEditor = dynamic(() => import("@/components/flow/FlowEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-[#0b0b0f] text-sm text-zinc-500">
      エディタを読み込み中…
    </div>
  ),
});

export default function FlowPage() {
  return <FlowEditor />;
}
