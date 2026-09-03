// 絵コンテシートの合成（canvas）とカット単体PNGの書き出し。
// シートには各カット下に青字でメタ情報（NA/T/SE）を描く。

import { loadImage } from "@/lib/contactSheet";
import { CAMERA_LABELS, SHOT_SIZE_LABELS, type Cut } from "./types";

/** シートに載せる1カット分の描画データ */
export interface SheetCut {
  cut: Cut;
  /** フル解像度 or サムネの data URL（無ければ枠のみ描画） */
  imageUrl: string | null;
  index: number;
  /** 所属シーン名（メタ情報の先頭行に表示） */
  sceneName?: string;
}

const BLUE = "#1d4ed8"; // メタ情報の青字

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** カットのメタ情報行（秒数・画角・シーン・NA・T・SE）を組み立てる */
function metaLines(
  cut: Cut,
  index: number,
  sceneName?: string
): { text: string; bold?: boolean }[] {
  const head = [
    `#${index + 1}`,
    cut.durationHint || "-",
    [
      cut.camera ? CAMERA_LABELS[cut.camera] : null,
      cut.shotSize ? SHOT_SIZE_LABELS[cut.shotSize] : null,
    ]
      .filter(Boolean)
      .join("・") || "画角未指定",
    ...(sceneName ? [sceneName] : []),
  ].join("　");
  const lines: { text: string; bold?: boolean }[] = [{ text: head, bold: true }];
  for (const ov of cut.overlays) {
    if (ov.type === "NA") lines.push({ text: `NA: ${ov.text}` });
    else if (ov.type === "PROMPT_UI") lines.push({ text: `T: ${ov.text}` });
    else if (ov.type === "SE") lines.push({ text: `SE: ${ov.text}` });
  }
  return lines;
}

export interface SheetOptions {
  title?: string;
  /** "a4" = A4横(1754x1240) / "wide" = 16:9(1920x1080) */
  format?: "a4" | "wide";
}

/**
 * 絵コンテシートを合成する。16:9サムネイルを時間軸順に並べ、
 * 各カット下に青字でメタ情報を描く。複数ページに分かれる場合は canvas 配列を返す
 */
export async function buildStoryboardSheets(
  items: SheetCut[],
  opts: SheetOptions = {}
): Promise<HTMLCanvasElement[]> {
  const format = opts.format ?? "a4";
  const W = format === "a4" ? 1754 : 1920;
  const H = format === "a4" ? 1240 : 1080;
  const cols = 3;
  const rows = 2;
  const perPage = cols * rows;
  const pad = 48;
  const gap = 28;
  const headerH = 56;
  const cellW = Math.floor((W - pad * 2 - gap * (cols - 1)) / cols);
  const thumbH = Math.floor((cellW * 9) / 16);
  const metaH = Math.floor((H - headerH - pad * 2 - gap * (rows - 1)) / rows) - thumbH;

  const imgs = await Promise.all(
    items.map((it) => (it.imageUrl ? loadImage(it.imageUrl) : Promise.resolve(null)))
  );

  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const pages: HTMLCanvasElement[] = [];

  for (let p = 0; p < pageCount; p++) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // ヘッダー
    ctx.fillStyle = "#111111";
    ctx.font = "bold 26px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(opts.title || "Storyboard", pad, pad - 16);
    ctx.fillStyle = "#888888";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${p + 1} / ${pageCount}`, W - pad, pad - 10);

    for (let i = 0; i < perPage; i++) {
      const gi = p * perPage + i;
      if (gi >= items.length) break;
      const it = items[gi];
      const img = imgs[gi];
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = pad + c * (cellW + gap);
      const y = headerH + pad + r * (thumbH + metaH + gap);

      // 16:9 サムネ枠
      ctx.fillStyle = "#f0f0f2";
      ctx.fillRect(x, y, cellW, thumbH);
      ctx.strokeStyle = "#c8c8cc";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, thumbH - 1);
      if (img) {
        const scale = Math.min(cellW / img.width, thumbH / img.height);
        const iw = img.width * scale;
        const ih = img.height * scale;
        ctx.drawImage(img, x + (cellW - iw) / 2, y + (thumbH - ih) / 2, iw, ih);
      } else {
        ctx.fillStyle = "#aaaaaa";
        ctx.font = "15px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("未生成", x + cellW / 2, y + thumbH / 2);
      }

      // メタ情報（青字）
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = BLUE;
      let ty = y + thumbH + 10;
      const lineH = 20;
      const maxLines = Math.floor((metaH - 14) / lineH);
      let used = 0;
      outer: for (const ml of metaLines(it.cut, it.index, it.sceneName)) {
        ctx.font = `${ml.bold ? "bold " : ""}15px sans-serif`;
        for (const seg of wrapText(ctx, ml.text, cellW)) {
          if (used >= maxLines) break outer;
          ctx.fillText(seg, x, ty);
          ty += lineH;
          used++;
        }
      }
    }

    pages.push(canvas);
  }

  return pages;
}

/** カット単体のPNGを作る（画像をそのままPNG化） */
export async function composeCutPng(imageUrl: string): Promise<Blob | null> {
  const img = await loadImage(imageUrl);
  if (!img) return null;
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}
