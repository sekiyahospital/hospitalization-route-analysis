import { HospitalRecord } from "./types";

export interface CrossCell {
  row: string;
  col: string;
  total: number;
  admitted: number;
  cvr: number;
}

export interface CrossTable {
  title: string;
  description: string;
  rows: string[];
  cols: string[];
  cells: CrossCell[];
  insight: string;
}

export interface FactorImpact {
  factor: string;
  segment: string;
  total: number;
  admitted: number;
  cvr: number;
  lift: number;
}

export interface CrossAnalysisResult {
  overallCVR: number;
  sourceByLocation: CrossTable;
  routeByLocation: CrossTable;
  leadTimeByCVR: { bucket: string; total: number; admitted: number; cvr: number }[];
  touchPointByCVR: { points: string; total: number; admitted: number; cvr: number }[];
  factorRanking: FactorImpact[];
  goldenPaths: { path: string; cvr: number; count: number; lift: number }[];
  riskPatterns: { pattern: string; cvr: number; count: number; detail: string }[];
}

function buildCrossTable(
  records: HospitalRecord[],
  getRow: (r: HospitalRecord) => string | null,
  getCol: (r: HospitalRecord) => string | null,
  title: string,
  description: string,
  topRows: number = 8,
  topCols: number = 6
): CrossTable {
  const pairMap = new Map<string, { total: number; admitted: number }>();
  const rowCounts = new Map<string, number>();
  const colCounts = new Map<string, number>();

  for (const r of records) {
    const row = getRow(r);
    const col = getCol(r);
    if (!row || !col) continue;
    const key = `${row}|||${col}`;
    if (!pairMap.has(key)) pairMap.set(key, { total: 0, admitted: 0 });
    const entry = pairMap.get(key)!;
    entry.total++;
    if (r.status === "入院") entry.admitted++;
    rowCounts.set(row, (rowCounts.get(row) || 0) + 1);
    colCounts.set(col, (colCounts.get(col) || 0) + 1);
  }

  const rows = [...rowCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topRows)
    .map(([name]) => name);
  const cols = [...colCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topCols)
    .map(([name]) => name);

  const cells: CrossCell[] = [];
  let bestCell: CrossCell | null = null;

  for (const row of rows) {
    for (const col of cols) {
      const key = `${row}|||${col}`;
      const entry = pairMap.get(key);
      if (entry && entry.total >= 2) {
        const cell: CrossCell = {
          row,
          col,
          total: entry.total,
          admitted: entry.admitted,
          cvr: Math.round((entry.admitted / entry.total) * 1000) / 10,
        };
        cells.push(cell);
        if (!bestCell || (cell.cvr > bestCell.cvr && cell.total >= 3)) {
          bestCell = cell;
        }
      }
    }
  }

  const insight = bestCell
    ? `「${bestCell.row}」×「${bestCell.col}」の組み合わせがCVR ${bestCell.cvr}%（${bestCell.total}件中${bestCell.admitted}件入院）と最も高い成約率を示しています。`
    : "";

  return { title, description, rows, cols, cells, insight };
}

function getLeadTimeBucket(r: HospitalRecord): string | null {
  const firstContact = r.referral_inquiry_date || r.family_inquiry_date || r.visit_date;
  if (!firstContact || !r.admission_date) return null;
  const start = new Date(firstContact);
  const end = new Date(r.admission_date);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0 || days > 365) return null;
  if (days <= 7) return "1週間以内";
  if (days <= 14) return "2週間以内";
  if (days <= 21) return "3週間以内";
  if (days <= 30) return "1ヶ月以内";
  if (days <= 60) return "2ヶ月以内";
  return "2ヶ月超";
}

function getTouchPoints(r: HospitalRecord): number {
  let count = 0;
  if (r.family_inquiry_date) count++;
  if (r.visit_date) count++;
  if (r.referral_inquiry_date) count++;
  if (r.medical_info_received_date) count++;
  if (r.admission_response_date) count++;
  if (r.family_meeting_booking_date) count++;
  if (r.meeting_date) count++;
  if (r.admission_application_date) count++;
  return count;
}

