import { HospitalRecord, DailyAdmission, SourceCV, FunnelStep } from "./types";

export function getAvailableMonths(records: HospitalRecord[]): { year: number; month: number; label: string; count: number }[] {
  const monthCounts = new Map<string, number>();
  for (const r of records) {
    const d = r.admission_date || r.referral_inquiry_date || r.family_inquiry_date || r.visit_date;
    if (!d) continue;
    const parsed = new Date(d);
    if (isNaN(parsed.getTime()) || parsed.getFullYear() < 2020) continue;
    const key = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
    monthCounts.set(key, (monthCounts.get(key) || 0) + 1);
  }
  return [...monthCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => {
      const [y, m] = key.split("-").map(Number);
      return { year: y, month: m, label: `${m}月`, count };
    });
}

export function filterRecordsByMonth(records: HospitalRecord[], target: { year: number; month: number }): HospitalRecord[] {
  return records.filter((r) => {
    const d = r.admission_date || r.referral_inquiry_date || r.family_inquiry_date || r.visit_date;
    if (!d) return false;
    const parsed = new Date(d);
    if (isNaN(parsed.getTime())) return false;
    return parsed.getFullYear() === target.year && parsed.getMonth() + 1 === target.month;
  });
}

export function getDataMonth(records: HospitalRecord[]): { year: number; month: number; label: string } {
  const dates: Date[] = [];
  for (const r of records) {
    const d = r.admission_date || r.referral_inquiry_date || r.family_inquiry_date || r.visit_date;
    if (!d) continue;
    const parsed = new Date(d);
    if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2025) dates.push(parsed);
  }
  if (dates.length === 0) return { year: 2025, month: 1, label: "1月" };
  const monthCounts = new Map<string, number>();
  for (const d of dates) {
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    monthCounts.set(key, (monthCounts.get(key) || 0) + 1);
  }
  const [topKey] = [...monthCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const [y, m] = topKey.split("-").map(Number);
  return { year: y, month: m, label: `${m}月` };
}

export function getDailyAdmissions(records: HospitalRecord[], targetMonth?: { year: number; month: number }): DailyAdmission[] {
  const dayMap = new Map<string, number>();

  for (const r of records) {
    if (r.status === "入院" && r.admission_date) {
      const d = new Date(r.admission_date);
      if (isNaN(d.getTime()) || d.getFullYear() < 2025) continue;
      if (targetMonth && (d.getFullYear() !== targetMonth.year || d.getMonth() + 1 !== targetMonth.month)) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dayMap.set(key, (dayMap.get(key) || 0) + 1);
    }
  }

  return [...dayMap.keys()]
    .sort()
    .map((key) => {
      const dd = parseInt(key.split("-")[2]);
      return { date: key, label: `${dd}`, count: dayMap.get(key) || 0 };
    });
}

// backward compat alias
export const getMonthlyAdmissions = getDailyAdmissions;

