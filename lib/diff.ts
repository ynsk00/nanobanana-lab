// 文字単位の差分（LCSベース）。日本語のように空白で区切れない文章でも差分が取れる。

export type DiffPart = { type: "equal" | "add" | "remove"; text: string };

const MAX = 4000; // これ以上は計算量を抑えるため粗い差分にする

export function diffChars(a: string, b: string): DiffPart[] {
  if (a === b) return a ? [{ type: "equal", text: a }] : [];
  // 長すぎる場合は全置換として扱う（ブラウザが固まるのを防ぐ）
  if (a.length > MAX || b.length > MAX) {
    const parts: DiffPart[] = [];
    if (a) parts.push({ type: "remove", text: a });
    if (b) parts.push({ type: "add", text: b });
    return parts;
  }

  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i..], b[j..] のLCS長
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (type: DiffPart["type"], ch: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += ch;
    else parts.push({ type, text: ch });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("remove", a[i]);
      i++;
    } else {
      push("add", b[j]);
      j++;
    }
  }
  while (i < n) push("remove", a[i++]);
  while (j < m) push("add", b[j++]);
  return parts;
}
