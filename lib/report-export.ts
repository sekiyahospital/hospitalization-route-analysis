import type { HospitalRecord } from "./types";

/** 入退院数情報シート由来の日次データ */
export interface DailyCensus {
  date: string;
  admissions: number;
  discharges: number;
  census: number | null;
  /** 「（短期）」列。短期入院の調整値として入力されている */
  shortStay?: number | null;
}

/** 報告対象月（前月21日〜当月20日 締め） */
export interface ReportPeriod {
  year: number;
  month: number;
  from: Date;
  to: Date;
  label: string;
}

const MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

export function fiscalYearOf(year: number, month: number): number {
  return month >= 4 ? year : year - 1;
}

/** 年度の各月に対応する暦年 */
function calendarYear(fy: number, month: number): number {
  return month >= 4 ? fy : fy + 1;
}

export function makePeriod(year: number, month: number): ReportPeriod {
  return {
    year,
    month,
    from: new Date(year, month - 2, 21),
    to: new Date(year, month - 1, 20),
    label: `${month}月`,
  };
}

const toDate = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

const inPeriod = (v: string | null | undefined, p: ReportPeriod): boolean => {
  const d = toDate(v);
  return !!d && d >= p.from && d <= p.to;
};

/** 入院前居所 → 【1】再掲区分 */
const HOSPITAL_LOC = ["急性期病棟", "回復期病棟", "地域包括病棟", "療養病棟", "当院からの診療依頼先"];
function locationBucket(loc: string): "病院" | "施設等" | "在宅" | "不明" {
  const s = (loc || "").trim();
  if (HOSPITAL_LOC.includes(s)) return "病院";
  if (s.startsWith("施設")) return "施設等";
  if (s === "自宅") return "在宅";
  return "不明";
}

/** 情報提供元・紹介経路 → 病院／施設／居宅／個人 */
export function sourceBucket(rec: HospitalRecord): "病院" | "施設" | "居宅" | "個人" | "再入院" {
  const route = (rec.referral_route || "").trim();
  const src = (rec.referral_source || "") + " " + (rec.referral_source_2 || "");
  if (route === "再入院") return "再入院";
  if (/居宅|ケアマネ|介護支援/.test(src) || route === "ケアマネが提示") return "居宅";
  if (/施設|老健|特養|ホーム|グループ|ｸﾞﾙｰﾌﾟ|サ高住|有料/.test(src) || route === "介護施設が提示") return "施設";
  if (/病院|クリニック|医院|ｸﾘﾆｯｸ|診療所|センター|ｾﾝﾀｰ/.test(src)) return "病院";
  if (/親族|口コミ|ﾎｰﾑﾍﾟｰｼﾞ|ホームページ|広報|広告/.test(route)) return "個人";
  return src.trim() ? "病院" : "個人";
}

/* ------------------------------------------------------------------ */
/* 【1】〜【3】の月次集計                                              */
/* ------------------------------------------------------------------ */

export interface MonthlyStats {
  /** 病棟実績の入院数 − 短期入院。病棟実績が無い月は台帳の入院件数 */
  longTermAdmissions: number | null;
  shortStay: number | null;
  /** 台帳で入院前居所が判明している件数（再掲） */
  fromHospital: number;
  fromFacility: number;
  fromHome: number;
  fromUnknown: number;
  /** 長期入院 − 台帳再掲の合計（台帳に載らない入院） */
  unreconciled: number | null;
  visits: number;
  meetings: number;
  censusOn20th: number | null;
  censusAverage: number | null;
  admissionsTotal: number | null;
  dischargesTotal: number | null;
  hasCensusData: boolean;
}

