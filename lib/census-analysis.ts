import type { DailyCensus } from "./report-export";
import type { Period } from "./analysis";

/** 許可病床数（経営会議報告資料の記載に合わせる） */
export const BED_COUNT = 306;

const toDate = (v: string): Date => {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/**
 * シート末尾には在院者数だけが見込み値で埋まった将来日が並ぶ（入院・退院とも0）。
 * 実績のある最終日以降を落とす。
 */
export function trimCensus(census: DailyCensus[]): DailyCensus[] {
  let last = -1;
  census.forEach((c, i) => {
    if (c.admissions > 0 || c.discharges > 0) last = i;
  });
  return last < 0 ? [] : census.slice(0, last + 1);
}

export interface DailyCensusPoint {
  label: string;
  date: string;
  入院: number;
  退院: number;
  在院者数: number | null;
}

/** 表示期間内の日次推移 */
export function dailyCensus(census: DailyCensus[], period: Period): DailyCensusPoint[] {
  return census
    .filter((c) => {
      const d = toDate(c.date);
      return d >= period.from && d <= period.to;
    })
    .map((c) => ({
      // 期間が複数月にまたがる場合は「M/D」表記にする
      label: period.isMonth
        ? String(Number(c.date.slice(8, 10)))
        : `${Number(c.date.slice(5, 7))}/${Number(c.date.slice(8, 10))}`,
      date: c.date,
      入院: c.admissions,
      退院: c.discharges,
      在院者数: c.census,
    }));
}

export interface MonthlyCensusPoint {
  key: string;
  label: string;
  入院: number;
  退院: number;
  純増減: number;
  在院者数: number;
  稼働率: number;
}

/** 月次推移（暦月ベース） */
export function monthlyCensusTrend(census: DailyCensus[], limit = 15): MonthlyCensusPoint[] {
  const groups = new Map<string, DailyCensus[]>();
  census.forEach((c) => {
    const key = c.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  });
  const out: MonthlyCensusPoint[] = [];
  groups.forEach((days, key) => {
    const 入院 = days.reduce((s, d) => s + d.admissions, 0);
    const 退院 = days.reduce((s, d) => s + d.discharges, 0);
    const values = days.map((d) => d.census).filter((v): v is number => v != null);
    const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    const [y, m] = key.split("-");
    out.push({
      key,
      label: `${Number(m)}月`,
      入院,
      退院,
      純増減: 入院 - 退院,
      在院者数: Math.round(avg * 10) / 10,
      稼働率: Math.round((avg / BED_COUNT) * 1000) / 10,
    });
    void y;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : 1));
  return out.slice(-limit);
}

export interface CensusPeriodSummary {
  /** 前月21日〜当月20日 */
  from: string;
  to: string;
  admissions: number;
  discharges: number;
  net: number;
  censusOn20th: number | null;
  censusAverage: number | null;
  occupancy: number | null;
  hasData: boolean;
}

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 経営会議報告と同じ「前月21日〜当月20日」の集計 */
export function censusPeriodSummary(
  census: DailyCensus[],
  target: { year: number; month: number },
): CensusPeriodSummary {
  const from = new Date(target.year, target.month - 2, 21);
  const to = new Date(target.year, target.month - 1, 20);
  const seg = census.filter((c) => {
    const d = toDate(c.date);
    return d >= from && d <= to;
  });
  const values = seg.map((c) => c.census).filter((v): v is number => v != null);
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  const admissions = seg.reduce((s, c) => s + c.admissions, 0);
  const discharges = seg.reduce((s, c) => s + c.discharges, 0);
  return {
    from: fmtDate(from),
    to: fmtDate(to),
    admissions,
    discharges,
    net: admissions - discharges,
    censusOn20th: census.find((c) => c.date === fmtDate(to))?.census ?? null,
    censusAverage: avg != null ? Math.round(avg * 10) / 10 : null,
    occupancy: avg != null ? Math.round((avg / BED_COUNT) * 1000) / 10 : null,
    hasData: seg.length > 0,
  };
}

/** 表示期間の集計。前年同期比の相手にも使う */
export function censusMonthSummary(census: DailyCensus[], period: Period) {
  const days = dailyCensus(census, period);
  if (days.length === 0) return null;
  const values = days.map((d) => d.在院者数).filter((v): v is number => v != null);
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const admissions = days.reduce((s, d) => s + d.入院, 0);
  const discharges = days.reduce((s, d) => s + d.退院, 0);
  return {
    admissions,
    discharges,
    net: admissions - discharges,
    censusAverage: Math.round(avg * 10) / 10,
    occupancy: Math.round((avg / BED_COUNT) * 1000) / 10,
    peak: values.length ? Math.max(...values) : 0,
    bottom: values.length ? Math.min(...values) : 0,
  };
}
