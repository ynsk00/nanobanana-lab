// 依存ライブラリなしの最小PDF生成。
// canvas を JPEG (DCTDecode) としてページに1枚ずつ貼るだけの構造で、
// 絵コンテシートの複数ページPDF書き出しに使う。

interface PdfPageImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

const A4_LANDSCAPE = { w: 842, h: 595 }; // pt

function textBytes(s: string): Uint8Array {
  const arr = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i) & 0xff;
  return arr;
}

function canvasToJpegBytes(canvas: HTMLCanvasElement, quality = 0.92): Uint8Array {
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const b64 = dataUrl.split(",")[1] || "";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/**
 * canvas 配列を1ページ1枚のPDF(A4横)にまとめる。
 * 画像はページ全面にアスペクト維持で配置する
 */
export function canvasesToPdf(canvases: HTMLCanvasElement[]): Blob {
  const images: PdfPageImage[] = canvases.map((c) => ({
    jpeg: canvasToJpegBytes(c),
    width: c.width,
    height: c.height,
  }));

  const chunks: Uint8Array[] = [];
  const offsets: number[] = []; // 各オブジェクトの開始バイト位置（objNo順）
  let pos = 0;

  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? textBytes(data) : data;
    chunks.push(bytes);
    pos += bytes.length;
  };
  const beginObj = (no: number) => {
    offsets[no] = pos;
    push(`${no} 0 obj\n`);
  };

  push("%PDF-1.4\n%\xff\xff\xff\xff\n");

  const n = images.length;
  // オブジェクト番号: 1=Catalog, 2=Pages, ページiごとに 3+i*3=Page, 4+i*3=Contents, 5+i*3=Image
  const pageObj = (i: number) => 3 + i * 3;
  const contentObj = (i: number) => 4 + i * 3;
  const imageObj = (i: number) => 5 + i * 3;

  beginObj(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  beginObj(2);
  const kids = images.map((_, i) => `${pageObj(i)} 0 R`).join(" ");
  push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`);

  images.forEach((img, i) => {
    const { w: PW, h: PH } = A4_LANDSCAPE;
    // ページ全面にアスペクト維持でフィット
    const scale = Math.min(PW / img.width, PH / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = (PW - dw) / 2;
    const dy = (PH - dh) / 2;

    beginObj(pageObj(i));
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] ` +
        `/Resources << /XObject << /Im0 ${imageObj(i)} 0 R >> >> ` +
        `/Contents ${contentObj(i)} 0 R >>\nendobj\n`
    );

    const stream = `q\n${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${dx.toFixed(2)} ${dy.toFixed(2)} cm\n/Im0 Do\nQ\n`;
    beginObj(contentObj(i));
    push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);

    beginObj(imageObj(i));
    push(
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`
    );
    push(img.jpeg);
    push("\nendstream\nendobj\n");
  });

  const objCount = 2 + n * 3;
  const xrefPos = pos;
  push(`xref\n0 ${objCount + 1}\n`);
  push("0000000000 65535 f \n");
  for (let no = 1; no <= objCount; no++) {
    push(`${String(offsets[no]).padStart(10, "0")} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
  );

  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}
