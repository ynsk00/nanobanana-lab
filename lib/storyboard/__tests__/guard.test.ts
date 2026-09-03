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
    for (const style of [
      "pencil_rough",
      "gray_cinematic",
      "anime_layout",
      "rich_color",
      "cinematic_photo",
    ] as const) {
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

describe("共通スタイル設定（全カットに同一反映）", () => {
  const styleText = "soft morning light, muted earthy palette, film grain";

  it("styleText が全カットのプロンプトに同じ形で入る", () => {
    const cuts = [
      makeCut({ id: "c1", promptEn: "a man meets a cat" }),
      makeCut({ id: "c2", promptEn: "a man crouching in an alley" }),
    ];
    const prompts = cuts.map((cut) =>
      buildCutPrompt({ cut, characters: [], referenceKeys: [], style: "rich_color", styleText })
    );
    for (const p of prompts) expect(p).toContain(styleText);
  });

  it("トーン参照画像を添付すると @refN でスタイル参照指示が入る", () => {
    // キャラ参照1枚 + トーン参照1枚 → トーンは @ref2
    const prompt = buildCutPrompt({
      cut: makeCut({ promptEn: "a man meets a cat" }),
      characters: [MAN_A],
      referenceKeys: ["MAN_A"],
      style: "pencil_rough",
      styleText,
      styleRefIndex: 1,
    });
    expect(prompt).toContain("@ref1"); // キャラ参照
    expect(prompt).toContain("rendering style of @ref2"); // トーン参照
    expect(prompt).toContain("style reference only");
  });

  it("シーン規定が同一シーンの全カットへ共通反映される", () => {
    const scene = {
      id: "s1",
      name: "朝の路地",
      descriptionJa: "朝の通勤時間帯。住宅街の細い路地",
      sceneEn: "narrow residential alley in the morning commute hour",
    };
    const cuts = [
      makeCut({ id: "c1", promptEn: "a man meets a cat", sceneId: "s1" }),
      makeCut({ id: "c2", promptEn: "a man crouching", sceneId: "s1" }),
    ];
    const prompts = cuts.map((cut) =>
      buildCutPrompt({ cut, characters: [], referenceKeys: [], scene, style: "pencil_rough" })
    );
    for (const p of prompts) expect(p).toContain(`setting: ${scene.sceneEn}`);
  });

  it("シーン規定にも人名ガードが効く（英訳前の原文フォールバック）", () => {
    const scene = { id: "s1", name: "路地", descriptionJa: "山田太郎の自宅前の路地" };
    const prompt = buildCutPrompt({
      cut: makeCut({ promptEn: "a man walking" }),
      characters: [],
      referenceKeys: [],
      scene,
      style: "pencil_rough",
    });
    expect(() => assertPromptSafe(prompt, BANNED)).toThrow(NameGuardError);
  });

  it("高画質化プロンプト(qualityText)が全カットへ共通付与される", () => {
    const quality = "masterpiece, best quality, highly detailed";
    const cuts = [
      makeCut({ id: "c1", promptEn: "a man meets a cat" }),
      makeCut({ id: "c2", promptEn: "a man crouching" }),
    ];
    for (const cut of cuts) {
      const p = buildCutPrompt({
        cut,
        characters: [],
        referenceKeys: [],
        style: "rich_color",
        qualityText: quality,
      });
      expect(p).toContain(quality);
      // no text 系サフィックスより前に入る（末尾の禁止事項は維持）
      expect(p.indexOf(quality)).toBeLessThan(p.indexOf("no text"));
    }
  });

  it("避けたい要素(negativeText)が avoid: として埋め込まれる", () => {
    const p = buildCutPrompt({
      cut: makeCut({ promptEn: "a man meets a cat" }),
      characters: [],
      referenceKeys: [],
      style: "pencil_rough",
      negativeText: "blurry, deformed hands",
    });
    expect(p).toContain("avoid: blurry, deformed hands");
    expect(p.indexOf("avoid:")).toBeLessThan(p.indexOf("no text"));
  });

  it("ショット設計(アングル/サイズ/構図/ポーズ/背景)がプロンプトへ反映される", () => {
    const p = buildCutPrompt({
      cut: makeCut({
        promptEn: "a man reaching out to a cat",
        camera: "low_angle",
        shotSize: "close_up",
        composition: "rule_of_thirds",
        poseNote: "crouching, reaching out to a cat",
        backgroundNote: "block wall and morning sun",
      }),
      characters: [],
      referenceKeys: [],
      style: "pencil_rough",
    });
    expect(p).toContain("low angle shot");
    expect(p).toContain("close-up shot");
    expect(p).toContain("rule of thirds composition");
    expect(p).toContain("subject pose: crouching, reaching out to a cat");
    expect(p).toContain("background: block wall and morning sun");
  });

  it("styleText にも人名ガードが効く", () => {
    const prompt = buildCutPrompt({
      cut: makeCut({ promptEn: "a man in a suit" }),
      characters: [],
      referenceKeys: [],
      style: "pencil_rough",
      styleText: "in the style of 山田太郎", // 禁止語入り
    });
    expect(() => assertPromptSafe(prompt, BANNED)).toThrow(NameGuardError);
  });
});