export function monthlyStats(
  records: HospitalRecord[],
  census: DailyCensus[],
  year: number,
  month: number,
): MonthlyStats {
  const p = makePeriod(year, month);
  const admitted = records.filter((r) => inPeriod(r.admission_date, p));
  const buckets = admitted.map((r) => locationBucket(r.pre_admission_location));

  const inRange = census.filter((c) => {
    const d = toDate(c.date);
    return !!d && d >= p.from && d <= p.to;
  });
  const censusValues = inRange.map((c) => c.census).filter((v): v is number => v != null);
  const key = `${year}-${String(month).padStart(2, "0")}-20`;
  const on20 = census.find((c) => c.date === key)?.census ?? null;

  const hasCensusData = inRange.length > 0;
  const admissionsTotal = hasCensusData ? inRange.reduce((s, c) => s + c.admissions, 0) : null;
  // 「（短期）」列は加減算の調整値として入っているため、プラス分のみを短期入院として数える
  const shortStay = hasCensusData ? inRange.reduce((s, c) => s + Math.max(0, c.shortStay ?? 0), 0) : null;
  const longTermAdmissions =
    admissionsTotal != null && shortStay != null ? admissionsTotal - shortStay : admitted.length;

  const fromHospital = buckets.filter((b) => b === "病院").length;
  const fromFacility = buckets.filter((b) => b === "施設等").length;
  const fromHome = buckets.filter((b) => b === "在宅").length;
  const fromUnknown = buckets.filter((b) => b === "不明").length;

  return {
    longTermAdmissions,
    shortStay,
    fromHospital,
    fromFacility,
    fromHome,
    fromUnknown,
    unreconciled:
      longTermAdmissions != null ? longTermAdmissions - (fromHospital + fromFacility + fromHome + fromUnknown) : null,
    visits: records.filter((r) => inPeriod(r.visit_date, p)).length,
    meetings: records.filter((r) => inPeriod(r.meeting_date, p)).length,
    censusOn20th: on20,
    censusAverage: censusValues.length ? Math.round((censusValues.reduce((s, v) => s + v, 0) / censusValues.length) * 10) / 10 : null,
    admissionsTotal,
    dischargesTotal: hasCensusData ? inRange.reduce((s, c) => s + c.discharges, 0) : null,
    hasCensusData,
  };
}

/* ------------------------------------------------------------------ */
/* 実績報告（PDF 2ページ目）                                           */
/* ------------------------------------------------------------------ */

export interface PerformanceReport {
  referrals: number;
  referralsBySource: Record<string, number>;
  engaged: number;
  engagedMeeting: number;
  engagedVisit: number;
  notEngaged: number;
  notEngagedReasons: Record<string, number>;
  otherPending: number;
  otherPendingBreakdown: Record<string, number>;
  admitted: number;
  notAdmitted: number;
  notAdmittedReasons: Record<string, number>;
  otherOutcome: number;
  otherOutcomeBreakdown: Record<string, number>;
  inquiryOnly: number;
  inquiryOnlyBySource: Record<string, number>;
}

const tally = (items: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  items.forEach((k) => {
    const key = k.trim() || "未記入";
    out[key] = (out[key] || 0) + 1;
  });
  return out;
};

export function performanceReport(records: HospitalRecord[], year: number, month: number): PerformanceReport {
  const p = makePeriod(year, month);
  // 当期に紹介元から問い合わせがあった案件
  const referred = records.filter((r) => inPeriod(r.referral_inquiry_date, p) || inPeriod(r.family_inquiry_date, p));
  const inquiryOnly = referred.filter((r) => r.status === "問い合わせのみ");
  const pipeline = referred.filter((r) => r.status !== "問い合わせのみ");

  const engaged = pipeline.filter((r) => r.meeting_date || r.visit_date);
  const notEngaged = pipeline.filter(
    (r) => !r.meeting_date && !r.visit_date && (r.status === "キャンセル" || r.status === "入院不可"),
  );
  const otherPending = pipeline.filter((r) => !r.meeting_date && !r.visit_date && r.status !== "キャンセル" && r.status !== "入院不可");

  const admitted = engaged.filter((r) => r.status === "入院");
  const notAdmitted = engaged.filter((r) => r.status === "キャンセル" || r.status === "入院不可");
  const otherOutcome = engaged.filter((r) => r.status !== "入院" && r.status !== "キャンセル" && r.status !== "入院不可");

  return {
    referrals: referred.length,
    referralsBySource: tally(referred.map((r) => sourceBucket(r))),
    engaged: engaged.length,
    engagedMeeting: engaged.filter((r) => r.meeting_date).length,
    engagedVisit: engaged.filter((r) => !r.meeting_date && r.visit_date).length,
    notEngaged: notEngaged.length,
    notEngagedReasons: tally(notEngaged.map((r) => r.cancel_reason || r.not_admitted_reason || "理由未記入")),
    otherPending: otherPending.length,
    otherPendingBreakdown: tally(otherPending.map((r) => r.status || "未記入")),
    admitted: admitted.length,
    notAdmitted: notAdmitted.length,
    notAdmittedReasons: tally(notAdmitted.map((r) => r.cancel_reason || r.not_admitted_reason || "理由未記入")),
    otherOutcome: otherOutcome.length,
    otherOutcomeBreakdown: tally(otherOutcome.map((r) => r.status || "未記入")),
    inquiryOnly: inquiryOnly.length,
    inquiryOnlyBySource: tally(inquiryOnly.map((r) => sourceBucket(r))),
  };
}

