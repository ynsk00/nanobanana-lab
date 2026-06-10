// 生成結果の画像取得ヘルパー（Lab/Flow 両ページで共有）

import * as db from "@/lib/db";
import type { ImageAsset, ResultImage } from "@/lib/types";

/** 結果のフル解像度画像を取得（assetsから都度ロード。旧バッチはdataUrl直持ち） */
export async function getFullImage(r: ResultImage): Promise<string> {
  if (r.dataUrl) return r.dataUrl;
  if (r.assetId) {
    const a = await db.get<ImageAsset>("assets", r.assetId);
    if (a?.dataUrl) return a.dataUrl;
  }
  return r.thumbUrl || "";
}

/** 一覧表示用の画像（サムネ優先） */
export function displayUrl(r: ResultImage): string {
  return r.thumbUrl || r.dataUrl || "";
}
