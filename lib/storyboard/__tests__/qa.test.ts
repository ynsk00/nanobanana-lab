// qaVerdict（生成後AIチェックの総合判定）の境界値テスト

import { describe, expect, it } from "vitest";
import { qaVerdict, type QaScore } from "../qa";

function score(patch: Partial<QaScore> = {}): QaScore {
  return {
    textDetected: false,
    actionMatch: 5,
    characterMatch: 5,
    styleMatch: 5,
    ...patch,
  };
}

describe("qaVerdict", () => {
  it("textDetectedがtrueなら他が満点でもretry", () => {
    expect(qaVerdict(score({ textDetected: true }))).toBe("retry");
  });

  it("actionMatchが2以下ならretry", () => {
    expect(qaVerdict(score({ actionMatch: 2 }))).toBe("retry");
    expect(qaVerdict(score({ actionMatch: 0 }))).toBe("retry");
  });

  it("actionMatchが3ならwarn", () => {
    expect(qaVerdict(score({ actionMatch: 3 }))).toBe("warn");
  });

  it("actionMatchが4以上(他も良好)ならok", () => {
    expect(qaVerdict(score({ actionMatch: 4 }))).toBe("ok");
  });

  it("characterMatchが2以下ならretry", () => {
    expect(qaVerdict(score({ characterMatch: 2 }))).toBe("retry");
  });

  it("characterMatchが3ならwarn", () => {
    expect(qaVerdict(score({ characterMatch: 3 }))).toBe("warn");
  });

  it("styleMatchが3でもretryにはならずwarn止まり", () => {
    expect(qaVerdict(score({ styleMatch: 3 }))).toBe("warn");
  });

  it("styleMatchが低くても単独ではretryにならない(warn)", () => {
    expect(qaVerdict(score({ styleMatch: 0 }))).toBe("warn");
  });

  it("すべて4以上かつ文字混入なしならok", () => {
    expect(qaVerdict(score({ actionMatch: 4, characterMatch: 4, styleMatch: 4 }))).toBe("ok");
    expect(qaVerdict(score())).toBe("ok");
  });

  it("layoutMatchが1でも他が良ければwarn（retryにはしない）", () => {
    expect(qaVerdict(score({ layoutMatch: 1 }))).toBe("warn");
  });

  it("layoutMatchが0でも文字混入・action/characterMatchが良好ならretryにはならない", () => {
    expect(qaVerdict(score({ layoutMatch: 0 }))).not.toBe("retry");
  });

  it("layoutMatchが未定義なら判定に影響しない（他が良好ならok）", () => {
    expect(qaVerdict(score({ layoutMatch: undefined }))).toBe("ok");
  });

  it("layoutMatchも4以上なら他が良好な場合ok", () => {
    expect(qaVerdict(score({ layoutMatch: 4 }))).toBe("ok");
  });
});
