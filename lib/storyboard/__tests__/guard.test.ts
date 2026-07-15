// 実在人名ガードの受け入れテスト。
// 「人名が未置換のまま API へ送信されるケースがゼロ」を担保する:
// 画像生成の唯一の送信経路(StoryboardEditor.generateOne)は送信直前に
// assertPromptSafe() を必ず通り、禁止語が残っていれば例外で遮断される。

import { describe, expect, it } from "vitest";
import {
  NameGuardError,
  assertPromptSafe,
  findNameViolations,
  replaceNames,
} from "../guard";
import { buildCutPrompt, buildCharacterSheetPrompt, NEGATIVE_SUFFIX } from "../prompt";
import type { CharacterSheet, Cut } from "../types";

const BANNED = ["山田太郎", "Taro Yamada", "有名タレントX"];

function makeCut(patch: Partial<Cut> = {}): Cut {
  return {
    id: "c1",
    textJa: "朝の路地。塀の上の猫と目が合うスーツの男",
    durationHint: "4s",
    camera: "high_angle",
    overlays: [],
    characters: ["MAN_A"],
    status: "draft",
    ...patch,
  };
}

const MAN_A: CharacterSheet = {
  key: "MAN_A",
  displayName: "山田太郎", // 実在人名が表示名に入っていても
  descriptionJa: "30代の日本人男性、無精ひげ、黒髪ミディアム、スーツ",
  descriptionEn: "Japanese man in his 30s, stubble, medium black hair, business suit",
};

describe("findNameViolations / assertPromptSafe", () => {
  it("禁止語を含むプロンプトを検出する", () => {
    expect(findNameViolations("a photo of 山田太郎 walking", BANNED)).toEqual(["山田太郎"]);
    // 大文字小文字・空白の揺れも検出
    expect(findNameViolations("portrait of TARO YAMADA", BANNED)).toEqual(["Taro Yamada"]);
  });

  it("禁止語が無ければ何も返さない", () => {
    expect(findNameViolations("a man crouching in an alley with a cat", BANNED)).toEqual([]);
  });

  it("assertPromptSafe は禁止語を含むプロンプトの送信を例外で遮断する", () => {
    expect(() => assertPromptSafe("山田太郎 in a suit", BANNED)).toThrow(NameGuardError);
    expect(() => assertPromptSafe("a man in a suit", BANNED)).not.toThrow();
  });
});

describe("replaceNames", () => {
  it("実在人名をプレースホルダーへ置換する", () => {
    const out = replaceNames("山田太郎が路地を歩く。山田太郎、猫と目が合う", {
      山田太郎: "MAN_A",
    });
    expect(out).toBe("MAN_Aが路地を歩く。MAN_A、猫と目が合う");
    expect(findNameViolations(out, BANNED)).toEqual([]);
  });
});

describe("buildCutPrompt: 人名がプロンプトへ渡らない", () => {
  it("キャラクターはキー+記述文のみでプロンプト化される（表示名は使われない）", () => {
    const prompt = buildCutPrompt({
      cut: makeCut({ promptEn: "a man in a suit meets a cat on a wall" }),
      characters: [MAN_A],
      referenceKeys: ["MAN_A"],
      style: "pencil_rough",
    });
    expect(prompt).not.toContain("山田太郎");
    expect(findNameViolations(prompt, BANNED)).toEqual([]);
    expect(prompt).toContain("MAN_A");
    expect(prompt).toContain("@ref1");
    expect(prompt).toContain(NEGATIVE_SUFFIX);
  });

  it("キャラシート生成プロンプトにも表示名は含まれない", () => {
    const prompt = buildCharacterSheetPrompt(MAN_A, "pencil_rough");
    expect(prompt).not.toContain("山田太郎");
    expect(prompt).toContain("full body standing pose");
  });

  it("英訳前のフォールバック（ト書き原文）に人名が残っていればガードが遮断する", () => {
    const cut = makeCut({ textJa: "山田太郎が路地を歩いてくる", promptEn: undefined });
    const prompt = buildCutPrompt({
      cut,
      characters: [],
      referenceKeys: [],
      style: "pencil_rough",
    });
    // 送信経路はこの2行の順で必ず実行される（buildCutPrompt → assertPromptSafe → 送信）
    expect(() => assertPromptSafe(prompt, BANNED)).toThrow(NameGuardError);
  });
});

describe("スタイルプリセット", () => {
  it("全プリセットの末尾に no text 系サフィックスが付与される", () => {
    for (const style of ["pencil_rough", "gray_cinematic", "anime_layout"] as const) {
      const prompt = buildCutPrompt({
        cut: makeCut({ promptEn: "a cat on a wall" }),
        characters: [],
        referenceKeys: [],
        style,
      });
      expect(prompt).toContain("no text, no letters, no logo, no watermark");
      expect(prompt).toContain("16:9");
    }
  });
});
