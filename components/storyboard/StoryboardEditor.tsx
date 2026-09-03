"use client";

// 字コンテ → 絵コンテ生成モードのメイン画面。
// 左: 字コンテエディタ / 中: カット表 / 右: プレビュー+修正指示
// 生成は直列キュー（キャラ参照画像を全カットに同梱するため）。

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Button } from "@/components/ui";
import { ApiKeyModal } from "@/components/ApiKeyModal";
import { Lightbox, type LightboxImage } from "@/components/Lightbox";
import { CutTable } from "@/components/storyboard/CutTable";
import { CutPreview } from "@/components/storyboard/CutPreview";
import { BottomDock } from "@/components/storyboard/BottomDock";
import * as db from "@/lib/db";
import { getApiKey } from "@/lib/settings";
import { MODELS, getModel } from "@/lib/pricing";
import { requestGeneration } from "@/lib/generation";
import { downloadBlob, fileToDataUrl, genId, makeThumbnail } from "@/lib/image";
import type { ImageAsset } from "@/lib/types";
import { dedupeCutTexts, mergeWithPrevious, parseScript, splitCut } from "@/lib/storyboard/parse";
import {
  DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_QUALITY_PROMPT,
  DEFAULT_STYLE,
  buildCharacterSheetPrompt,
  buildCutPrompt,
  buildStandingFromFacePrompt,
} from "@/lib/storyboard/prompt";
import {
  NameGuardError,
  assertPromptSafe,
  findNameViolations,
  replaceNames,
} from "@/lib/storyboard/guard";
import { buildStoryboardSheets, type SheetCut } from "@/lib/storyboard/sheet";
import { composeCutPng } from "@/lib/storyboard/sheet";
import { canvasesToPdf } from "@/lib/storyboard/pdf";
import type { CharacterSheet, Cut, Scene, StoryboardProject } from "@/lib/storyboard/types";
import type { ParseResponse } from "@/app/api/storyboard/parse/route";
import type { AssistResponse } from "@/app/api/storyboard/assist/route";
import type { StyleResponse } from "@/app/api/storyboard/style/route";

const PROJECT_ID = "sb_default";

/** 16:9 に対応する Google モデルのみ（絵コンテは 16:9 固定） */
const SB_MODELS = Object.values(MODELS).filter(
  (m) => m.provider === "google" && m.aspectRatios.includes("16:9")
);

