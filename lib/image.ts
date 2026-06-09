// 画像・ファイル関連のクライアント側ヘルパー

export function genId(prefix = ""): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${prefix}${t}${rand}`;
}

/** File を data URL に変換 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** data URL を canvas で縮小してサムネ用 data URL を作る（再現表示用に軽量化） */
export function makeThumbnail(dataUrl: string, maxSize = 256): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * API送信用に画像を縮小・再圧縮した data URL を返す。
 * Vercel のリクエストボディ上限(約4.5MB)を超えないようにするため。
 * 原本はライブラリに残し、送信時のみこの軽量版を使う。
 */
export function compressForUpload(
  dataUrl: string,
  maxSize = 1568,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      // 透過PNG対策に白背景を敷いてから描画(JPEGフォールバック時に黒くならないよう)
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      try {
        const webp = canvas.toDataURL("image/webp", quality);
        // WebP非対応ブラウザは "data:image/png" を返すので判定してフォールバック
        if (webp.startsWith("data:image/webp")) return resolve(webp);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(canvas.toDataURL("image/jpeg", quality));
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** data URL のおおよそのバイト数(base64本体長から概算) */
export function approxBytes(dataUrl: string): number {
  const body = dataUrl.split(",")[1] || "";
  return Math.floor((body.length * 3) / 4);
}

/** data URL から拡張子を推定 */
export function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

/** data URL を Blob 化 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mime = head.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Blob をダウンロードさせる */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