/** 【4】【5】翌期以降の予定 */
export function upcoming(records: HospitalRecord[], year: number, month: number) {
  const p = makePeriod(year, month);
  const after = (v: string | null | undefined) => {
    const d = toDate(v);
    return !!d && d > p.to;
  };
  const meetingPlanned = records.filter((r) => r.status === "面談予定" || after(r.meeting_date));
  return {
    meetingPlanned: meetingPlanned.length,
    visitPlanned: meetingPlanned.filter((r) => after(r.visit_date)).length,
    meetingOnly: meetingPlanned.filter((r) => after(r.meeting_date)).length,
    admissionPlanned: records.filter((r) => r.status === "入院予定" || after(r.admission_date)).length,
  };
}

const fmt = (m: Record<string, number>): string =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}${v}`)
    .join("・");

/* ------------------------------------------------------------------ */
/* 「入退院数情報」シートの取り込み                                     */
/* ------------------------------------------------------------------ */

/**
 * 「入退院数情報」シートは月ごとに [月ラベル, 入院, 退院, 在院患者数, (短期)] の
 * ブロックが横に連なる。ヘッダ行の "R7.5月" 等から各ブロックの開始列を検出する。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseCensusSheet(XLSX: any, workbook: any): DailyCensus[] {
  const name = workbook.SheetNames.find((n: string) => n.replace(/\s/g, "") === "入退院数情報");
  if (!name) return [];
  const rows: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: "" });
  if (!rows.length) return [];

  // 全角英数を半角へ（"Ｒ８．4月" → "R8.4月"）
  const z2h = (s: string) =>
    String(s).replace(/[Ａ-Ｚａ-ｚ０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const num = (v: any): number | null => {
    const n = parseFloat(String(v).replace(/[^\d.-]/g, ""));
    return isNaN(n) ? null : n;
  };

  const out: DailyCensus[] = [];
  (rows[0] || []).forEach((h: any, col: number) => {
    const m = z2h(h).trim().match(/^R(\d+)[.](\d+)月$/i);
    if (!m) return;
    const year = 2018 + Number(m[1]); // 令和N年 = 2018+N
    const month = Number(m[2]);
    const lastDay = new Date(year, month, 0).getDate();
    for (let r = 2; r <= 32; r++) {
      const day = r - 1;
      if (day > lastDay) break;
      const row = rows[r] || [];
      const adm = num(row[col + 1]);
      const dis = num(row[col + 2]);
      const cen = num(row[col + 3]);
      const short = num(row[col + 4]);
      if (adm == null && dis == null && cen == null) continue;
      out.push({
        date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        admissions: adm ?? 0,
        discharges: dis ?? 0,
        census: cen,
        shortStay: short,
      });
    }
  });
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

/* ------------------------------------------------------------------ */
/* ワークブック生成                                                    */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */
export function buildMeetingReportWorkbook(
  XLSX: any,
  records: HospitalRecord[],
  census: DailyCensus[],
  target: { year: number; month: number },
) {
  const fy = fiscalYearOf(target.year, target.month);
  const reiwa = fy - 2018;
  const p = makePeriod(target.year, target.month);
  const asOf = `令和${reiwa + (target.month >= 4 ? 0 : 1)}年${target.month}月20日現在`;
  const cutoff = `${p.from.getMonth() + 1}/${p.from.getDate()}〜${p.to.getMonth() + 1}/${p.to.getDate()}締`;

  // 年度内で「対象月まで」を埋める
  const cols = MONTHS.map((m) => {
    const cy = calendarYear(fy, m);
    const filled = cy < target.year || (cy === target.year && m <= target.month);
    return { month: m, year: cy, filled };
  });
  const header = MONTHS.map((m) => (m >= 4 ? `${m}月` : `R${reiwa + 1}.${m}月`));
  const stats = cols.map((c) => (c.filled ? monthlyStats(records, census, c.year, c.month) : null));

  const row = (label: string, pick: (s: MonthlyStats) => number | null) => [
    label,
    ...stats.map((s) => (s ? pick(s) ?? "" : "")),
  ];

  const aoa: (string | number)[][] = [];
  aoa.push(["地域連携課　経営会議報告資料"]);
  aoa.push([`${asOf.replace("現在", "")}`, "", "", "", "", "", "", "", "", "", "", "", `${new Date().getMonth() + 1}/${new Date().getDate()}作成`]);
  aoa.push([]);

  aoa.push([`【1】入退院数　${asOf}　${cutoff}`]);
  aoa.push(["", ...header]);
  aoa.push(row("長期入院", (s) => s.longTermAdmissions));
  aoa.push(row("（再掲）病院", (s) => s.fromHospital));
  aoa.push(row("（再掲）施設等", (s) => s.fromFacility));
  aoa.push(row("（再掲）在宅", (s) => s.fromHome));
  aoa.push(row("（再掲）不明・未記入", (s) => s.fromUnknown));
  aoa.push(row("（再掲）病棟実績との差", (s) => s.unreconciled));
  aoa.push(row("短期入院", (s) => s.shortStay));
  aoa.push(row("合計", (s) => s.admissionsTotal));
  // 退院理由の内訳は入力データに存在しないため、行だけ用意して空欄にする（手入力用）
  aoa.push(["死亡退院"]);
  aoa.push(["転院（施設含）"]);
  aoa.push(["治療転院"]);
  aoa.push(["在宅"]);
  aoa.push(["短期入院"]);
  aoa.push(row("合計", (s) => s.dischargesTotal));
  aoa.push([]);

  aoa.push([`【2】在院者数　${asOf}　【病床数　306床(個室18床　2床室10室:20床　多床268)】`]);
  aoa.push(["", ...header]);
  aoa.push(row("当月20日時点", (s) => s.censusOn20th));
  aoa.push(row("期間平均", (s) => s.censusAverage));
  aoa.push([]);

  aoa.push([`【3】入院相談件数　（${asOf}）${cutoff}`]);
  aoa.push(["", ...header]);
  aoa.push(row("見学件数", (s) => s.visits));
  aoa.push(row("面談件数", (s) => s.meetings));
  aoa.push(row("合計", (s) => s.visits + s.meetings));
  aoa.push([]);

  const up = upcoming(records, target.year, target.month);
  const nextDay = `${p.to.getMonth() + 1}/${p.to.getDate() + 1}`;
  aoa.push([`【4】今後(${nextDay}以降)の入院相談・入院予定`]);
  aoa.push(["", "面談予定:", up.meetingPlanned, "件", `（見学${up.visitPlanned}　面談${up.meetingOnly}）`]);
  aoa.push(["", "入院予定:", up.admissionPlanned, "件"]);
  aoa.push([]);
  aoa.push([`【5】その他(${nextDay}以降)`]);
  aoa.push(["", "退院予定", ""]);

  const ws1 = XLSX.utils.aoa_to_sheet(aoa);
  ws1["!cols"] = [{ wch: 22 }, ...MONTHS.map(() => ({ wch: 9 }))];

  /* --- 2枚目: 実績報告 --- */
  const pr = performanceReport(records, target.year, target.month);
  const a2: (string | number)[][] = [];
  a2.push([`${p.from.getMonth() + 1}月${p.from.getDate()}日〜${p.to.getMonth() + 1}月${p.to.getDate()}日実績報告`]);
  a2.push([]);
  a2.push(["・紹介件数", pr.referrals, "件", `（${fmt(pr.referralsBySource)}）`]);
  a2.push([]);
  a2.push(["・面談・見学結びつき", pr.engaged, "件", `（面談${pr.engagedMeeting}・見学${pr.engagedVisit}）`]);
  a2.push([]);
  a2.push(["・面談至らず", pr.notEngaged, "件", `（${fmt(pr.notEngagedReasons)}）`]);
  a2.push([]);
  a2.push(["・その他", pr.otherPending, "件", `（${fmt(pr.otherPendingBreakdown)}）`]);
  a2.push([]);
  a2.push([]);
  a2.push(["・入院につながった件数", pr.admitted, "件"]);
  a2.push([]);
  a2.push(["・入院につながらなかった件数", pr.notAdmitted, "件", `（${fmt(pr.notAdmittedReasons)}）`]);
  a2.push([]);
  a2.push(["・その他", pr.otherOutcome, "件", `（${fmt(pr.otherOutcomeBreakdown)}）`]);
  a2.push([]);
  a2.push([]);
  a2.push(["・問合せ件数", pr.inquiryOnly, "件", `（${fmt(pr.inquiryOnlyBySource)}）`]);

  const ws2 = XLSX.utils.aoa_to_sheet(a2);
  ws2["!cols"] = [{ wch: 30 }, { wch: 8 }, { wch: 6 }, { wch: 60 }];

  /* --- 3枚目: 集計の根拠となる明細 --- */
  const detail = records.filter(
    (r) =>
      inPeriod(r.referral_inquiry_date, p) ||
      inPeriod(r.family_inquiry_date, p) ||
      inPeriod(r.visit_date, p) ||
      inPeriod(r.meeting_date, p) ||
      inPeriod(r.admission_date, p),
  );
  const a3 = [
    ["進捗・転帰", "氏名", "紹介元からの問い合せ日", "見学日", "面談日", "入院日", "紹介経路", "情報提供元", "区分", "入院前居所", "再掲区分", "キャンセル理由", "入院不可理由", "特記事項"],
    ...detail.map((r) => [
      r.status, r.name, r.referral_inquiry_date || "", r.visit_date || "", r.meeting_date || "",
      r.admission_date || "", r.referral_route, r.referral_source, sourceBucket(r),
      r.pre_admission_location, locationBucket(r.pre_admission_location), r.cancel_reason, r.not_admitted_reason, r.notes,
    ]),
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(a3);
  ws3["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 18 }, { wch: 24 }, { wch: 8 }, { wch: 18 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 40 }];

  /* --- 4枚目: 集計定義と、入力データで埋まらない項目 --- */
  const a4 = [
    ["集計定義・注意事項"],
    [],
    ["■ 集計期間"],
    ["", `報告月「${target.month}月」＝ ${p.from.getMonth() + 1}/${p.from.getDate()} 〜 ${p.to.getMonth() + 1}/${p.to.getDate()}（前月21日〜当月20日締め）`],
    [],
    ["■ 各項目の算出元"],
    ["項目", "算出元", "定義"],
    ["【1】合計（入院・退院）", "入退院数情報シート", "期間内の日次「入院」「退院」の合計"],
    ["【1】短期入院", "入退院数情報シート", "「（短期）」列のプラス値の合計"],
    ["【1】長期入院", "入退院数情報シート", "合計 − 短期入院"],
    ["【1】（再掲）病院/施設等/在宅", "台帳シート", "期間内に入院日がある案件を「入院前居所」で分類"],
    ["", "", "病院＝急性期病棟・回復期病棟・地域包括病棟・療養病棟・当院からの診療依頼先"],
    ["", "", "施設等＝施設（特記事項へ）／在宅＝自宅"],
    ["【1】（再掲）病棟実績との差", "―", "長期入院 −（再掲の合計）。台帳に載らない入院や記入漏れの差分"],
    ["【2】当月20日時点", "入退院数情報シート", "当月20日の「在院患者数」"],
    ["【2】期間平均", "入退院数情報シート", "期間内の「在院患者数」の平均（小数第1位）"],
    ["【3】見学件数", "台帳シート", "期間内に「見学日」がある案件数"],
    ["【3】面談件数", "台帳シート", "期間内に「面談日」がある案件数"],
    ["【4】面談予定・入院予定", "台帳シート", "進捗・転帰が「面談予定」「入院予定」、または予定日が期間より後の案件"],
    ["実績報告 各項目", "台帳シート", "期間内に問い合わせがあった案件を、進捗・転帰と日付の有無で分類"],
    [],
    ["■ 空欄のままとしている項目（別データのため手入力が必要）"],
    ["", "【1】退院の内訳（死亡退院・転院（施設含）・治療転院・在宅・短期入院）"],
    ["", "　→ 入退院数情報シートには日次の退院「数」のみで、退院理由の区分がありません。"],
    ["", "【5】退院予定"],
    ["", "　→ 病棟側の予定情報が入力データに含まれていません。"],
    [],
    ["■ 従来資料との差異について"],
    ["", "従来の報告資料は手計算で作成されていたため、本シートの自動集計値とは数件の差が生じます。"],
    ["", "本シートは上記の定義に従って入力データから機械的に算出した値です。"],
  ];
  const ws4 = XLSX.utils.aoa_to_sheet(a4);
  ws4["!cols"] = [{ wch: 30 }, { wch: 26 }, { wch: 70 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "経営会議報告");
  XLSX.utils.book_append_sheet(wb, ws2, "実績報告");
  XLSX.utils.book_append_sheet(wb, ws3, "明細");
  XLSX.utils.book_append_sheet(wb, ws4, "集計定義");
  return wb;
}
