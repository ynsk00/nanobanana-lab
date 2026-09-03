// 字コンテパーサーの受け入れテスト。
// 仕様のサンプル字コンテが 8±2 カットに分解され、BGM/T/NA/SE が
// 画像化対象（ト書き）に混入しないことを担保する。

import { describe, expect, it } from "vitest";
import {
  assignCharacters,
  dedupeCutTexts,
  inferCamera,
  inferShotSize,
  mergeWithPrevious,
  parseScript,
  splitCut,
} from "../parse";
import type { Cut } from "../types";

const SAMPLE = `BGM:序曲、ファンファーレ
（朝の通勤路。路地の塀の上に、猫。歩いてきた男と目が合う）
NA（男・心の声）「……毎朝いるよな、お前」
SE:コマンド音
T：野良猫と仲良くなるには？
（スーツのまま、路地にしゃがむ男。猫、逃げない）

BGM:サビへ
（日替わりのモンタージュ——服が変わっていく）
（火曜。少し近い。指をそっと出す。猫が匂いを嗅ぐ）
（水曜。塀の下まで来ている。ゆっくりまばたき。猫も、まばたきを返す）

（ある朝。猫が塀から降りてきて、足元に、すりっ）
男「……来た」
（猫を一撫でして、出勤していく背中。塀の上から猫が見送る）`;

describe("parseScript: サンプル字コンテ", () => {
  const { cuts, characterNames } = parseScript(SAMPLE);

  it("8±2 カットに自動分解される", () => {
    expect(cuts.length).toBeGreaterThanOrEqual(6);
    expect(cuts.length).toBeLessThanOrEqual(10);
  });

  it("ト書きのみがカット本文になる（BGM/T/NA/SEは混入しない）", () => {
    for (const cut of cuts) {
      expect(cut.textJa).not.toMatch(/BGM|^SE|^T[:：]|^NA/);
      expect(cut.textJa).not.toContain("野良猫と仲良くなるには");
      expect(cut.textJa).not.toContain("毎朝いるよな");
    }
  });

  it("NA/SE/T は同ブロックのカットに overlays として紐付く", () => {
    const first = cuts[0];
    const types = first.overlays.map((o) => o.type).sort();
    expect(types).toEqual(["NA", "PROMPT_UI", "SE"]);
    const na = first.overlays.find((o) => o.type === "NA")!;
    expect(na.text).toBe("……毎朝いるよな、お前");
    expect(na.speaker).toBe("男・心の声");
    const t = first.overlays.find((o) => o.type === "PROMPT_UI")!;
    expect(t.text).toBe("野良猫と仲良くなるには？");
  });

  it("セリフは DIALOGUE として保持され、話者がキャラ候補になる", () => {
    const withDialogue = cuts.find((c) =>
      c.overlays.some((o) => o.type === "DIALOGUE" && o.text === "……来た")
    );
    expect(withDialogue).toBeDefined();
    expect(withDialogue!.textJa).toContain("すりっ");
    expect(characterNames).toContain("男");
  });

  it("空行・BGM行がブロック区切りとして機能する", () => {
    // 最後のブロックの2カット（すり寄り / 出勤の背中）が独立している
    const last = cuts[cuts.length - 1];
    expect(last.textJa).toContain("出勤していく背中");
  });
});

describe("自由書式への耐性（括弧なしト書き・シーン見出し）", () => {
  const FREE = `○朝の路地（朝）
路地の塀の上に猫。歩いてきた男と目が合う
男、足を止めて猫を見つめる

○オフィス（昼）
デスクで猫の写真を眺める男
同僚「なに見てるの？」`;
  const r = parseScript(FREE);

  it("括弧で囲まれていない行もト書き（カット）として扱う", () => {
    expect(r.cuts.length).toBe(3);
    expect(r.cuts[0].textJa).toContain("塀の上に猫");
    expect(r.cuts[2].textJa).toContain("デスクで猫の写真");
  });

  it("○見出しが共通のシーン規定になり、後続カットが所属する", () => {
    expect(r.scenes.length).toBe(2);
    expect(r.scenes[0].name).toBe("朝の路地（朝）");
    expect(r.cuts[0].sceneId).toBe(r.scenes[0].id);
    expect(r.cuts[1].sceneId).toBe(r.scenes[0].id);
    expect(r.cuts[2].sceneId).toBe(r.scenes[1].id);
  });

  it("セリフは自由書式でもカットにならずオーバーレイになる", () => {
    expect(r.cuts[2].overlays.some((o) => o.type === "DIALOGUE" && o.speaker === "同僚")).toBe(
      true
    );
    expect(r.characterNames).toContain("同僚");
  });
});

