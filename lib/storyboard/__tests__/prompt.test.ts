// 自然文プロンプトテンプレート（Phase 2）の受け入れテスト。
// buildCutPrompt が「段落を空行区切りにした英語の自然文」を組み立てることを担保する。
// テスト用のプロジェクト/カットは架空の題材（猫と会社員）で作る。

import { describe, expect, it } from "vitest";
import { buildCutPrompt, characterSentence } from "../prompt";
import type { CharacterSheet, Cut } from "../types";

function makeCut(patch: Partial<Cut> = {}): Cut {
  return {
    id: "c1",
    textJa: "路地で猫と目が合う男",
    durationHint: "3s",
    camera: null,
    overlays: [],
    characters: [],
    status: "draft",
    ...patch,
  };
}

const MAN_A: CharacterSheet = {
  key: "MAN_A",
  displayName: "会社員",
  descriptionJa: "30代の会社員、スーツ姿",
  descriptionEn: "a man in his 30s wearing a business suit",
};

const CAT_A: CharacterSheet = {
  key: "CAT_A",
  displayName: "野良猫",
  descriptionJa: "茶トラの猫",
  descriptionEn: "a brown tabby cat",
};

describe("buildCutPrompt: 品質タグを使わない自然文", () => {
  it("masterpiece / best quality を含まない", () => {
    const prompt = buildCutPrompt({
      cut: makeCut({ promptEn: "a man crouches to greet a cat on a quiet street" }),
      characters: [],
      referenceKeys: [],
      style: "pencil_rough",
    });
    expect(prompt.toLowerCase()).not.toContain("masterpiece");
    expect(prompt.toLowerCase()).not.toContain("best quality");
  });

  it("常に no text を含む（文字焼き込み防止の制約は必ず入る）", () => {
    const prompt = buildCutPrompt({
      cut: makeCut({ promptEn: "a man crouches to greet a cat on a quiet street" }),
      characters: [],
      referenceKeys: [],
      style: "cg_3d",
    });
    expect(prompt.toLowerCase()).toContain("no text");
  });
});

describe("buildCutPrompt: 参照キャラの @refN 番号", () => {
  it("referenceKeys の順序と @refN の番号が一致する", () => {
    const cut = makeCut({
      promptEn: "a man crouches near a cat on a wall",
      characters: ["MAN_A", "CAT_A"],
    });
    const prompt = buildCutPrompt({
      cut,
      characters: [MAN_A, CAT_A],
      // CAT_A が先に参照添付される（@ref1）、MAN_A は後（@ref2）
      referenceKeys: ["CAT_A", "MAN_A"],
      style: "pencil_rough",
    });
    expect(prompt).toContain("CAT_A is a brown tabby cat. Keep exactly the same face, hairstyle and outfit as reference image @ref1.");
    expect(prompt).toContain(
      "MAN_A is a man in his 30s wearing a business suit. Keep exactly the same face, hairstyle and outfit as reference image @ref2."
    );
  });

  it("参照画像が無いキャラは @refN を付けずキー+記述文のみになる", () => {
    const cut = makeCut({ promptEn: "a man crouches near a cat", characters: ["MAN_A"] });
    const prompt = buildCutPrompt({
      cut,
      characters: [MAN_A],
      referenceKeys: [],
      style: "pencil_rough",
    });
    expect(prompt).toContain("MAN_A is a man in his 30s wearing a business suit.");
    expect(prompt).not.toContain("@ref");
  });
});

describe("buildCutPrompt: lighting / lens", () => {
  it("lighting を設定すると対応する英語句が含まれる", () => {
    const prompt = buildCutPrompt({
      cut: makeCut({ promptEn: "a man walks down a quiet street", lighting: "golden_hour" }),
      characters: [],
      referenceKeys: [],
      style: "pencil_rough",
    });
    expect(prompt).toContain("golden hour sunlight, long soft shadows");
  });

  it("lens を設定すると対応する英語句が含まれる", () => {
    const prompt = buildCutPrompt({
      cut: makeCut({ promptEn: "a man walks down a quiet street", lens: "portrait_85" }),
      characters: [],
      referenceKeys: [],
      style: "pencil_rough",
    });
    expect(prompt).toContain("85mm portrait lens, shallow depth of field, softly blurred background");
  });
});

describe("buildCutPrompt: ショット段落の既定値", () => {
  it("カメラ/サイズ/構図/レンズが全未指定なら 'A medium shot at eye level.' を含む", () => {
    const prompt = buildCutPrompt({
      cut: makeCut({ promptEn: "a man walks down a quiet street" }),
      characters: [],
      referenceKeys: [],
      style: "pencil_rough",
    });
    expect(prompt).toContain("A medium shot at eye level.");
  });
});

