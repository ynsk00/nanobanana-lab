// 絵コンテシートの合成（canvas）とカット単体PNGのテキスト合成。
// 文字は画像に焼かず、書き出し時のみ canvas レイヤーとして重ねる。

import { loadImage } from "@/lib/contactSheet";
import { CAMERA_LABELS, type Cut } from "./types";

/** シートに載せる1カット分の描画データ */
export interface SheetCut {
  cut: Cut;
  /** フル解像度 or サムネの data URL（無ければ枠のみ描画） */
  imageUrl: string | null;
  index: number;
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

/** カットのメタ情報行（秒数・画角・NA・T・SE）を組み立てる */
function metaLines(cut: Cut, index: number): { text: string; bold?: boolean }[] {
  const head = [
    `#${index + 1}`,
    cut.durationHint || "-",
    cut.camera ? CAMERA_LABELS[cut.camera] : "画角未指定",
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
      outer: for (const ml of metaLines(it.cut, it.index)) {
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

/**
 * カット単体のPNGを作る。withText=true のときのみ NA/T/SE を重ねる
 * （画像自体には文字を焼き込まない方針のため、合成は書き出し時に限る）
 */
export async function composeCutPng(
  imageUrl: string,
  cut: Cut,
  withText: boolean
): Promise<Blob | null> {
  const img = await loadImage(imageUrl);
  if (!img) return null;
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);

  if (withText) drawOverlays(ctx, cut, img.width, img.height);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/** NA（青字・下部）/ PROMPT_UI（チャット風・上部）/ SE（ラベル・右上）を描画 */
function drawOverlays(
  ctx: CanvasRenderingContext2D,
  cut: Cut,
  w: number,
  h: number
): void {
  const base = Math.max(16, Math.round(w / 42));
  const pad = Math.round(base * 0.8);

  // NA: 下部に青字（白フチ）
  const nas = cut.overlays.filter((o) => o.type === "NA");
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  let naY = h - pad;
  for (const na of [...nas].reverse()) {
    ctx.font = `bold ${base}px sans-serif`;
    const lines = wrapText(ctx, na.text, w - pad * 4).reverse();
    for (const line of lines) {
      ctx.lineWidth = Math.max(3, base / 5);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.strokeText(line, w / 2, naY);
      ctx.fillStyle = BLUE;
      ctx.fillText(line, w / 2, naY);
      naY -= Math.round(base * 1.35);
    }
    naY -= Math.round(base * 0.4);
  }

  // PROMPT_UI: 上部に疑似チャットウィンドウ（角丸・一行）
  const prompts = cut.overlays.filter((o) => o.type === "PROMPT_UI");
  let puY = pad;
  for (const pu of prompts) {
    ctx.font = `${base}px sans-serif`;
    const tw = Math.min(ctx.measureText(pu.text).width, w - pad * 4);
    const bw = tw + base * 2.4;
    const bh = base * 2.2;
    const bx = (w - bw) / 2;
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, puY, bw, bh, bh / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#222222";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pu.text, w / 2, puY + bh / 2, w - pad * 4);
    puY += bh + pad / 2;
  }

  // SE: 右上に小ラベル
  const ses = cut.overlays.filter((o) => o.type === "SE");
  let seY = pad;
  const seFont = Math.round(base * 0.75);
  for (const se of ses) {
    ctx.font = `${seFont}px sans-serif`;
    const text = `SE: ${se.text}`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(w - pad - tw - seFont, seY, tw + seFont, seFont * 1.8);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w - pad - tw - seFont / 2, seY + seFont * 0.9);
    seY += Math.round(seFont * 2.2);
  }
}