describe("inferCamera / inferShotSize", () => {
  it("ト書きの語彙からアングルを推定する", () => {
    expect(inferCamera("真俯瞰で捉えた路地")).toBe("top_down");
    expect(inferCamera("ハイアングルから見下ろす")).toBe("high_angle");
    expect(inferCamera("あおりで塀を見上げる")).toBe("low_angle");
    expect(inferCamera("男の肩越しに猫")).toBe("over_shoulder");
    expect(inferCamera("人目線で歩く")).toBe("eye_level");
    expect(inferCamera("特に指定なし")).toBeNull();
  });
  it("ト書きの語彙からショットサイズを推定する", () => {
    expect(inferShotSize("猫に寄り")).toBe("close_up");
    expect(inferShotSize("バストアップで男")).toBe("bust");
    expect(inferShotSize("引きで路地の全景")).toBe("long");
    expect(inferShotSize("男の全身")).toBe("full_body");
    expect(inferShotSize("特に指定なし")).toBeNull();
  });
});

describe("dedupeCutTexts", () => {
  const base = {
    durationHint: "",
    camera: null,
    overlays: [],
    characters: [],
    status: "draft" as const,
  };

  it("カット間で重複する文を後続カットから除去する", () => {
    const cuts = [
      { ...base, id: "a", textJa: "駅前広場を歩く翼。スマホを取り出し、何かを検索する。" },
      { ...base, id: "b", textJa: "スマホを取り出し、何かを検索する。コロッケを頬張る翼。" },
      { ...base, id: "c", textJa: "スマホを取り出し、何かを検索する。" },
    ] as Cut[];
    const out = dedupeCutTexts(cuts);
    expect(out.length).toBe(2);
    expect(out[1].textJa).toBe("コロッケを頬張る翼。");
  });

  it("重複が無ければそのまま", () => {
    const cuts = [
      { ...base, id: "a", textJa: "駅前広場を歩く翼。空を見上げる。" },
      { ...base, id: "b", textJa: "コロッケを頬張る翼。満足げな表情。" },
    ] as Cut[];
    const out = dedupeCutTexts(cuts);
    expect(out.length).toBe(2);
    expect(out[0]).toBe(cuts[0]);
    expect(out[1]).toBe(cuts[1]);
    expect(out[0].textJa).toBe("駅前広場を歩く翼。空を見上げる。");
    expect(out[1].textJa).toBe("コロッケを頬張る翼。満足げな表情。");
  });
});

describe("カットの結合・分割", () => {
  it("結合すると本文とオーバーレイがマージされる", () => {
    const { cuts } = parseScript(SAMPLE);
    const merged = mergeWithPrevious(cuts, 1);
    expect(merged.length).toBe(cuts.length - 1);
    expect(merged[0].textJa).toContain("朝の通勤路");
    expect(merged[0].textJa).toContain("しゃがむ男");
    expect(merged[0].overlays.length).toBe(cuts[0].overlays.length + cuts[1].overlays.length);
  });

  it("分割すると句点で2カットになる", () => {
    const { cuts } = parseScript(SAMPLE);
    const i = cuts.findIndex((c) => c.textJa.includes("火曜"));
    const split = splitCut(cuts, i);
    expect(split.length).toBe(cuts.length + 1);
    expect(split[i].textJa).toBe("火曜");
    expect(split[i + 1].textJa).toContain("少し近い");
  });
});

describe("assignCharacters", () => {
  it("表示名がト書き・話者に一致するキャラを紐付ける", () => {
    const { cuts } = parseScript(SAMPLE);
    const chars = [
      { key: "MAN_A", displayName: "男" },
      { key: "CAT_A", displayName: "猫" },
    ];
    const assigned = assignCharacters(cuts, chars);
    expect(assigned[0].characters).toEqual(["MAN_A", "CAT_A"]);
    // 「火曜。…猫が匂いを嗅ぐ」→ 猫のみ
    const tue = assigned.find((c) => c.textJa.includes("火曜"))!;
    expect(tue.characters).toContain("CAT_A");
  });
});