describe("buildCutPrompt: negativeText", () => {
  it("negativeText が 'Do not include:' の1文として出る", () => {
    const prompt = buildCutPrompt({
      cut: makeCut({ promptEn: "a man walks down a quiet street" }),
      characters: [],
      referenceKeys: [],
      style: "pencil_rough",
      negativeText: "umbrellas, cars, crowds",
    });
    expect(prompt).toContain("Do not include: umbrellas, cars, crowds.");
  });

  it("negativeText が無ければ 'Do not include:' は出ない", () => {
    const prompt = buildCutPrompt({
      cut: makeCut({ promptEn: "a man walks down a quiet street" }),
      characters: [],
      referenceKeys: [],
      style: "pencil_rough",
    });
    expect(prompt).not.toContain("Do not include:");
  });
});

describe("buildCutPrompt: 段落構造", () => {
  it("段落が空行(\\n\\n)区切りになる", () => {
    const prompt = buildCutPrompt({
      cut: makeCut({
        promptEn: "a man crouches near a cat on a wall",
        characters: ["MAN_A"],
        poseNote: "crouching down",
        lighting: "soft_daylight",
      }),
      characters: [MAN_A],
      referenceKeys: [],
      style: "pencil_rough",
      styleText: "muted earthy palette",
    });
    const paragraphs = prompt.split("\n\n");
    // ショット / アクション / キャラ / 設定 / 補足 / スタイル / 制約 の7段落
    expect(paragraphs.length).toBe(7);
    for (const para of paragraphs) {
      expect(para.trim().length).toBeGreaterThan(0);
    }
  });

  it("空要素（キャラ無し・シーン/位置/時間帯/照明無し・ポーズ/背景/感情無し）の段落は出ない", () => {
    const prompt = buildCutPrompt({
      cut: makeCut({ promptEn: "a man walks down a quiet street" }),
      characters: [],
      referenceKeys: [],
      style: "pencil_rough",
    });
    const paragraphs = prompt.split("\n\n");
    // ショット / アクション / スタイル / 制約 の4段落のみ（キャラ/設定/補足は省略）
    expect(paragraphs.length).toBe(4);
  });
});

describe("characterSentence: 外見記述が空の場合", () => {
  it("descriptionJa/descriptionEnとも空なら '{key} appears in this shot.' になる（無意味な同語反復を避ける）", () => {
    const noDesc: CharacterSheet = { key: "MAN_A", displayName: "会社員", descriptionJa: "" };
    expect(characterSentence(noDesc, null)).toBe("MAN_A appears in this shot.");
  });

  it("記述が空でも参照画像があれば同一性の指示は続く", () => {
    const noDesc: CharacterSheet = { key: "MAN_A", displayName: "会社員", descriptionJa: "" };
    expect(characterSentence(noDesc, 0)).toBe(
      "MAN_A appears in this shot. Keep exactly the same face, hairstyle and outfit as reference image @ref1."
    );
  });
});

describe("buildCutPrompt: 舞台設定段落の Location ラベル", () => {
  it("location/timeOfDay を設定すると 'Location: ' で始まる文が Setting 段落に含まれる", () => {
    const prompt = buildCutPrompt({
      cut: makeCut({
        promptEn: "a man walks down a quiet street",
        location: "a narrow residential alley",
        timeOfDay: "early morning",
      }),
      characters: [],
      referenceKeys: [],
      style: "pencil_rough",
    });
    expect(prompt).toContain("Location: a narrow residential alley, early morning.");
  });
});

describe("buildCutPrompt: Style段落の styleText 文整形", () => {
  it("styleText が 'Overall look: ...' の1文として閉じ、直後に Match the overall tone が続く", () => {
    const prompt = buildCutPrompt({
      cut: makeCut({ promptEn: "a man walks down a quiet street" }),
      characters: [],
      referenceKeys: [],
      style: "pencil_rough",
      styleText: "muted earthy palette, soft film grain",
      styleRefIndex: 0,
    });
    expect(prompt).toContain("Overall look: muted earthy palette, soft film grain.");
    const idx = prompt.indexOf("Overall look: muted earthy palette, soft film grain.");
    const after = prompt.slice(idx + "Overall look: muted earthy palette, soft film grain.".length).trimStart();
    expect(after.startsWith("Match the overall tone")).toBe(true);
  });
});
