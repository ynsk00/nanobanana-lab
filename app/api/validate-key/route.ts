import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// APIキーの有効性を、課金の発生しない models 一覧エンドポイントで確認する。
export async function POST(req: NextRequest) {
  let key = "";
  let provider = "gemini";
  try {
    const body = await req.json();
    key = (body.apiKey || "").trim();
    provider = body.provider || "gemini";
  } catch {
    /* noop */
  }
  if (!key) {
    return NextResponse.json({ valid: false, error: "キーが空です。" }, { status: 400 });
  }
  try {
    let res: Response;
    if (provider === "openai") {
      res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
    } else if (provider === "replicate") {
      // 無課金のアカウント情報エンドポイントで検証
      res = await fetch("https://api.replicate.com/v1/account", {
        headers: { Authorization: `Token ${key}` },
      });
    } else {
      res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
        { headers: { "x-goog-api-key": key } }
      );
    }

    if (res.ok) {
      return NextResponse.json({ valid: true });
    }
    const data = await res.json().catch(() => ({}));
    const message =
      data?.error?.message || data?.detail || `キーが無効です (HTTP ${res.status})`;
    return NextResponse.json({ valid: false, error: message }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { valid: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 }
    );
  }
}