const SAMPLE_SCRIPT = `BGM:序曲、ファンファーレ
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

function newProject(): StoryboardProject {
  return {
    id: PROJECT_ID,
    title: "新しい絵コンテ",
    scriptText: "",
    cuts: [],
    scenes: [],
    characters: [],
    stylePreset: DEFAULT_STYLE,
    qualityPrompt: DEFAULT_QUALITY_PROMPT,
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    modelKey: SB_MODELS[0]?.key ?? "nano-banana-2",
    bannedNames: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** 表示名からプレースホルダーキーの種別を推定 */
function baseKeyFor(name: string): string {
  if (/猫/.test(name)) return "CAT";
  if (/犬/.test(name)) return "DOG";
  if (/少女|娘|女/.test(name)) return "WOMAN";
  if (/少年|男/.test(name)) return "MAN";
  if (/子供|子ども/.test(name)) return "KID";
  return "CHAR";
}

function nextKey(base: string, existing: string[]): string {
  for (let i = 0; i < 26; i++) {
    const key = `${base}_${String.fromCharCode(65 + i)}`;
    if (!existing.includes(key)) return key;
  }
  return `${base}_${existing.length + 1}`;
}

async function assetUrl(assetId?: string): Promise<string | null> {
  if (!assetId) return null;
  const a = await db.get<ImageAsset>("assets", assetId);
  return a?.dataUrl ?? null;
}

/** プロジェクト共通のスタイル記述（言語化済みトーン + 自由記述） */
function projectStyleText(p: StoryboardProject): string | undefined {
  const text = [p.styleImageEn, p.styleNotes]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(", ");
  return text || undefined;
}

export default function StoryboardEditor() {
  const [project, setProject] = useState<StoryboardProject>(newProject);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [styleAnalyzing, setStyleAnalyzing] = useState(false);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [geminiKey, setGeminiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueLabel, setQueueLabel] = useState("");
  const [translating, setTranslating] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [charBusyKey, setCharBusyKey] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);

  // 直列キュー内から常に最新の state を読むためのミラー
  const projectRef = useRef(project);
  projectRef.current = project;
  const cancelRef = useRef(false);

  const model = getModel(project.modelKey);

  // --- 初回ロード & 自動保存 ---
  useEffect(() => {
    setGeminiKey(getApiKey("gemini"));
    setOpenaiKey(getApiKey("openai"));
    db.get<StoryboardProject>("storyboards", PROJECT_ID).then((p) => {
      if (p) {
        // 読込時に生成中断状態を復元
        p.cuts = p.cuts.map((c) =>
          c.status === "generating" || c.status === "queued"
            ? { ...c, status: c.resultAssetId ? "done" : "draft" }
            : c
        );
        // 旧プロジェクトへの新フィールド補完
        if (p.qualityPrompt === undefined) p.qualityPrompt = DEFAULT_QUALITY_PROMPT;
        if (p.negativePrompt === undefined) p.negativePrompt = DEFAULT_NEGATIVE_PROMPT;
        // 旧enum(サイズ系がcameraに入っていた)からの移行
        const sizeMigration: Record<string, string> = {
          close_up: "close_up", bust_shot: "bust", full_shot: "full_body", wide: "long",
        };
        p.cuts = p.cuts.map((c) => {
          const m = sizeMigration[c.camera as string];
          return m ? { ...c, camera: null, shotSize: (c.shotSize ?? m) as Cut["shotSize"] } : c;
        });
        setProject(p);
      }
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => db.put("storyboards", projectRef.current), 600);
    return () => clearTimeout(t);
  }, [project, loaded]);

  const patch = useCallback((p: Partial<StoryboardProject>) => {
    setProject((prev) => ({ ...prev, ...p, updatedAt: Date.now() }));
  }, []);

  const updateCut = useCallback((id: string, cp: Partial<Cut>) => {
    setProject((prev) => ({
      ...prev,
      cuts: prev.cuts.map((c) => (c.id === id ? { ...c, ...cp } : c)),
      updatedAt: Date.now(),
    }));
  }, []);

  // --- 1. 字コンテ → カット表 ---
  // AI分解が主経路（任意の書式に対応し、ト書きを画が浮かぶ形に補完・シーンを規定する）。
  // APIキー未設定や失敗時は記法パーサーへフォールバックする
  const parseNow = useCallback(async () => {
    const p = projectRef.current;
    if (!p.scriptText.trim()) return;
    if (p.cuts.some((c) => c.resultAssetId)) {
      if (!confirm("カット表を作り直します。既存の生成結果は破棄されます。よろしいですか？"))
        return;
    }

    setParsing(true);
    setError(null);
    let cuts: Cut[];
    let scenes: Scene[];
    let characterNames: string[];
    let perCutNames: Map<string, string[]> | null = null; // AIが返すカット別の登場キャラ名（cut.id → 名前）
    let note = "";

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (geminiKey) headers["x-gemini-api-key"] = geminiKey;
      const res = await fetch("/api/storyboard/parse", {
        method: "POST",
        headers,
        body: JSON.stringify({ script: p.scriptText }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `AI分解に失敗しました (${res.status})`);
      }
      const data = (await res.json()) as ParseResponse;
      scenes = data.scenes.map((s) => ({
        id: genId("scene_"),
        name: s.name,
        descriptionJa: s.descriptionJa,
      }));
      cuts = data.cuts.map((c) => ({
        id: genId("cut_"),
        textJa: c.textJa,
        durationHint: c.durationHint || "",
        camera: c.camera ?? null,
        shotSize: c.shotSize ?? null,
        sceneId: c.sceneIndex >= 0 ? scenes[c.sceneIndex]?.id : undefined,
        overlays: c.overlays,
        characters: [],
        status: "draft" as const,
      }));
      characterNames = data.characterNames;
      perCutNames = new Map(cuts.map((cut, i) => [cut.id, data.cuts[i].characterNames]));
      note = `AI分解: ${cuts.length}カット / ${scenes.length}シーン。`;
    } catch (e) {
      // フォールバック: 記法パーサー（オフライン動作）
      const r = parseScript(p.scriptText);
      cuts = r.cuts;
      scenes = r.scenes;
      characterNames = r.characterNames;
      const reason = e instanceof Error ? e.message : "AI分解に失敗";
      note = `記法パーサーで${cuts.length}カットに分解しました（${reason}）。`;
    } finally {
      setParsing(false);
    }

    // カット間で重複する文を除去（AI分解が同じ文を複数カットへ入れる対策）
    cuts = dedupeCutTexts(cuts);

    // キャラクター候補を登録（既存の表示名は維持）
    const characters = [...p.characters];
    const animalNames = ["猫", "犬"].filter((a) => cuts.some((c) => c.textJa.includes(a)));
    for (const name of [...characterNames, ...animalNames]) {
      if (!characters.some((c) => c.displayName === name)) {
        characters.push({
          key: nextKey(baseKeyFor(name), characters.map((c) => c.key)),
          displayName: name,
          descriptionJa: "",
        });
      }
    }

    // カットへキャラを割当（AIのカット別キャラ名 + 表示名のト書き一致）
    const assigned = cuts.map((cut) => {
      const keys = new Set<string>();
      for (const c of characters) {
        if (!c.displayName) continue;
        if (cut.textJa.includes(c.displayName)) keys.add(c.key);
        if (perCutNames?.get(cut.id)?.includes(c.displayName)) keys.add(c.key);
        if (cut.overlays.some((o) => o.speaker && o.speaker.split(/[・･]/)[0] === c.displayName))
          keys.add(c.key);
      }
      return { ...cut, characters: Array.from(keys) };
    });

    patch({ cuts: assigned, scenes, characters });
    setSelectedId(assigned[0]?.id ?? null);
    setMsg(`${note}キャラシートの記述文を確認してから生成してください。`);
  }, [geminiKey, patch]);

  // --- 2. 英訳（Gemini テキストモデル）+ 実在人名検出 ---
  const translate = useCallback(async (): Promise<boolean> => {
    const p = projectRef.current;
    const sceneById = new Map((p.scenes ?? []).map((s) => [s.id, s]));
    const cutsNeed = p.cuts
      .filter((c) => !c.promptEn && c.textJa.trim())
      .map((c) => ({
        id: c.id,
        textJa: c.textJa,
        // シーン規定を文脈として渡し、膨らませ変換の背景整合を取る
        sceneDescription: c.sceneId ? sceneById.get(c.sceneId)?.descriptionJa : undefined,
      }));
    const charsNeed = p.characters
      .filter((c) => c.descriptionJa.trim() && !c.descriptionEn)
      .map((c) => ({ key: c.key, descriptionJa: c.descriptionJa }));
    const scenesNeed = (p.scenes ?? [])
      .filter((s) => s.descriptionJa.trim() && !s.sceneEn)
      .map((s) => ({ id: s.id, descriptionJa: s.descriptionJa }));
    if (!cutsNeed.length && !charsNeed.length && !scenesNeed.length) return true;

    setTranslating(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (geminiKey) headers["x-gemini-api-key"] = geminiKey;
      const res = await fetch("/api/storyboard/assist", {
        method: "POST",
        headers,
        body: JSON.stringify({ cuts: cutsNeed, characters: charsNeed, scenes: scenesNeed }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `英訳に失敗しました (${res.status})`);
      }
      const data = (await res.json()) as AssistResponse;

      setProject((prev) => {
        const cuts = prev.cuts.map((c) => {
          const r = data.cuts.find((x) => x.id === c.id);
          if (!r) return c;
          return {
            ...c,
            promptEn: r.actionEn || c.promptEn,
            location: r.location ?? c.location,
            timeOfDay: r.timeOfDay ?? c.timeOfDay,
            camera: c.camera ?? r.camera ?? null,
            shotSize: c.shotSize ?? r.shotSize ?? null,
          };
        });
        const characters = prev.characters.map((c) => {
          const r = data.characters.find((x) => x.key === c.key);
          return r?.descriptionEn ? { ...c, descriptionEn: r.descriptionEn } : c;
        });
        const scenes = (prev.scenes ?? []).map((s) => {
          const r = (data.scenes ?? []).find((x) => x.id === s.id);
          return r?.sceneEn ? { ...s, sceneEn: r.sceneEn } : s;
        });
        const bannedNames = Array.from(new Set([...prev.bannedNames, ...data.realNames]));
        return { ...prev, cuts, characters, scenes, bannedNames, updatedAt: Date.now() };
      });

      if (data.realNames.length) {
        setError(
          `⚠ 実在人名/IP語を検出し辞書に追加しました: ${data.realNames.join("、")}。` +
            "下の警告からプレースホルダーへ置換してください。"
        );
        return false;
      }
      setMsg("英訳が完了しました。");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "英訳に失敗しました");
      return false;
    } finally {
      setTranslating(false);
    }
  }, [geminiKey]);

  // --- 3. 生成（唯一のAPI送信経路。必ず assertPromptSafe を通す） ---
  const generateOne = useCallback(
    async (cutId: string, opts: { useEditNote?: boolean; emphasizeNoText?: boolean } = {}) => {
      const p = projectRef.current;
      const cut = p.cuts.find((c) => c.id === cutId);
      if (!cut) return;
      const chars = p.characters.filter((c) => cut.characters.includes(c.key));
      const refChars = chars.filter((c) => c.imageAssetId);

      try {
        const refUrls = (
          await Promise.all(refChars.map((c) => assetUrl(c.imageAssetId)))
        ).filter((u): u is string => !!u);

        // トーン参照画像を末尾の参照として同梱（@refN の N はキャラ参照の後）
        let styleRefIndex: number | null = null;
        if (p.attachStyleImage !== false && p.styleImageAssetId) {
          const styleUrl = await assetUrl(p.styleImageAssetId);
          if (styleUrl) {
            styleRefIndex = refUrls.length;
            refUrls.push(styleUrl);
          }
        }

        const prompt = buildCutPrompt({
          cut,
          characters: chars,
          referenceKeys: refChars.map((c) => c.key),
          scene: (p.scenes ?? []).find((s) => s.id === cut.sceneId) ?? null,
          style: p.stylePreset,
          styleText: projectStyleText(p),
          styleRefIndex,
          qualityText: p.qualityPrompt,
          negativeText: p.negativePrompt,
          includeEditNote: opts.useEditNote,
          emphasizeNoText: opts.emphasizeNoText,
        });
        // 実在人名ガード（送信直前の最終ゲート）
        assertPromptSafe(prompt, p.bannedNames);

        updateCut(cutId, { status: "generating", generatedPrompt: prompt, error: undefined });

        // 修正指示がある場合は現画像を入力にして参照付き編集
        const inputs: string[] = [];
        if (opts.useEditNote && cut.editNote?.trim() && cut.resultAssetId) {
          const cur = await assetUrl(cut.resultAssetId);
          if (cur) inputs.push(cur);
        }

        const res = await requestGeneration(
          {
            geminiKey,
            openaiKey,
            modelKey: p.modelKey,
            aspectRatio: "16:9",
            count: 1,
            prompt,
          },
          inputs,
          refUrls
        );
        const img = res.results.find((r) => r.dataUrl);
        if (!img?.dataUrl) throw new Error(res.errors[0] || "画像が返却されませんでした");

        const assetId = genId("sbimg_");
        await db.put("assets", { id: assetId, dataUrl: img.dataUrl });
        const thumb = await makeThumbnail(img.dataUrl, 480);
        updateCut(cutId, { status: "done", resultAssetId: assetId, thumbUrl: thumb, error: undefined });
      } catch (e) {
        const m =
          e instanceof NameGuardError
            ? e.message
            : e instanceof Error
              ? e.message
              : "生成に失敗しました";
        updateCut(cutId, { status: "error", error: m });
        throw e;
      }
    },
    [geminiKey, openaiKey, updateCut]
  );

  // --- 4. 一括生成（直列キュー） ---
  const runQueue = useCallback(async () => {
    const p = projectRef.current;
    const targets = p.cuts.filter((c) => !c.resultAssetId);
    if (!targets.length) {
      setMsg("未生成のカットはありません（再生成はカット単位で行えます）。");
      return;
    }
    const cost = targets.length * model.pricePerImage;
    if (
      !confirm(
        `未生成の ${targets.length} カットを直列で生成します。\n` +
          `モデル: ${model.label}\n概算コスト: $${cost.toFixed(3)}\n実行しますか？`
      )
    )
      return;

    setQueueRunning(true);
    cancelRef.current = false;
    setError(null);
    try {
      // 先に英訳をまとめて実行（実在人名検出を含む）
      setQueueLabel("英訳中…");
      const ok = await translate();
      if (!ok && projectRef.current.cuts.some((c) => findNameViolations(c.textJa, projectRef.current.bannedNames).length)) {
        setQueueLabel("");
        setQueueRunning(false);
        return; // 実在人名が残っている間は生成に進まない
      }

      for (const t of targets) {
        if (cancelRef.current) break;
        const idx = projectRef.current.cuts.findIndex((c) => c.id === t.id);
        setQueueLabel(`生成中 ${idx + 1}/${projectRef.current.cuts.length}…`);
        try {
          await generateOne(t.id);
        } catch {
          // カット単位のエラーは行に表示済み。キューは続行する
        }
      }
      setMsg(cancelRef.current ? "キューを中断しました。" : "一括生成が完了しました。");
    } finally {
      setQueueLabel("");
      setQueueRunning(false);
    }
  }, [generateOne, model, translate]);

  // --- キャラシート基準画像の生成/アップロード ---
  const generateCharacter = useCallback(
    async (key: string) => {
      const p = projectRef.current;
      const c = p.characters.find((x) => x.key === key);
      if (!c) return;
      setCharBusyKey(key);
      setError(null);
      try {
        const prompt = buildCharacterSheetPrompt(
          c,
          p.stylePreset,
          projectStyleText(p),
          p.qualityPrompt,
          p.negativePrompt
        );
        assertPromptSafe(prompt, p.bannedNames);
        const res = await requestGeneration(
          { geminiKey, openaiKey, modelKey: p.modelKey, aspectRatio: "2:3", count: 1, prompt },
          [],
          []
        );
        const img = res.results.find((r) => r.dataUrl);
        if (!img?.dataUrl) throw new Error(res.errors[0] || "画像が返却されませんでした");
        const assetId = genId("sbchar_");
        await db.put("assets", { id: assetId, dataUrl: img.dataUrl });
        const thumb = await makeThumbnail(img.dataUrl, 256);
        setProject((prev) => ({
          ...prev,
          characters: prev.characters.map((x) =>
            x.key === key ? { ...x, imageAssetId: assetId, thumbUrl: thumb } : x
          ),
          updatedAt: Date.now(),
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "キャラ画像の生成に失敗しました");
      } finally {
        setCharBusyKey(null);
      }
    },
    [geminiKey, openaiKey]
  );

  /**
   * アップロード済みの顔写真から、同一人物の立ち姿基準画像を生成する。
   * 実在人物の顔は画像参照としてのみ渡し、名前はプロンプトに載せない
   */
  const generateCharacterFromFace = useCallback(
    async (key: string) => {
      const p = projectRef.current;
      const c = p.characters.find((x) => x.key === key);
      const faceUrl = await assetUrl(c?.imageAssetId);
      if (!c || !faceUrl) return;
      setCharBusyKey(key);
      setError(null);
      try {
        const prompt = buildStandingFromFacePrompt(
          c,
          p.stylePreset,
          projectStyleText(p),
          p.qualityPrompt,
          p.negativePrompt
        );
        assertPromptSafe(prompt, p.bannedNames);
        const res = await requestGeneration(
          { geminiKey, openaiKey, modelKey: p.modelKey, aspectRatio: "2:3", count: 1, prompt },
          [faceUrl],
          []
        );
        const img = res.results.find((r) => r.dataUrl);
        if (!img?.dataUrl) throw new Error(res.errors[0] || "画像が返却されませんでした");
        const assetId = genId("sbchar_");
        await db.put("assets", { id: assetId, dataUrl: img.dataUrl });
        const thumb = await makeThumbnail(img.dataUrl, 256);
        setProject((prev) => ({
          ...prev,
          characters: prev.characters.map((x) =>
            x.key === key ? { ...x, imageAssetId: assetId, thumbUrl: thumb } : x
          ),
          updatedAt: Date.now(),
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "立ち姿の生成に失敗しました");
      } finally {
        setCharBusyKey(null);
      }
    },
    [geminiKey, openaiKey]
  );

  // --- トーン参照画像（スタイル設定） ---
  const uploadStyleImage = useCallback(async (file: File) => {
    const dataUrl = await fileToDataUrl(file);
    const assetId = genId("sbstyle_");
    await db.put("assets", { id: assetId, dataUrl });
    const thumb = await makeThumbnail(dataUrl, 256);
    setProject((prev) => ({
      ...prev,
      styleImageAssetId: assetId,
      styleImageThumb: thumb,
      styleImageEn: undefined, // 画像が変わったら言語化結果は無効
      updatedAt: Date.now(),
    }));
  }, []);

  const analyzeStyleImage = useCallback(async () => {
    const p = projectRef.current;
    const url = await assetUrl(p.styleImageAssetId);
    if (!url) return;
    setStyleAnalyzing(true);
    setError(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (geminiKey) headers["x-gemini-api-key"] = geminiKey;
      const res = await fetch("/api/storyboard/style", {
        method: "POST",
        headers,
        body: JSON.stringify({ image: url }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `トーンの言語化に失敗しました (${res.status})`);
      }
      const data = (await res.json()) as StyleResponse;
      setProject((prev) => ({ ...prev, styleImageEn: data.styleEn, updatedAt: Date.now() }));
      setMsg(`トーンを言語化しました: ${data.summaryJa}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "トーンの言語化に失敗しました");
    } finally {
      setStyleAnalyzing(false);
    }
  }, [geminiKey]);

  const clearStyleImage = useCallback(() => {
    setProject((prev) => ({
      ...prev,
      styleImageAssetId: undefined,
      styleImageThumb: undefined,
      styleImageEn: undefined,
      updatedAt: Date.now(),
    }));
  }, []);

  const uploadCharacter = useCallback(async (key: string, file: File) => {
    const dataUrl = await fileToDataUrl(file);
    const assetId = genId("sbchar_");
    await db.put("assets", { id: assetId, dataUrl });
    const thumb = await makeThumbnail(dataUrl, 256);
    setProject((prev) => ({
      ...prev,
      characters: prev.characters.map((x) =>
        x.key === key ? { ...x, imageAssetId: assetId, thumbUrl: thumb } : x
      ),
      updatedAt: Date.now(),
    }));
  }, []);

  const updateScene = useCallback((id: string, sp: Partial<Scene>) => {
    setProject((prev) => ({
      ...prev,
      scenes: (prev.scenes ?? []).map((s) => (s.id === id ? { ...s, ...sp } : s)),
      updatedAt: Date.now(),
    }));
  }, []);

  const updateCharacter = useCallback((key: string, cp: Partial<CharacterSheet>) => {
    setProject((prev) => {
      const characters = prev.characters.map((c) => (c.key === key ? { ...c, ...cp } : c));
      // キー変更時はカットの紐付けも追従
      let cuts = prev.cuts;
      if (cp.key && cp.key !== key) {
        cuts = prev.cuts.map((c) => ({
          ...c,
          characters: c.characters.map((k) => (k === key ? cp.key! : k)),
        }));
      }
      return { ...prev, characters, cuts, updatedAt: Date.now() };
    });
  }, []);

  // --- 実在人名の一括置換（警告バナーから） ---
  const replaceBanned = useCallback(() => {
    setProject((prev) => {
      const map: Record<string, string> = {};
      const characters = [...prev.characters];
      for (const name of prev.bannedNames) {
        const appears =
          prev.scriptText.includes(name) || prev.cuts.some((c) => c.textJa.includes(name));
        if (!appears) continue;
        let ch = characters.find((c) => c.displayName === name);
        if (!ch) {
          ch = {
            key: nextKey(baseKeyFor(name), characters.map((c) => c.key)),
            displayName: name,
            descriptionJa: "",
          };
          characters.push(ch);
        }
        map[name] = ch.key;
      }
      const cuts = prev.cuts.map((c) => ({
        ...c,
        textJa: replaceNames(c.textJa, map),
        editNote: c.editNote ? replaceNames(c.editNote, map) : c.editNote,
        promptEn: undefined,
        generatedPrompt: undefined,
      }));
      return {
        ...prev,
        scriptText: replaceNames(prev.scriptText, map),
        cuts,
        characters,
        updatedAt: Date.now(),
      };
    });
    setMsg(
      "実在人名をプレースホルダーへ置換しました。下のキャラシートで記述文（外見の特徴）を設定してください。"
    );
    setError(null);
  }, []);

  // --- 書き出し ---
  const collectSheetCuts = useCallback(async (): Promise<SheetCut[]> => {
    const p = projectRef.current;
    const sceneById = new Map((p.scenes ?? []).map((s) => [s.id, s]));
    return Promise.all(
      p.cuts.map(async (cut, index) => ({
        cut,
        index,
        imageUrl: (await assetUrl(cut.resultAssetId)) ?? cut.thumbUrl ?? null,
        sceneName: cut.sceneId ? sceneById.get(cut.sceneId)?.name : undefined,
      }))
    );
  }, []);

  const exportSheet = useCallback(
    async (kind: "png" | "pdf") => {
      const p = projectRef.current;
      if (!p.cuts.length) return;
      setMsg("絵コンテシートを書き出し中…");
      const pages = await buildStoryboardSheets(await collectSheetCuts(), { title: p.title });
      const base = (p.title || "storyboard").replace(/[\\/:*?"<>|]/g, "_");
      if (kind === "pdf") {
        downloadBlob(canvasesToPdf(pages), `${base}.pdf`);
      } else if (pages.length === 1) {
        pages[0].toBlob((b) => b && downloadBlob(b, `${base}.png`), "image/png");
      } else {
        const zip = new JSZip();
        for (let i = 0; i < pages.length; i++) {
          const blob = await new Promise<Blob | null>((r) =>
            pages[i].toBlob((b) => r(b), "image/png")
          );
          if (blob) zip.file(`${base}_p${i + 1}.png`, blob);
        }
        downloadBlob(await zip.generateAsync({ type: "blob" }), `${base}_sheets.zip`);
      }
      setMsg("書き出しが完了しました。");
    },
    [collectSheetCuts]
  );

  const exportCutPng = useCallback(async (cutId: string) => {
    const p = projectRef.current;
    const cut = p.cuts.find((c) => c.id === cutId);
    const url = await assetUrl(cut?.resultAssetId);
    if (!cut || !url) return;
    const idx = p.cuts.indexOf(cut);
    const blob = await composeCutPng(url);
    if (blob) downloadBlob(blob, `cut_${String(idx + 1).padStart(2, "0")}.png`);
  }, []);

  const exportCutsZip = useCallback(async () => {
    const p = projectRef.current;
    const done = p.cuts.filter((c) => c.resultAssetId);
    if (!done.length) return;
    setMsg("カットPNGを書き出し中…");
    const zip = new JSZip();
    for (const cut of done) {
      const url = await assetUrl(cut.resultAssetId);
      if (!url) continue;
      const idx = p.cuts.indexOf(cut);
      const blob = await composeCutPng(url);
      if (blob) zip.file(`cut_${String(idx + 1).padStart(2, "0")}.png`, blob);
    }
    downloadBlob(await zip.generateAsync({ type: "blob" }), `cuts.zip`);
    setMsg("書き出しが完了しました。");
  }, []);

  // --- 派生値 ---
  const pendingCount = useMemo(
    () => project.cuts.filter((c) => !c.resultAssetId).length,
    [project.cuts]
  );
  const globalViolations = useMemo(() => {
    const names = new Set<string>();
    for (const c of project.cuts) {
      for (const v of findNameViolations(c.textJa, project.bannedNames)) names.add(v);
    }
    return Array.from(names);
  }, [project.cuts, project.bannedNames]);

  const selectedIndex = project.cuts.findIndex((c) => c.id === selectedId);
  const selectedCut = selectedIndex >= 0 ? project.cuts[selectedIndex] : null;
  const busy = queueRunning || translating || parsing;

  return (
    <div className="flex h-screen flex-col bg-[#0b0b0f]">
      {/* 上部バー */}
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <a href="/" className="text-sm text-zinc-400 hover:text-zinc-200">← Lab</a>
        <span className="text-sm font-semibold text-zinc-200">🎬 Storyboard</span>
        <input
          value={project.title}
          onChange={(e) => patch({ title: e.target.value })}
          className="w-44 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs"
        />
        <div className="flex-1" />
        <select
          value={project.modelKey}
          onChange={(e) => patch({ modelKey: e.target.value })}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs"
          title="生成モデル"
        >
          {SB_MODELS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label} (${m.pricePerImage}/枚)
            </option>
          ))}
        </select>
        <Button className="text-xs" disabled={busy || !project.cuts.length} onClick={translate}>
          {translating ? "英訳中…" : "✏ 英訳"}
        </Button>
        {queueRunning ? (
          <Button
            variant="danger"
            className="text-xs"
            onClick={() => {
              cancelRef.current = true;
            }}
          >
            ■ 中断 {queueLabel}
          </Button>
        ) : (
          <Button
            variant="primary"
            className="text-xs"
            disabled={busy || pendingCount === 0}
            title={`未生成 ${pendingCount} 枚 × $${model.pricePerImage}`}
            onClick={runQueue}
          >
            ▶ 一括生成 ({pendingCount}枚 ≈ ${(pendingCount * model.pricePerImage).toFixed(2)})
          </Button>
        )}
        <div className="flex items-center gap-1">
          <Button className="text-xs" disabled={!project.cuts.length} onClick={() => exportSheet("png")}>
            📄 シートPNG
          </Button>
          <Button className="text-xs" disabled={!project.cuts.length} onClick={() => exportSheet("pdf")}>
            📄 PDF
          </Button>
          <Button
            className="text-xs"
            disabled={!project.cuts.some((c) => c.resultAssetId)}
            title="全カットPNGをZIPで保存"
            onClick={() => exportCutsZip()}
          >
            🗜 ZIP
          </Button>
        </div>
        <Button variant="ghost" className="text-xs" onClick={() => setKeyModalOpen(true)}>
          ⚙ APIキー
        </Button>
      </header>

      {/* メッセージ / 警告 */}
      {(msg || error || globalViolations.length > 0) && (
        <div className="space-y-1 border-b border-zinc-800/60 px-3 py-1.5">
          {error && <p className="text-xs text-red-400">{error}</p>}
          {globalViolations.length > 0 && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-red-300">
                ⚠ 実在人名/IP語がカットに残っています: {globalViolations.join("、")}
                （置換するまで生成はブロックされます）
              </p>
              <Button className="px-2 py-0.5 text-[11px]" onClick={replaceBanned}>
                プレースホルダーへ一括置換
              </Button>
            </div>
          )}
          {msg && !error && <p className="text-xs text-zinc-500">{msg}</p>}
        </div>
      )}

      {/* 3ペイン */}
      <div className="flex min-h-0 flex-1">
        {/* 左: 字コンテエディタ */}
        <div className="flex w-[26%] min-w-[260px] flex-col border-r border-zinc-800">
          <div className="flex items-center gap-1.5 border-b border-zinc-800 px-2 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              字コンテ
            </span>
            <div className="flex-1" />
            <Button
              variant="ghost"
              className="px-1.5 py-0.5 text-[11px]"
              onClick={() => patch({ scriptText: SAMPLE_SCRIPT })}
            >
              サンプル
            </Button>
            <Button
              variant="primary"
              className="px-2 py-0.5 text-[11px]"
              disabled={!project.scriptText.trim() || busy}
              title="AIが任意の書式の字コンテを解釈してシーン・カットに分解します（失敗時は記法パーサー）"
              onClick={parseNow}
            >
              {parsing ? "分解中…" : "🤖 カット表に分解 →"}
            </Button>
          </div>
          <textarea
            value={project.scriptText}
            onChange={(e) => patch({ scriptText: e.target.value })}
            placeholder={
              "字コンテを貼り付けてください。\n\n記法:\n（ト書き）= 画の本体\nBGM: / SE: / T： / NA（名前）「…」\n話者「セリフ」\n空行・（カット替わり）で区切り"
            }
            className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-relaxed outline-none"
            spellCheck={false}
          />
        </div>

        {/* 中: カット表 */}
        <div className="min-w-0 flex-1 overflow-y-auto border-r border-zinc-800">
          <CutTable
            cuts={project.cuts}
            scenes={project.scenes ?? []}
            characters={project.characters}
            bannedNames={project.bannedNames}
            selectedId={selectedId}
            busy={busy}
            onSelect={setSelectedId}
            onUpdate={updateCut}
            onUpdateScene={updateScene}
            onMerge={(i) => patch({ cuts: mergeWithPrevious(projectRef.current.cuts, i) })}
            onSplit={(i) => patch({ cuts: splitCut(projectRef.current.cuts, i) })}
            onDelete={(id) =>
              patch({ cuts: projectRef.current.cuts.filter((c) => c.id !== id) })
            }
            onToggleCharacter={(cutId, key) => {
              const cut = projectRef.current.cuts.find((c) => c.id === cutId);
              if (!cut) return;
              updateCut(cutId, {
                characters: cut.characters.includes(key)
                  ? cut.characters.filter((k) => k !== key)
                  : [...cut.characters, key],
                generatedPrompt: undefined,
              });
            }}
            onGenerateOne={(id) => generateOne(id).catch(() => {})}
          />
        </div>

        {/* 右: プレビュー + 修正指示 */}
        <div className="w-[30%] min-w-[300px] overflow-y-auto">
          <CutPreview
            cut={selectedCut}
            index={selectedIndex}
            busy={busy}
            onUpdate={updateCut}
            onRegenerate={(id) => generateOne(id, { useEditNote: true }).catch(() => {})}
            onRegenerateNoText={(id) =>
              generateOne(id, { useEditNote: true, emphasizeNoText: true }).catch(() => {})
            }
            onExportPng={exportCutPng}
            onZoom={(url) =>
              setLightbox({ id: selectedCut?.id ?? "cut", dataUrl: url, mimeType: "image/png" })
            }
          />
        </div>
      </div>

      {/* 下部ドック: キャラシート横並び + スタイル設定（常設・1画面で完結） */}
      <BottomDock
        project={project}
        charBusyKey={charBusyKey}
        analyzing={styleAnalyzing}
        onPatch={patch}
        onUpdateChar={updateCharacter}
        onAddChar={() =>
          patch({
            characters: [
              ...projectRef.current.characters,
              {
                key: nextKey("CHAR", projectRef.current.characters.map((c) => c.key)),
                displayName: "",
                descriptionJa: "",
              },
            ],
          })
        }
        onDeleteChar={(key) =>
          setProject((prev) => ({
            ...prev,
            characters: prev.characters.filter((c) => c.key !== key),
            cuts: prev.cuts.map((c) => ({
              ...c,
              characters: c.characters.filter((k) => k !== key),
            })),
            updatedAt: Date.now(),
          }))
        }
        onGenerateChar={generateCharacter}
        onGenerateCharFromFace={generateCharacterFromFace}
        onUploadChar={uploadCharacter}
        onUploadStyleImage={uploadStyleImage}
        onAnalyzeStyleImage={analyzeStyleImage}
        onClearStyleImage={clearStyleImage}
        onAddBanned={(name) =>
          patch({
            bannedNames: Array.from(new Set([...projectRef.current.bannedNames, name])),
          })
        }
        onRemoveBanned={(name) =>
          patch({
            bannedNames: projectRef.current.bannedNames.filter((n) => n !== name),
          })
        }
      />

      <Lightbox image={lightbox} onClose={() => setLightbox(null)} onAssign={() => {}} />

      <ApiKeyModal
        open={keyModalOpen}
        onClose={() => setKeyModalOpen(false)}
        onSaved={() => {
          setGeminiKey(getApiKey("gemini"));
          setOpenaiKey(getApiKey("openai"));
        }}
      />
    </div>
  );
}
