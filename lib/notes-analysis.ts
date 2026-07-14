import { HospitalRecord } from "./types";

export interface NoteCategory {
  label: string;
  keywords: string[];
}

const SELECTION_REASONS: NoteCategory[] = [
  { label: "評判・口コミ", keywords: ["評判", "口コミ", "勧め", "良かった"] },
  { label: "HP・SNS経由", keywords: ["ホームページ", "HP", "インスタ", "ブログ", "食事", "ネット"] },
  { label: "医療処置対応", keywords: ["胃瘻", "CVポート", "気管切開", "人工呼吸", "吸引", "IVH", "PICC", "ポート", "バルーン"] },
  { label: "入院歴あり（リピート）", keywords: ["入院歴", "入院していた", "以前入院", "再入院"] },
  { label: "看取り・終末期", keywords: ["看取り", "ターミナル", "緩和", "最期"] },
  { label: "距離・近さ", keywords: ["近い", "近く", "距離", "近所", "自宅から近"] },
  { label: "介護困難", keywords: ["介護難", "自宅での介護", "在宅困難", "介護できない"] },
  { label: "ケアマネ紹介", keywords: ["ケアマネ", "CM"] },
  { label: "レスパイト", keywords: ["レスパイト"] },
  { label: "家族・KP関連", keywords: ["家族", "KP", "親族"] },
];

const CANCEL_PATTERNS: NoteCategory[] = [
  { label: "状態悪化・死亡", keywords: ["状態悪化", "急変", "急逝", "看取り", "死亡", "逝去"] },
  { label: "施設志向", keywords: ["施設", "老健", "入所", "特養"] },
  { label: "他院決定", keywords: ["他院", "病院で決", "病院に決", "病院を希望", "病院にされ", "で決定"] },
  { label: "費用面", keywords: ["費用", "金銭", "高額", "負担金", "リース料", "生保", "金額"] },
  { label: "リハビリ希望", keywords: ["リハビリ", "リハ目的", "リハ希望", "回復期"] },
  { label: "家族都合", keywords: ["面会", "通うのが大変", "家族の都合"] },
  { label: "距離・遠い", keywords: ["距離", "遠い", "近い方", "近くの"] },
];

const MEDICAL_NEEDS: NoteCategory[] = [
  { label: "胃瘻", keywords: ["胃瘻", "PEG"] },
  { label: "CVポート", keywords: ["CVポート", "ポート"] },
  { label: "気管切開", keywords: ["気管切開"] },
  { label: "人工呼吸器", keywords: ["人工呼吸", "呼吸器"] },
  { label: "吸引", keywords: ["吸引"] },
  { label: "IVH・PICC", keywords: ["IVH", "PICC", "中心静脈"] },
  { label: "麻薬", keywords: ["麻薬", "オピオイド"] },
  { label: "看取り", keywords: ["看取り", "ターミナル", "緩和ケア"] },
  { label: "レスパイト", keywords: ["レスパイト", "短期入院"] },
  { label: "透析", keywords: ["透析"] },
];

function matchCategories(note: string, categories: NoteCategory[]): string[] {
  const matched: string[] = [];
  for (const cat of categories) {
    if (cat.keywords.some((kw) => note.includes(kw))) {
      matched.push(cat.label);
    }
  }
  return matched;
}

export interface CategoryCount {
  label: string;
  count: number;
  examples: string[];
}

function countCategories(
  notes: { note: string; status: string }[],
  categories: NoteCategory[],
  filterStatus?: string
): CategoryCount[] {
  const filtered = filterStatus
    ? notes.filter((n) => n.status === filterStatus)
    : notes;

  return categories
    .map((cat) => {
      const matches = filtered.filter((n) =>
        cat.keywords.some((kw) => n.note.includes(kw))
      );
      return {
        label: cat.label,
        count: matches.length,
        examples: matches.slice(0, 3).map((m) => m.note.slice(0, 80)),
      };
    })
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function extractCompetitors(records: HospitalRecord[]): { name: string; count: number }[] {
  const competitors = new Map<string, number>();
  const pattern = /([ぁ-ん゠-ヿa-zA-Zａ-ｚＡ-Ｚ一-龥ー]+(?:病院|クリニック|医療センター))/g;

  for (const r of records) {
    if (r.status !== "キャンセル") continue;
    const note = r.notes?.trim();
    if (!note || note === "None") continue;

    let match;
    while ((match = pattern.exec(note)) !== null) {
      const name = match[1];
      if (!name.includes("当院") && !name.includes("紹介元") && name.length > 3) {
        competitors.set(name, (competitors.get(name) || 0) + 1);
      }
    }
    pattern.lastIndex = 0;
  }

  return [...competitors.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export interface NotesAnalysisResult {
  totalWithNotes: number;
  totalRecords: number;
  selectionReasons: CategoryCount[];
  cancelPatterns: CategoryCount[];
  medicalNeeds: CategoryCount[];
  competitors: { name: string; count: number }[];
  improvableCancels: {
    total: number;
    byReason: { label: string; count: number }[];
  };
}

export function analyzeNotes(records: HospitalRecord[]): NotesAnalysisResult {
  const notes = records
    .filter((r) => r.notes?.trim() && r.notes.trim() !== "None" && r.notes.trim() !== "　")
    .map((r) => ({ note: r.notes.trim(), status: r.status }));

  const selectionReasons = countCategories(notes, SELECTION_REASONS, "入院");
  const cancelPatterns = countCategories(notes, CANCEL_PATTERNS, "キャンセル");
  const medicalNeeds = countCategories(notes, MEDICAL_NEEDS);
  const competitors = extractCompetitors(records);

  const improvableLabels = ["他院決定", "費用面", "リハビリ希望", "家族都合", "距離・遠い"];
  const improvableCancels = cancelPatterns.filter((c) =>
    improvableLabels.includes(c.label)
  );

  return {
    totalWithNotes: notes.length,
    totalRecords: records.length,
    selectionReasons,
    cancelPatterns,
    medicalNeeds,
    competitors,
    improvableCancels: {
      total: improvableCancels.reduce((s, c) => s + c.count, 0),
      byReason: improvableCancels.map((c) => ({ label: c.label, count: c.count })),
    },
  };
}