export function getSourceCVData(records: HospitalRecord[]): SourceCV[] {
  const sourceMap = new Map<string, { total: number; admitted: number }>();

  for (const r of records) {
    const src = r.referral_source || "不明";
    if (!src || src === "　" || src === "") continue;
    if (!sourceMap.has(src)) sourceMap.set(src, { total: 0, admitted: 0 });
    const entry = sourceMap.get(src)!;
    entry.total++;
    if (r.status === "入院") entry.admitted++;
  }

  return [...sourceMap.entries()]
    .map(([source, { total, admitted }]) => ({
      source,
      totalContacts: total,
      admissions: admitted,
      cvr: total > 0 ? Math.round((admitted / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.admissions - a.admissions);
}

export function getStatusDistribution(records: HospitalRecord[]): { name: string; value: number; color: string }[] {
  const statusMap = new Map<string, number>();
  for (const r of records) {
    const s = r.status || "不明";
    statusMap.set(s, (statusMap.get(s) || 0) + 1);
  }

  const colorMap: Record<string, string> = {
    入院: "#059669",
    キャンセル: "#dc2626",
    入院不可: "#f59e0b",
    問い合わせのみ: "#6366f1",
    入院予定: "#3b82f6",
    情報待ち: "#8b5cf6",
    検討中: "#06b6d4",
    見学のみ: "#ec4899",
    調整中: "#14b8a6",
    返事待ち: "#f97316",
    面談予定: "#84cc16",
  };

  return [...statusMap.entries()]
    .map(([name, value]) => ({
      name,
      value,
      color: colorMap[name] || "#94a3b8",
    }))
    .sort((a, b) => b.value - a.value);
}

export function getReferralRouteData(records: HospitalRecord[]): { name: string; value: number }[] {
  const routeMap = new Map<string, number>();
  for (const r of records) {
    const route = r.referral_route || "";
    if (!route || route === "　" || route === "") continue;
    routeMap.set(route, (routeMap.get(route) || 0) + 1);
  }
  return [...routeMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export function getDailyContacts(records: HospitalRecord[], targetMonth?: { year: number; month: number }): { date: string; label: string; contacts: number; admissions: number }[] {
  const dayData = new Map<string, { contacts: number; admissions: number }>();

  for (const r of records) {
    const firstContact =
      r.referral_inquiry_date || r.family_inquiry_date || r.visit_date;
    if (!firstContact) continue;
    const d = new Date(firstContact);
    if (isNaN(d.getTime()) || d.getFullYear() < 2025) continue;
    if (targetMonth && (d.getFullYear() !== targetMonth.year || d.getMonth() + 1 !== targetMonth.month)) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!dayData.has(key)) dayData.set(key, { contacts: 0, admissions: 0 });
    const entry = dayData.get(key)!;
    entry.contacts++;
    if (r.status === "入院") entry.admissions++;
  }

  return [...dayData.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, data]) => {
      const [, m, dd] = key.split("-");
      return {
        date: key,
        label: `${parseInt(dd)}`,
        ...data,
      };
    });
}

// backward compat alias
export const getMonthlyContacts = getDailyContacts;

export function getFunnelData(records: HospitalRecord[]): FunnelStep[] {
  let inquiry = 0,
    infoReceived = 0,
    responded = 0,
    meeting = 0,
    applied = 0,
    admitted = 0;

  for (const r of records) {
    const hasContact = r.referral_inquiry_date || r.family_inquiry_date || r.visit_date;
    if (hasContact) inquiry++;
    if (r.medical_info_received_date) infoReceived++;
    if (r.admission_response_date) responded++;
    if (r.meeting_date) meeting++;
    if (r.admission_application_date) applied++;
    if (r.status === "入院") admitted++;
  }

  return [
    { name: "問い合わせ", count: inquiry },
    { name: "診療情報受取", count: infoReceived },
    { name: "入院可否返答", count: responded },
    { name: "面談実施", count: meeting },
    { name: "入院申込", count: applied },
    { name: "入院（CV）", count: admitted },
  ];
}

export function getLeadTimeStats(records: HospitalRecord[]): { avg: number; median: number; min: number; max: number } {
  const days: number[] = [];
  for (const r of records) {
    if (r.status !== "入院") continue;
    const firstContact = r.referral_inquiry_date || r.family_inquiry_date || r.visit_date;
    if (!firstContact || !r.admission_date) continue;
    const start = new Date(firstContact);
    const end = new Date(r.admission_date);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
    const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (diff >= 0 && diff < 365) days.push(diff);
  }

  if (days.length === 0) return { avg: 0, median: 0, min: 0, max: 0 };
  days.sort((a, b) => a - b);
  const avg = Math.round(days.reduce((s, d) => s + d, 0) / days.length);
  const median = days[Math.floor(days.length / 2)];
  return { avg, median, min: days[0], max: days[days.length - 1] };
}

export function getCancelReasonData(records: HospitalRecord[]): { name: string; value: number }[] {
  const reasonMap = new Map<string, number>();
  for (const r of records) {
    if (r.status !== "キャンセル") continue;
    const reason = r.cancel_reason || "不明";
    if (reason === "　" || reason === "") continue;
    reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
  }
  return [...reasonMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export function getKPAddressData(records: HospitalRecord[]): { address: string; count: number }[] {
  const addrMap = new Map<string, number>();
  for (const r of records) {
    if (r.status !== "入院") continue;
    const addr = r.kp_address || "";
    if (!addr || addr === "　" || addr === "") continue;
    addrMap.set(addr, (addrMap.get(addr) || 0) + 1);
  }
  return [...addrMap.entries()]
    .map(([address, count]) => ({ address, count }))
    .sort((a, b) => b.count - a.count);
}

export interface SourceDailyData {
  date: string;
  label: string;
  [source: string]: number | string;
}

export type SourceMonthlyData = SourceDailyData;

export function getSourceDailyTrend(
  records: HospitalRecord[],
  topN: number = 10,
  targetMonth?: { year: number; month: number }
): { data: SourceDailyData[]; sources: string[] } {
  const sourceAdmissions = new Map<string, number>();
  for (const r of records) {
    if (r.status !== "入院" || !r.referral_source) continue;
    const src = r.referral_source.trim();
    if (!src || src === "　") continue;
    sourceAdmissions.set(src, (sourceAdmissions.get(src) || 0) + 1);
  }
  const topSources = [...sourceAdmissions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name]) => name);

  const daySourceMap = new Map<string, Map<string, number>>();
  for (const r of records) {
    if (r.status !== "入院" || !r.admission_date || !r.referral_source) continue;
    const src = r.referral_source.trim();
    if (!topSources.includes(src)) continue;
    const d = new Date(r.admission_date);
    if (isNaN(d.getTime()) || d.getFullYear() < 2025) continue;
    if (targetMonth && (d.getFullYear() !== targetMonth.year || d.getMonth() + 1 !== targetMonth.month)) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!daySourceMap.has(key)) daySourceMap.set(key, new Map());
    const sourceMap = daySourceMap.get(key)!;
    sourceMap.set(src, (sourceMap.get(src) || 0) + 1);
  }

  const days = [...daySourceMap.keys()].sort();
  const data: SourceDailyData[] = days.map((key) => {
    const [, m, dd] = key.split("-");
    const row: SourceDailyData = { date: key, label: `${parseInt(dd)}` };
    const sourceMap = daySourceMap.get(key)!;
    for (const src of topSources) {
      row[src] = sourceMap.get(src) || 0;
    }
    return row;
  });

  return { data, sources: topSources };
}

// backward compat alias
export const getSourceMonthlyTrend = getSourceDailyTrend;

export function getPreAdmissionLocationData(records: HospitalRecord[]): { name: string; value: number }[] {
  const locMap = new Map<string, number>();
  for (const r of records) {
    if (r.status !== "入院") continue;
    const loc = r.pre_admission_location || "不明";
    if (loc === "　" || loc === "") continue;
    locMap.set(loc, (locMap.get(loc) || 0) + 1);
  }
  return [...locMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}
