// 生成後のAIチェック(QA)の判定ロジック。
// 純粋関数のみで構成する(DOM/DB/fetchなし)。テスト対象は qaVerdict。
//
// generateOne が /api/storyboard/qa の採点結果を渡してくると、
// そのまま採用するか(ok)、目視確認を促すか(warn)、
// 自動リトライを1回だけ試みるか(retry)をここで決める。

export type QaVerdict = "ok" | "warn" | "retry";

export interface QaScore {
  /** 画像内に文字・字幕・ロゴ・透かしがあるか */
  textDetected: boolean;
  /** ト書きの出来事・被写体・位置関係が描かれているか(0-5) */
  actionMatch: number;
  /** 登場人物の人数・外見の一致度(0-5) */
  characterMatch: number;
  /** 指定スタイルらしさ(0-5) */
  styleMatch: number;
  /** スケッチとの構図・フレーミング・配置の一致度(0-5)。スケッチがある場合のみ採点 */
  layoutMatch?: number;
}

/**
 * QAスコアから総合判定を出す。
 * - retry: 文字混入、またはト書き/キャラの不一致が著しい(actionMatch/characterMatchが2以下)
 * - warn : いずれかの指標が3、またはstyleMatch/layoutMatchが低いなど、完全な合格ではない
 * - ok   : actionMatch/characterMatch/styleMatch すべて4以上 かつ 文字混入なし
 *          (layoutMatchがある場合はそれも4以上)
 *
 * styleMatch/layoutMatch はどれだけ低くても単独では retry の条件にならない(warn止まり)。
 * レイアウト類似の機械判定は不確実なため、layoutMatch は warn止まりに留める。
 */
export function qaVerdict(qa: QaScore): QaVerdict {
  if (qa.textDetected || qa.actionMatch <= 2 || qa.characterMatch <= 2) return "retry";
  const allGood =
    qa.actionMatch >= 4 &&
    qa.characterMatch >= 4 &&
    qa.styleMatch >= 4 &&
    (qa.layoutMatch === undefined || qa.layoutMatch >= 4);
  return allGood ? "ok" : "warn";
}