export function runCrossAnalysis(records: HospitalRecord[]): CrossAnalysisResult {
  const totalAdmitted = records.filter((r) => r.status === "入院").length;
  const overallCVR = Math.round((totalAdmitted / records.length) * 1000) / 10;

  // 1. Source × Pre-admission Location
  const sourceByLocation = buildCrossTable(
    records,
    (r) => {
      const src = r.referral_source?.trim();
      return src && src !== "　" ? src : null;
    },
    (r) => {
      const loc = r.pre_admission_location?.trim();
      return loc && loc !== "　" && loc !== "" ? loc : null;
    },
    "紹介元 × 入院前居所",
    "どの紹介元から、どの居所タイプの患者が来た時にCVRが高いか",
    10,
    6
  );

  // 2. Route × Pre-admission Location
  const routeByLocation = buildCrossTable(
    records,
    (r) => {
      const route = r.referral_route?.trim();
      return route && route !== "　" && route !== "" ? route : null;
    },
    (r) => {
      const loc = r.pre_admission_location?.trim();
      return loc && loc !== "　" && loc !== "" ? loc : null;
    },
    "紹介経路 × 入院前居所",
    "どの紹介経路と居所の組み合わせが入院に結びつきやすいか",
    8,
    6
  );

  // 3. Lead time buckets
  const leadTimeBuckets = new Map<string, { total: number; admitted: number }>();
  const bucketOrder = ["1週間以内", "2週間以内", "3週間以内", "1ヶ月以内", "2ヶ月以内", "2ヶ月超"];
  for (const b of bucketOrder) leadTimeBuckets.set(b, { total: 0, admitted: 0 });

  for (const r of records) {
    const bucket = getLeadTimeBucket(r);
    if (!bucket) continue;
    if (!leadTimeBuckets.has(bucket)) leadTimeBuckets.set(bucket, { total: 0, admitted: 0 });
    const entry = leadTimeBuckets.get(bucket)!;
    entry.total++;
    if (r.status === "入院") entry.admitted++;
  }

  const leadTimeByCVR = bucketOrder
    .map((bucket) => {
      const entry = leadTimeBuckets.get(bucket)!;
      return {
        bucket,
        total: entry.total,
        admitted: entry.admitted,
        cvr: entry.total > 0 ? Math.round((entry.admitted / entry.total) * 1000) / 10 : 0,
      };
    })
    .filter((b) => b.total > 0);

  // 4. Touch points × CVR
  const touchMap = new Map<number, { total: number; admitted: number }>();
  for (const r of records) {
    const tp = getTouchPoints(r);
    if (!touchMap.has(tp)) touchMap.set(tp, { total: 0, admitted: 0 });
    const entry = touchMap.get(tp)!;
    entry.total++;
    if (r.status === "入院") entry.admitted++;
  }

  const touchPointByCVR = [...touchMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([points, { total, admitted }]) => ({
      points: `${points}ポイント`,
      total,
      admitted,
      cvr: total > 0 ? Math.round((admitted / total) * 1000) / 10 : 0,
    }));

  // 5. Factor impact ranking
  const factorRanking: FactorImpact[] = [];

  const analyzeSegment = (
    factor: string,
    getSegment: (r: HospitalRecord) => string | null,
    minCount: number = 5
  ) => {
    const segMap = new Map<string, { total: number; admitted: number }>();
    for (const r of records) {
      const seg = getSegment(r);
      if (!seg) continue;
      if (!segMap.has(seg)) segMap.set(seg, { total: 0, admitted: 0 });
      const entry = segMap.get(seg)!;
      entry.total++;
      if (r.status === "入院") entry.admitted++;
    }
    for (const [segment, { total, admitted }] of segMap) {
      if (total < minCount) continue;
      const cvr = Math.round((admitted / total) * 1000) / 10;
      factorRanking.push({
        factor,
        segment,
        total,
        admitted,
        cvr,
        lift: Math.round((cvr / overallCVR) * 100) / 100,
      });
    }
  };

  analyzeSegment("入院前居所", (r) => {
    const v = r.pre_admission_location?.trim();
    return v && v !== "　" && v !== "" ? v : null;
  });

  analyzeSegment("紹介経路", (r) => {
    const v = r.referral_route?.trim();
    return v && v !== "　" && v !== "" ? v : null;
  });

  analyzeSegment("リードタイム帯", getLeadTimeBucket);

  analyzeSegment("タッチポイント数", (r) => {
    const tp = getTouchPoints(r);
    return `${tp}ポイント`;
  });

  analyzeSegment("面談実施", (r) => (r.meeting_date ? "面談あり" : "面談なし"));
  analyzeSegment("見学実施", (r) => (r.visit_date ? "見学あり" : "見学なし"));
  analyzeSegment("家族問い合わせ", (r) => (r.family_inquiry_date ? "家族問い合わせあり" : "なし"));

  factorRanking.sort((a, b) => b.lift - a.lift);

  // 6. Golden paths (high CVR combinations)
  const pathMap = new Map<string, { total: number; admitted: number }>();
  for (const r of records) {
    const src = r.referral_source?.trim();
    const loc = r.pre_admission_location?.trim();
    const hasMeeting = r.meeting_date ? "面談あり" : "面談なし";
    if (!src || src === "　" || !loc || loc === "　" || loc === "") continue;

    const path = `${src} → ${loc} → ${hasMeeting}`;
    if (!pathMap.has(path)) pathMap.set(path, { total: 0, admitted: 0 });
    const entry = pathMap.get(path)!;
    entry.total++;
    if (r.status === "入院") entry.admitted++;
  }

  const goldenPaths = [...pathMap.entries()]
    .filter(([, v]) => v.total >= 3)
    .map(([path, { total, admitted }]) => {
      const cvr = Math.round((admitted / total) * 1000) / 10;
      return { path, cvr, count: total, lift: Math.round((cvr / overallCVR) * 100) / 100 };
    })
    .sort((a, b) => b.cvr - a.cvr)
    .slice(0, 10);

  // 7. Risk patterns (low CVR)
  const riskPatterns = [...pathMap.entries()]
    .filter(([, v]) => v.total >= 3 && (v.admitted / v.total) < overallCVR / 100)
    .map(([path, { total, admitted }]) => {
      const cvr = Math.round((admitted / total) * 1000) / 10;
      const parts = path.split(" → ");
      const detail = `${parts[0]}から${parts[1]}の患者で${parts[2]}の場合、CVR ${cvr}%と全体平均${overallCVR}%を大きく下回っています。`;
      return { pattern: path, cvr, count: total, detail };
    })
    .sort((a, b) => a.cvr - b.cvr)
    .slice(0, 8);

  return {
    overallCVR,
    sourceByLocation,
    routeByLocation,
    leadTimeByCVR,
    touchPointByCVR,
    factorRanking,
    goldenPaths,
    riskPatterns,
  };
}
