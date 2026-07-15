// 実在人名ガード。
// プロンプトが API へ送られる唯一の経路（StoryboardEditor の sendGeneration）は
// 必ず assertPromptSafe() を通る。禁止語（プロジェクト辞書 + テキストモデル検出の
// 実在人名）がプロンプトに残っていた場合は例外で送信を遮断する。

export class NameGuardError extends Error {
  violations: string[];
  constructor(violations: string[]) {
    super(
      `実在人名/IP語がプロンプトに含まれています: ${violations.join("、")}。` +
        "キャラシートのプレースホルダーに置換してください。"
    );
    this.name = "NameGuardError";
    this.violations = violations;
  }
}

/** 検索用に正規化（小文字化・空白/中黒除去） */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s・･]/g, "");
}

/**
 * テキストに含まれる禁止語を列挙する（大文字小文字・空白・中黒の揺れを無視）。
 * 2文字未満の禁止語は誤検知が多いため無視する
 */
export function findNameViolations(text: string, bannedNames: string[]): string[] {
  const hay = normalize(text);
  const hits: string[] = [];
  for (const name of bannedNames) {
    const needle = normalize(name);
    if (needle.length < 2) continue;
    if (hay.includes(needle) && !hits.includes(name)) hits.push(name);
  }
  return hits;
}

/** 禁止語が含まれていたら NameGuardError を投げる（API送信直前の最終ゲート） */
export function assertPromptSafe(prompt: string, bannedNames: string[]): void {
  const violations = findNameViolations(prompt, bannedNames);
  if (violations.length) throw new NameGuardError(violations);
}

/**
 * テキスト中の禁止語をプレースホルダーへ置換する。
 * replacements: 禁止語 → 置換後（例: "○○タレント" → "MAN_A"）
 */
export function replaceNames(text: string, replacements: Record<string, string>): string {
  let out = text;
  // 長い語から置換（部分一致の巻き込みを防ぐ）
  const names = Object.keys(replacements).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (!name.trim()) continue;
    out = out.split(name).join(replacements[name]);
  }
  return out;
}
