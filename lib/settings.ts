// APIキーはユーザーのブラウザ(localStorage)にのみ保存する。
// サーバーには保存せず、生成リクエスト時にヘッダで都度送信する。

const KEY = "nbl_gemini_api_key";

export function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(KEY) || "";
}

export function setApiKey(value: string): void {
  if (typeof window === "undefined") return;
  if (value) localStorage.setItem(KEY, value);
  else localStorage.removeItem(KEY);
}

/** 表示用にマスクする (先頭4 + **** + 末尾4) */
export function maskKey(value: string): string {
  if (!value) return "";
  if (value.length <= 10) return "••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}
