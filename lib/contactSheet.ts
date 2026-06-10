// 複数画像を1枚のコンタクトシート(グリッド)に合成するヘルパー（Lab/Flow 共有）

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** 複数画像を1枚のコンタクトシート(グリッド)に合成して PNG Blob を返す */
export async function buildContactSheet(
  items: { url: string; caption?: string }[],
  opts: { title?: string; subtitle?: string } = {}
): Promise<Blob | null> {
  const n = items.length;
  if (n === 0) return null;

  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cell = n <= 4 ? 640 : n <= 16 ? 460 : 320;
  const gap = 14;
  const pad = 24;
  const captionH = 22;
  const headerH = opts.title ? (opts.subtitle ? 64 : 40) : 0;

  const imgs = await Promise.all(items.map((it) => loadImage(it.url)));

  const width = pad * 2 + cols * cell + (cols - 1) * gap;
  const height = headerH + pad * 2 + rows * (cell + captionH) + (rows - 1) * gap;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (opts.title) {
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#111111";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(opts.title, pad, pad - 4);
    if (opts.subtitle) {
      ctx.fillStyle = "#666666";
      ctx.font = "13px sans-serif";
      const maxW = width - pad * 2;
      const base = opts.subtitle.replace(/\s+/g, " ").trim();
      let sub = base;
      while (sub.length > 0 && ctx.measureText(sub + "…").width > maxW) {
        sub = sub.slice(0, -1);
      }
      if (sub !== base) sub += "…";
      ctx.fillText(sub, pad, pad + 22);
    }
  }

  const top = headerH + pad;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  imgs.forEach((img, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = pad + c * (cell + gap);
    const y = top + r * (cell + captionH + gap);

    ctx.fillStyle = "#f2f2f4";
    ctx.fillRect(x, y, cell, cell);
    if (img) {
      const scale = Math.min(cell / img.width, cell / img.height);
      const iw = img.width * scale;
      const ih = img.height * scale;
      ctx.drawImage(img, x + (cell - iw) / 2, y + (cell - ih) / 2, iw, ih);
    }
    const cap = items[i].caption || String(i + 1);
    ctx.fillStyle = "#333333";
    ctx.font = "13px sans-serif";
    ctx.fillText(cap, x + cell / 2, y + cell + captionH / 2);
  });

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}
