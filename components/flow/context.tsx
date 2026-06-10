"use client";

import { createContext, useContext } from "react";
import type { ImageItem, ResultImage } from "@/lib/types";

export interface FlowCtxValue {
  /** 画像ライブラリ(プール)から選ばせる。multi=trueで複数選択 */
  openPicker: (multi: boolean, onPick: (items: ImageItem[]) => void) => void;
  /** 結果画像を拡大表示 */
  preview: (r: ResultImage) => void;
}

export const FlowContext = createContext<FlowCtxValue | null>(null);

export function useFlowCtx(): FlowCtxValue {
  const v = useContext(FlowContext);
  if (!v) throw new Error("FlowContext is missing");
  return v;
}
