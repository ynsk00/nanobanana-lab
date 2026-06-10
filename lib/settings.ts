// APIキーはユーザーのブラウザ(localStorage)にのみ保存する。
// サーバーには保存せず、生成リクエスト時にヘッダで都度送信する。

export type KeyProvider = "gemini" | "openai" | "replicate";

/** UIで列挙するプロバイダの順序（ApiKeyModalはこれを唯一の真実とする） */
export const KEY_PROVIDERS: KeyProvider[] = ["gemini", "openai", "replicate"];

const STORAGE_KEYS: Record<KeyProvider, string> = {
  gemini: "nbl_gemini_api_key",
  openai: "nbl_openai_api_key",
  replicate: "nbl_replicate_api_key",
};

export const PROVIDER_LABELS: Record<KeyProvider, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  replicate: "Replicate",
};

export const PROVIDER_DOCS: Record<KeyProvider, string> = {
  gemini: "https://aistudio.google.com/apikey",
  openai: "https://platform.openai.com/api-keys",
  replicate: "https://replicate.com/account/api-tokens",
};

/** プレースホルダ（入力欄のヒント） */
export const PROVIDER_PLACEHOLDER: Record<KeyProvider, string> = {
  gemini: "AIza...",
  openai: "sk-...",
  replicate: "r8_...",
};

export function getApiKey(provider: KeyProvider): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STORAGE_KEYS[provider]) || "";
}

export function setApiKey(provider: KeyProvider, value: string): void {
  if (typeof window === "undefined") return;
  if (value) localStorage.setItem(STORAGE_KEYS[provider], value);
  else localStorage.removeItem(STORAGE_KEYS[provider]);
}

/** 表示用にマスクする (先頭4 + **** + 末尾4) */
export function maskKey(value: string): string {
  if (!value) return "";
  if (value.length <= 10) return "••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}
