"use client";

import dynamic from "next/dynamic";

// IndexedDB / canvas を使うクライアント専用画面のため SSR を無効化して読み込む
const StoryboardEditor = dynamic(
  () => import("@/components/storyboard/StoryboardEditor"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-[#0b0b0f] text-sm text-zinc-500">
        Storyboard を読み込み中…
      </div>
    ),
  }
);

export default function StoryboardPage() {
  return <StoryboardEditor />;
}
