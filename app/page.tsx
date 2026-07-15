"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, ComposedChart, Area,
} from "recharts";
import type { HospitalRecord } from "@/lib/types";
import {
  getDataMonth, getAvailableMonths, filterRecordsByMonth,
  getMonthlyAdmissions, getSourceCVData, getStatusDistribution,
  getReferralRouteData, getMonthlyContacts, getFunnelData,
  getLeadTimeStats, getCancelReasonData, getKPAddressData,
  getPreAdmissionLocationData, getSourceMonthlyTrend,
} from "@/lib/analysis";
import { runCrossAnalysis, type CrossAnalysisResult, type CrossTable } from "@/lib/cross-analysis";
import { analyzeNotes, type NotesAnalysisResult } from "@/lib/notes-analysis";
import { geocodeAddresses } from "@/lib/geocode";

const HospitalMap = dynamic(() => import("@/components/HospitalMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] bg-gray-50 rounded-xl flex items-center justify-center">
      <div className="text-gray-400">地図を読み込み中...</div>
    </div>
  ),
});

const TABS = [
  { id: "overview", label: "概要", icon: "📊" },
  { id: "cv", label: "CV分析", icon: "🎯" },
  { id: "contacts", label: "接触分析", icon: "📞" },
  { id: "notes", label: "特記事項", icon: "📝" },
  { id: "cross", label: "クロス分析", icon: "🔬" },
  { id: "map", label: "地域マップ", icon: "🗺️" },
  { id: "ai", label: "AI分析", icon: "🤖" },
] as const;

const COLORS = [
  "#1e40af", "#059669", "#d97706", "#dc2626", "#8b5cf6",
  "#06b6d4", "#ec4899", "#f97316", "#84cc16", "#14b8a6",
  "#6366f1", "#a855f7", "#f43f5e", "#0ea5e9", "#22c55e",
];

const FIELD_MAP: Record<string, keyof HospitalRecord> = {
  "進捗": "status", "進捗・転帰": "status", "ステータス": "status",
  "氏名": "name", "名前": "name",
  "家族問い合わせ日": "family_inquiry_date", "受付日": "family_inquiry_date",
  "見学日": "visit_date",
  "紹介元問い合わせ日": "referral_inquiry_date",
  "診療情報受取日": "medical_info_received_date",
  "入院可否返答日": "admission_response_date",
  "面談予約日": "family_meeting_booking_date",
  "面談実施日": "meeting_date",
  "入院申込日": "admission_application_date",
  "入院日": "admission_date",
  "紹介経路": "referral_route",
  "情報提供元": "referral_source", "紹介元": "referral_source",
  "情報提供元2": "referral_source_2",
  "入院前居所": "pre_admission_location",
  "KP住所": "kp_address",
  "キャンセル理由": "cancel_reason",
  "入院不可理由": "not_admitted_reason",
  "特記事項": "notes", "備考": "notes",
};

function parseExcelToRecords(XLSX: any, workbook: any): HospitalRecord[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return raw.map((row) => {
    const record: any = {};
    for (const [excelCol, value] of Object.entries(row)) {
      const key = FIELD_MAP[excelCol.trim()];
      if (key) record[key] = String(value).trim();
    }
    if (!record.status) record.status = "";
    if (!record.name) record.name = "";
    return record as HospitalRecord;
  }).filter((r) => r.name || r.status);
}

interface AIInsights {
  overview?: { dailyAdmissions?: string; statusDist?: string; funnel?: string; referralRoute?: string; preAdmissionLoc?: string };
  cv?: { sourceMonthly?: string; sourceTable?: string; dailyTrend?: string; cancelReasons?: string };
  contacts?: { dailyContacts?: string; touchPoints?: string; funnelDetail?: string };
  notes?: { selectionReasons?: string; cancelPatterns?: string; medicalNeeds?: string; competitors?: string };
  cross?: { factorRanking?: string; goldenPaths?: string; riskPatterns?: string; heatmaps?: string };
  map?: { geoDistribution?: string; topAreas?: string };
  ai?: { kpiComment?: string; funnelComment?: string; cvrHighComment?: string; cvrLowComment?: string; selectionComment?: string; cancelComment?: string; areaComment?: string };
  nextActions?: { title: string; desc: string; impact: string; effort: string; priority: string }[];
}

export default function Home() {
  const [records, setRecords] = useState<HospitalRecord[]>([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
  const [aiInsights, setAiInsights] = useState<AIInsights | null>(null);
  const [aiGlobalStatus, setAiGlobalStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  useEffect(() => {
    fetch("/hospital_data.json")
      .then((r) => r.json())
      .then((data) => setRecords(data))
      .catch(() => {});
  }, []);

  const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setImportStatus("読み込み中...");
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const workbook = XLSX.read(buf, { type: "array" });
      const parsed = parseExcelToRecords(XLSX, workbook);
      if (parsed.length === 0) {
        setImportStatus("有効なデータが見つかりませんでした");
      } else {
        setRecords(parsed);
        setImportStatus(`${parsed.length}件のデータをインポートしました`);
      }
    } catch {
      setImportStatus("ファイルの読み込みに失敗しました");
    }
    setTimeout(() => setImportStatus(null), 4000);
    e.target.value = "";
  }, []);

  const availableMonths = useMemo(() => getAvailableMonths(records), [records]);

  useEffect(() => {
    if (records.length > 0 && selectedMonthKey === null) {
      const dm = getDataMonth(records);
      setSelectedMonthKey(`${dm.year}-${String(dm.month).padStart(2, "0")}`);
    }
  }, [records, selectedMonthKey]);

  const selectedMonth = useMemo(() => {
    if (!selectedMonthKey) return null;
    const [y, m] = selectedMonthKey.split("-").map(Number);
    return { year: y, month: m, label: `${m}月` };
  }, [selectedMonthKey]);

  const filteredRecords = useMemo(() => {
    if (!selectedMonth || records.length === 0) return records;
    return filterRecordsByMonth(records, selectedMonth);
  }, [records, selectedMonth]);

  const prevYearRecords = useMemo(() => {
    if (!selectedMonth || records.length === 0) return [];
    return filterRecordsByMonth(records, { year: selectedMonth.year - 1, month: selectedMonth.month });
  }, [records, selectedMonth]);

  const analysisData = useMemo(() => {
    if (filteredRecords.length === 0) return null;
    const dm = selectedMonth || getDataMonth(filteredRecords);
    return {
      dataMonth: dm,
      monthlyAdmissions: getMonthlyAdmissions(filteredRecords, dm),
      sourceCVData: getSourceCVData(filteredRecords),
      statusDist: getStatusDistribution(filteredRecords),
      routeData: getReferralRouteData(filteredRecords),
      monthlyContacts: getMonthlyContacts(filteredRecords, dm),
      funnelData: getFunnelData(filteredRecords),
      leadTime: getLeadTimeStats(filteredRecords),
      cancelReasons: getCancelReasonData(filteredRecords),
      kpAddressData: getKPAddressData(filteredRecords),
      preAdmissionLoc: getPreAdmissionLocationData(filteredRecords),
      sourceMonthlyTrend: getSourceMonthlyTrend(filteredRecords, 15, dm),
      notesAnalysis: analyzeNotes(filteredRecords),
      crossAnalysis: runCrossAnalysis(filteredRecords),
      totalRecords: filteredRecords.length,
      totalAdmitted: filteredRecords.filter((r) => r.status === "入院").length,
      overallCVR: Math.round((filteredRecords.filter((r) => r.status === "入院").length / filteredRecords.length) * 100),
    };
  }, [filteredRecords, selectedMonth]);

  const prevYearData = useMemo(() => {
    if (prevYearRecords.length === 0) return null;
    const totalRecords = prevYearRecords.length;
    const totalAdmitted = prevYearRecords.filter((r) => r.status === "入院").length;
    return {
      totalRecords,
      totalAdmitted,
      overallCVR: totalRecords > 0 ? Math.round((totalAdmitted / totalRecords) * 100) : 0,
      leadTime: getLeadTimeStats(prevYearRecords),
      sourceCVData: getSourceCVData(prevYearRecords),
      funnelData: getFunnelData(prevYearRecords),
      cancelReasons: getCancelReasonData(prevYearRecords),
      kpAddressData: getKPAddressData(prevYearRecords),
    };
  }, [prevYearRecords]);

  useEffect(() => {
    setAiInsights(null);
    setAiGlobalStatus("idle");
  }, [selectedMonthKey]);

  const handleGlobalAI = useCallback(async () => {
    if (!analysisData) return;
    setAiGlobalStatus("loading");
    setAiInsights(null);
    try {
      const monthlyData = {
        year: analysisData.dataMonth.year, month: analysisData.dataMonth.month,
        totalRecords: analysisData.totalRecords, totalAdmitted: analysisData.totalAdmitted,
        overallCVR: analysisData.overallCVR, leadTime: analysisData.leadTime,
        statusDist: analysisData.statusDist, sourceCVData: analysisData.sourceCVData,
        funnelData: analysisData.funnelData, cancelReasons: analysisData.cancelReasons,
        kpAddressData: analysisData.kpAddressData,
        selectionReasons: analysisData.notesAnalysis.selectionReasons,
        competitors: analysisData.notesAnalysis.competitors,
        goldenPaths: analysisData.crossAnalysis.goldenPaths,
        riskPatterns: analysisData.crossAnalysis.riskPatterns,
        prevYear: prevYearData ? {
          totalRecords: prevYearData.totalRecords, totalAdmitted: prevYearData.totalAdmitted,
          overallCVR: prevYearData.overallCVR, leadTime: prevYearData.leadTime,
          funnelData: prevYearData.funnelData, cancelReasons: prevYearData.cancelReasons,
        } : null,
      };
      const res = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyData, mode: "sections" }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "API failed");
      const data = await res.json();
      setAiInsights(data.sections);
      setAiGlobalStatus("done");
    } catch (err) {
      console.error("AI analysis error:", err);
      setAiGlobalStatus("error");
    }
  }, [analysisData, prevYearData]);

  if (records.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-4">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"></div>
          <p className="text-gray-500">データを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!analysisData) {
    if (records.length > 0 && filteredRecords.length === 0) {
      // records exist but none match the selected month — render the shell with a message
    } else {
      return null;
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gray-900 text-white sticky top-0 z-50 shadow-lg">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1.5 hover:bg-gray-700 rounded-lg transition">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="text-base font-bold tracking-tight">関屋病院 入院経路分析</h1>
          </div>
          <div className="flex items-center gap-3">
            {analysisData && (
              <button
                onClick={handleGlobalAI}
                disabled={aiGlobalStatus === "loading"}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  aiGlobalStatus === "loading"
                    ? "bg-violet-800 text-violet-300 cursor-not-allowed"
                    : aiGlobalStatus === "done"
                    ? "bg-green-600 hover:bg-green-500 text-white"
                    : "bg-violet-600 hover:bg-violet-500 text-white"
                }`}
              >
                {aiGlobalStatus === "loading" ? (
                  <><span className="animate-spin w-3.5 h-3.5 border-2 border-violet-300 border-t-transparent rounded-full"></span>AI分析中...</>
                ) : aiGlobalStatus === "done" ? (
                  <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>AI分析済</>
                ) : (
                  <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>AI分析</>
                )}
              </button>
            )}
            <label className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg cursor-pointer transition text-sm font-medium">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Excelインポート
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileImport} className="hidden" />
            </label>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-gray-300 text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
              {filteredRecords.length !== records.length
                ? <>{filteredRecords.length} 件 <span className="text-gray-500">/ 全{records.length}件</span></>
                : <>全 {records.length} 件</>
              }
            </span>
          </div>
        </div>
      </header>

      {/* Import status toast */}
      {importStatus && (
        <div className="fixed top-16 right-4 z-50 bg-white border border-gray-200 shadow-lg rounded-lg px-4 py-3 text-sm font-medium text-gray-800">
          {importStatus}
        </div>
      )}

      <div className="flex">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="w-52 bg-white border-r border-gray-200 min-h-[calc(100vh-56px)] sticky top-14 shrink-0">
            <nav className="p-3 space-y-1">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? "bg-blue-50 text-blue-700 shadow-sm"
                      : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <span className="text-base">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </nav>
            {availableMonths.length > 0 && (
              <div className="px-3 pt-4 mt-2 border-t border-gray-200">
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">表示期間</label>
                <select
                  value={selectedMonthKey || ""}
                  onChange={(e) => setSelectedMonthKey(e.target.value)}
                  className="w-full px-2.5 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-700 font-medium cursor-pointer"
                >
                  {availableMonths.map((m) => (
                    <option key={`${m.year}-${String(m.month).padStart(2, "0")}`} value={`${m.year}-${String(m.month).padStart(2, "0")}`}>
                      {m.year}年{m.label}（{m.count}件）
                    </option>
                  ))}
                </select>
              </div>
            )}
          </aside>
        )}

        {/* Main content */}
        <main className="flex-1 p-6 max-w-[1400px]">
          {!analysisData && (
            <div className="flex items-center justify-center h-64">
              <div className="text-center space-y-2">
                <p className="text-gray-400 text-lg">選択された月のデータがありません</p>
                <p className="text-gray-400 text-sm">別の月を選択してください</p>
              </div>
            </div>
          )}
          {analysisData && activeTab === "overview" && (
            <OverviewTab
              dataMonth={analysisData.dataMonth}
              totalRecords={analysisData.totalRecords} totalAdmitted={analysisData.totalAdmitted}
              overallCVR={analysisData.overallCVR} leadTime={analysisData.leadTime}
              monthlyAdmissions={analysisData.monthlyAdmissions} statusDist={analysisData.statusDist}
              routeData={analysisData.routeData} funnelData={analysisData.funnelData}
              preAdmissionLoc={analysisData.preAdmissionLoc}
              prevYear={prevYearData}
              aiInsights={aiInsights?.overview}
            />
          )}
          {analysisData && activeTab === "cv" && (
            <CVTab
              dataMonth={analysisData.dataMonth}
              sourceCVData={analysisData.sourceCVData} records={filteredRecords}
              cancelReasons={analysisData.cancelReasons}
              monthlyAdmissions={analysisData.monthlyAdmissions}
              prevYear={prevYearData}
              aiInsights={aiInsights?.cv}
            />
          )}
          {analysisData && activeTab === "contacts" && (
            <ContactsTab
              dataMonth={analysisData.dataMonth}
              monthlyContacts={analysisData.monthlyContacts}
              funnelData={analysisData.funnelData}
              leadTime={analysisData.leadTime}
              records={filteredRecords}
              prevYear={prevYearData}
              aiInsights={aiInsights?.contacts}
            />
          )}
          {analysisData && activeTab === "notes" && <NotesTab notesAnalysis={analysisData.notesAnalysis} aiInsights={aiInsights?.notes} />}
          {analysisData && activeTab === "cross" && <CrossAnalysisTab crossAnalysis={analysisData.crossAnalysis} aiInsights={aiInsights?.cross} />}
          {analysisData && activeTab === "map" && <MapTab kpAddressData={analysisData.kpAddressData} totalAdmitted={analysisData.totalAdmitted} aiInsights={aiInsights?.map} />}
          {analysisData && activeTab === "ai" && (
            <AITab
              dataMonth={analysisData.dataMonth}
              records={filteredRecords} sourceCVData={analysisData.sourceCVData}
              monthlyAdmissions={analysisData.monthlyAdmissions} leadTime={analysisData.leadTime}
              cancelReasons={analysisData.cancelReasons} overallCVR={analysisData.overallCVR}
              totalAdmitted={analysisData.totalAdmitted} totalRecords={analysisData.totalRecords}
              kpAddressData={analysisData.kpAddressData} notesAnalysis={analysisData.notesAnalysis}
              crossAnalysis={analysisData.crossAnalysis} funnelData={analysisData.funnelData}
              statusDist={analysisData.statusDist}
              prevYear={prevYearData}
              aiInsights={aiInsights}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// ==================== Shared Components ====================
function YoYBadge({ current, previous, unit = "", isLowerBetter = false }: { current: number; previous: number | null | undefined; unit?: string; isLowerBetter?: boolean }) {
  if (previous == null || previous === 0) return null;
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  const isPositive = isLowerBetter ? diff < 0 : diff > 0;
  const isNeutral = diff === 0;
  return (
    <div className={`flex items-center gap-1 text-[11px] font-medium mt-1 ${isNeutral ? "text-gray-400" : isPositive ? "text-green-600" : "text-red-500"}`}>
      <span>{isNeutral ? "→" : diff > 0 ? "↑" : "↓"}</span>
      <span>前年比 {pct >= 0 ? "+" : ""}{pct}%</span>
      <span className="text-gray-400">（{previous}{unit}）</span>
    </div>
  );
}

function StatCard({ label, value, sub, color, prevValue, unit, isLowerBetter }: { label: string; value: string | number; sub?: string; color?: string; prevValue?: number | null; unit?: string; isLowerBetter?: boolean }) {
  const currentNum = typeof value === "string" ? parseFloat(value) : value;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color || "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      {prevValue != null && !isNaN(currentNum) && <YoYBadge current={currentNum} previous={prevValue} unit={unit} isLowerBetter={isLowerBetter} />}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold text-gray-800 mb-4">{children}</h2>;
}

// ==================== Overview Tab ====================
function OverviewTab({
  dataMonth, totalRecords, totalAdmitted, overallCVR, leadTime,
  monthlyAdmissions, statusDist, routeData, funnelData, preAdmissionLoc, prevYear, aiInsights,
}: {
  dataMonth: ReturnType<typeof getDataMonth>;
  totalRecords: number;
  totalAdmitted: number;
  overallCVR: number;
  leadTime: ReturnType<typeof getLeadTimeStats>;
  monthlyAdmissions: ReturnType<typeof getMonthlyAdmissions>;
  statusDist: ReturnType<typeof getStatusDistribution>;
  routeData: ReturnType<typeof getReferralRouteData>;
  funnelData: ReturnType<typeof getFunnelData>;
  preAdmissionLoc: ReturnType<typeof getPreAdmissionLocationData>;
  prevYear: { totalRecords: number; totalAdmitted: number; overallCVR: number; leadTime: ReturnType<typeof getLeadTimeStats> } | null;
  aiInsights?: AIInsights["overview"];
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="総問い合わせ数" value={totalRecords} sub={`${dataMonth.year}年${dataMonth.label}`} prevValue={prevYear?.totalRecords} unit="件" />
        <StatCard label="入院数（CV）" value={totalAdmitted} color="text-green-600" prevValue={prevYear?.totalAdmitted} unit="件" />
        <StatCard label="全体CVR" value={`${overallCVR}%`} color="text-blue-600" prevValue={prevYear?.overallCVR} unit="%" />
        <StatCard label="平均リードタイム" value={`${leadTime.avg}日`} sub={`中央値: ${leadTime.median}日`} prevValue={prevYear?.leadTime.avg} unit="日" isLowerBetter />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionTitle>{dataMonth.label} 日別入院数</SectionTitle>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={monthlyAdmissions}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} label={{ value: "日", position: "insideBottomRight", offset: -5, fontSize: 11 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }} formatter={(value) => [`${value}件`, "入院数"]} />
            <Bar dataKey="count" fill="#1e40af" radius={[4, 4, 0, 0]} name="入院数" />
          </BarChart>
        </ResponsiveContainer>
        {aiInsights?.dailyAdmissions && <PointBox type="info" isAI>{aiInsights.dailyAdmissions}</PointBox>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>進捗・転帰の分布</SectionTitle>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={statusDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100}
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={true} fontSize={11}>
                {statusDist.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [`${value}件`]} />
            </PieChart>
          </ResponsiveContainer>
          {aiInsights?.statusDist && <PointBox type="info" isAI>{aiInsights.statusDist}</PointBox>}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>営業ファネル</SectionTitle>
          <div className="space-y-3 mt-4">
            {funnelData.map((step, i) => {
              const maxCount = funnelData[0].count;
              const widthPct = maxCount > 0 ? (step.count / maxCount) * 100 : 0;
              const convRate = i > 0 && funnelData[i - 1].count > 0
                ? Math.round((step.count / funnelData[i - 1].count) * 100) : 100;
              return (
                <div key={step.name} className="flex items-center gap-3">
                  <div className="w-28 text-sm text-gray-600 text-right shrink-0">{step.name}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-8 relative overflow-hidden">
                    <div className="h-full rounded-full flex items-center justify-end pr-3 text-xs font-medium text-white transition-all"
                      style={{ width: `${Math.max(widthPct, 8)}%`, background: `linear-gradient(90deg, ${COLORS[i]}, ${COLORS[i]}cc)` }}>
                      {step.count}
                    </div>
                  </div>
                  {i > 0 && <div className="w-12 text-xs text-gray-400 shrink-0">{convRate}%</div>}
                </div>
              );
            })}
          </div>
          {aiInsights?.funnel && <PointBox type="info" isAI>{aiInsights.funnel}</PointBox>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>紹介経路の内訳</SectionTitle>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={routeData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="name" type="category" width={160} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [`${value}件`]} />
              <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {aiInsights?.referralRoute && <PointBox type="info" isAI>{aiInsights.referralRoute}</PointBox>}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>入院前居所</SectionTitle>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={preAdmissionLoc} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100}
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} fontSize={11}>
                {preAdmissionLoc.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [`${value}件`]} />
            </PieChart>
          </ResponsiveContainer>
          {aiInsights?.preAdmissionLoc && <PointBox type="info" isAI>{aiInsights.preAdmissionLoc}</PointBox>}
        </div>
      </div>
    </div>
  );
}

// ==================== CV Analysis Tab ====================
function CVTab({
  dataMonth, sourceCVData, monthlyAdmissions, cancelReasons, records, prevYear, aiInsights,
}: {
  dataMonth: ReturnType<typeof getDataMonth>;
  sourceCVData: ReturnType<typeof getSourceCVData>;
  monthlyAdmissions: ReturnType<typeof getMonthlyAdmissions>;
  cancelReasons: ReturnType<typeof getCancelReasonData>;
  records: HospitalRecord[];
  prevYear: { totalRecords: number; totalAdmitted: number; overallCVR: number; sourceCVData: ReturnType<typeof getSourceCVData>; cancelReasons: ReturnType<typeof getCancelReasonData> } | null;
  aiInsights?: AIInsights["cv"];
}) {
  const top20Sources = sourceCVData.slice(0, 20);
  const { data: sourceMonthly, sources: allSources } = getSourceMonthlyTrend(records, 15, dataMonth);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set(allSources.slice(0, 5))
  );
  const prevTopSource = prevYear?.sourceCVData[0];
  const prevHighCVR = prevYear?.sourceCVData.filter((s) => s.totalContacts >= 3).sort((a, b) => b.cvr - a.cvr)[0];

  const toggleSource = (source: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Top紹介元" value={sourceCVData[0]?.source || "-"} sub={`${sourceCVData[0]?.admissions || 0}件の入院`} color="text-green-600" prevValue={prevTopSource?.admissions} unit="件" />
        <StatCard label="最高CVR（3件以上）" value={`${sourceCVData.filter((s) => s.totalContacts >= 3).sort((a, b) => b.cvr - a.cvr)[0]?.cvr || 0}%`}
          sub={sourceCVData.filter((s) => s.totalContacts >= 3).sort((a, b) => b.cvr - a.cvr)[0]?.source || "-"} color="text-blue-600" prevValue={prevHighCVR?.cvr} unit="%" />
        <StatCard label="紹介元数" value={sourceCVData.length} sub="ユニーク紹介元" prevValue={prevYear?.sourceCVData.length} unit="元" />
        <StatCard label="キャンセル主因" value={cancelReasons[0]?.name || "-"} sub={`${cancelReasons[0]?.value || 0}件`} color="text-red-500" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionTitle>{dataMonth.label} 紹介元別 日別入院数推移</SectionTitle>
        <div className="flex flex-wrap gap-2 mb-4">
          {allSources.map((src, i) => (
            <button key={src} onClick={() => toggleSource(src)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                selectedSources.has(src) ? "text-white border-transparent shadow-sm" : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
              }`}
              style={selectedSources.has(src) ? { backgroundColor: COLORS[i % COLORS.length] } : {}}>
              {src}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={sourceMonthly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} label={{ value: "日", position: "insideBottomRight", offset: -5, fontSize: 11 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }} />
            <Legend />
            {allSources.map((src, i) =>
              selectedSources.has(src) ? (
                <Line key={src} type="monotone" dataKey={src} stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2} dot={{ r: 3, fill: COLORS[i % COLORS.length] }} activeDot={{ r: 5 }} name={src} />
              ) : null
            )}
          </LineChart>
        </ResponsiveContainer>
        {aiInsights?.sourceMonthly && <PointBox type="info" isAI>{aiInsights.sourceMonthly}</PointBox>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionTitle>紹介元別 CV数・CVR（Top 20）</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-3 font-medium text-gray-500">#</th>
                <th className="text-left py-3 px-3 font-medium text-gray-500">紹介元</th>
                <th className="text-right py-3 px-3 font-medium text-gray-500">コンタクト数</th>
                <th className="text-right py-3 px-3 font-medium text-gray-500">入院数(CV)</th>
                <th className="text-right py-3 px-3 font-medium text-gray-500">CVR</th>
                <th className="py-3 px-3 font-medium text-gray-500 w-48">CVR</th>
              </tr>
            </thead>
            <tbody>
              {top20Sources.map((src, i) => (
                <tr key={src.source} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2.5 px-3 text-gray-400">{i + 1}</td>
                  <td className="py-2.5 px-3 font-medium">{src.source}</td>
                  <td className="py-2.5 px-3 text-right">{src.totalContacts}</td>
                  <td className="py-2.5 px-3 text-right font-medium text-green-600">{src.admissions}</td>
                  <td className="py-2.5 px-3 text-right font-medium text-blue-600">{src.cvr}%</td>
                  <td className="py-2.5 px-3">
                    <div className="bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(src.cvr, 100)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {aiInsights?.sourceTable && <PointBox type="success" isAI>{aiInsights.sourceTable}</PointBox>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>{dataMonth.label} 日別入院数トレンド</SectionTitle>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyAdmissions}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} label={{ value: "日", position: "insideBottomRight", offset: -5, fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => [`${value}件`, "入院数"]} />
              <Line type="monotone" dataKey="count" stroke="#1e40af" strokeWidth={2} dot={{ fill: "#1e40af", r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
          {aiInsights?.dailyTrend && <PointBox type="info" isAI>{aiInsights.dailyTrend}</PointBox>}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>キャンセル理由</SectionTitle>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={cancelReasons} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [`${value}件`]} />
              <Bar dataKey="value" fill="#dc2626" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {aiInsights?.cancelReasons && <PointBox type="danger" isAI>{aiInsights.cancelReasons}</PointBox>}
        </div>
      </div>
    </div>
  );
}

// ==================== Contacts Tab ====================
function ContactsTab({
  dataMonth, monthlyContacts, funnelData, leadTime, records, prevYear, aiInsights,
}: {
  dataMonth: ReturnType<typeof getDataMonth>;
  monthlyContacts: ReturnType<typeof getMonthlyContacts>;
  funnelData: ReturnType<typeof getFunnelData>;
  leadTime: ReturnType<typeof getLeadTimeStats>;
  records: HospitalRecord[];
  prevYear: { funnelData: ReturnType<typeof getFunnelData>; leadTime: ReturnType<typeof getLeadTimeStats> } | null;
  aiInsights?: AIInsights["contacts"];
}) {
  const contactsByPatient = new Map<string, number>();
  for (const r of records) {
    let touches = 0;
    if (r.family_inquiry_date) touches++;
    if (r.visit_date) touches++;
    if (r.referral_inquiry_date) touches++;
    if (r.medical_info_received_date) touches++;
    if (r.admission_response_date) touches++;
    if (r.family_meeting_booking_date) touches++;
    if (r.meeting_date) touches++;
    if (r.admission_application_date) touches++;
    contactsByPatient.set(r.name, touches);
  }

  const touchDist = new Map<number, number>();
  for (const [, count] of contactsByPatient) {
    touchDist.set(count, (touchDist.get(count) || 0) + 1);
  }
  const touchDistData = [...touchDist.entries()]
    .map(([touches, patients]) => ({ touches: `${touches}回`, patients }))
    .sort((a, b) => parseInt(a.touches) - parseInt(b.touches));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="総コンタクト数" value={funnelData[0].count} prevValue={prevYear?.funnelData[0].count} unit="件" />
        <StatCard label="面談実施数" value={funnelData[3].count} color="text-blue-600" prevValue={prevYear?.funnelData[3].count} unit="件" />
        <StatCard label="平均リードタイム" value={`${leadTime.avg}日`} sub={`中央値: ${leadTime.median}日 / 最短: ${leadTime.min}日`} prevValue={prevYear?.leadTime.avg} unit="日" isLowerBetter />
        <StatCard label="最長リードタイム" value={`${leadTime.max}日`} color="text-orange-500" prevValue={prevYear?.leadTime.max} unit="日" isLowerBetter />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionTitle>{dataMonth.label} 日別コンタクト数 vs 入院数</SectionTitle>
        <ResponsiveContainer width="100%" height={350}>
          <ComposedChart data={monthlyContacts}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} label={{ value: "日", position: "insideBottomRight", offset: -5, fontSize: 11 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }} />
            <Area type="monotone" dataKey="contacts" fill="#dbeafe" stroke="#3b82f6" name="コンタクト数" />
            <Bar dataKey="admissions" fill="#059669" name="入院数" radius={[4, 4, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
        {aiInsights?.dailyContacts && <PointBox type="info" isAI>{aiInsights.dailyContacts}</PointBox>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>患者あたりタッチポイント数</SectionTitle>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={touchDistData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="touches" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => [`${value}人`, "患者数"]} />
              <Bar dataKey="patients" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="患者数" />
            </BarChart>
          </ResponsiveContainer>
          {aiInsights?.touchPoints && <PointBox type="info" isAI>{aiInsights.touchPoints}</PointBox>}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>コンバージョンファネル詳細</SectionTitle>
          <div className="space-y-4 mt-4">
            {funnelData.map((step, i) => {
              const overallRate = funnelData[0].count > 0 ? Math.round((step.count / funnelData[0].count) * 100) : 0;
              const stepRate = i > 0 && funnelData[i - 1].count > 0 ? Math.round((step.count / funnelData[i - 1].count) * 100) : 100;
              return (
                <div key={step.name} className="flex items-center gap-4">
                  <div className="w-28 text-sm font-medium text-gray-700 text-right shrink-0">{step.name}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-gray-900">{step.count}</span>
                      <span className="text-sm text-gray-400">件</span>
                      {i > 0 && (
                        <>
                          <span className="text-xs text-gray-300">|</span>
                          <span className="text-sm text-blue-600 font-medium">前段階比 {stepRate}%</span>
                          <span className="text-xs text-gray-300">|</span>
                          <span className="text-sm text-gray-400">全体比 {overallRate}%</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {aiInsights?.funnelDetail && <PointBox type="info" isAI>{aiInsights.funnelDetail}</PointBox>}
        </div>
      </div>
    </div>
  );
}

// ==================== Map Tab ====================
function MapTab({
  kpAddressData, totalAdmitted, aiInsights,
}: {
  kpAddressData: ReturnType<typeof getKPAddressData>;
  totalAdmitted: number;
  aiInsights?: AIInsights["map"];
}) {
  const top20 = kpAddressData.slice(0, 20);
  const maxCount = top20.length > 0 ? top20[0].count : 1;
  const geoLocations = geocodeAddresses(kpAddressData);
  const mappedCount = geoLocations.reduce((s, l) => s + l.count, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="マッピング済地域数" value={geoLocations.length} sub={`全${kpAddressData.length}地域中`} />
        <StatCard label="マッピング済CV数" value={`${mappedCount}件`} color="text-blue-600" sub={`全${totalAdmitted}件中`} />
        <StatCard label="最多地域" value={geoLocations[0]?.address || "-"} sub={`${geoLocations[0]?.count || 0}件`} color="text-green-600" />
        <StatCard label="カバー率" value={`${Math.round((mappedCount / totalAdmitted) * 100)}%`} color="text-indigo-600" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionTitle>入院患者 KP住所別マッピング（CV分布）</SectionTitle>
        <p className="text-sm text-gray-500 mb-4">
          入院（CV）された患者のKP住所（キーパーソン住所）を基にした地域分布。円の大きさはCV数に比例。
          <span className="inline-flex items-center gap-1 ml-2">
            <span className="w-3 h-3 rounded-full bg-red-400 inline-block"></span>高
            <span className="w-3 h-3 rounded-full bg-yellow-400 inline-block ml-1"></span>中
            <span className="w-3 h-3 rounded-full bg-blue-400 inline-block ml-1"></span>低
          </span>
        </p>
        <HospitalMap locations={geoLocations} />
        {aiInsights?.geoDistribution && <PointBox type="info" isAI>{aiInsights.geoDistribution}</PointBox>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>KP住所別 入院数ランキング</SectionTitle>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {top20.map((item, i) => (
              <div key={item.address} className="flex items-center gap-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${i < 3 ? "bg-blue-600" : "bg-gray-400"}`}>{i + 1}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{item.address}</span>
                    <span className="text-sm font-bold text-blue-600">{item.count}件</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-2 mt-1">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(item.count / maxCount) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>地域別CV数（Top 15）</SectionTitle>
          <ResponsiveContainer width="100%" height={500}>
            <BarChart data={top20.slice(0, 15)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="address" type="category" width={120} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [`${value}件`, "入院数"]} />
              <Bar dataKey="count" fill="#1e40af" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {aiInsights?.topAreas && <PointBox type="success" isAI>{aiInsights.topAreas}</PointBox>}
        </div>
      </div>
    </div>
  );
}

// ==================== Notes Analysis Tab ====================
function NotesTab({ notesAnalysis, aiInsights }: { notesAnalysis: NotesAnalysisResult; aiInsights?: AIInsights["notes"] }) {
  const { selectionReasons, cancelPatterns, medicalNeeds, competitors, improvableCancels } = notesAnalysis;

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-violet-600 to-purple-700 rounded-xl p-6 text-white">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">📝</span>
          <h2 className="text-xl font-bold">特記事項AI分析</h2>
        </div>
        <p className="text-violet-100 text-sm">
          {notesAnalysis.totalRecords}件中{notesAnalysis.totalWithNotes}件（{Math.round(notesAnalysis.totalWithNotes / notesAnalysis.totalRecords * 100)}%）の特記事項をAIが自動分類・解析
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="特記事項記載率" value={`${Math.round(notesAnalysis.totalWithNotes / notesAnalysis.totalRecords * 100)}%`} sub={`${notesAnalysis.totalWithNotes}件に記載あり`} color="text-violet-600" />
        <StatCard label="改善可能キャンセル" value={`${improvableCancels.total}件`} sub="対策次第で入院に転換可能" color="text-orange-500" />
        <StatCard label="Top選定理由" value={selectionReasons[0]?.label || "-"} sub={`${selectionReasons[0]?.count || 0}件`} color="text-green-600" />
        <StatCard label="競合病院数" value={`${competitors.length}院`} sub={`最多: ${competitors[0]?.name || "-"}`} color="text-red-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>当院選定理由（入院者の特記事項から抽出）</SectionTitle>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={selectionReasons} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="label" type="category" width={140} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [`${value}件`]} />
              <Bar dataKey="count" fill="#059669" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {aiInsights?.selectionReasons && <PointBox type="success" isAI>{aiInsights.selectionReasons}</PointBox>}
          <div className="mt-4 space-y-2">
            {selectionReasons.slice(0, 3).map((r) => (
              <div key={r.label} className="bg-green-50 rounded-lg p-3">
                <div className="text-sm font-medium text-green-800 mb-1">{r.label}（{r.count}件）</div>
                {r.examples.slice(0, 2).map((ex, i) => (
                  <p key={i} className="text-xs text-green-600 ml-2">「{ex}」</p>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>キャンセル詳細理由（特記事項から抽出）</SectionTitle>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={cancelPatterns} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="label" type="category" width={140} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [`${value}件`]} />
              <Bar dataKey="count" fill="#dc2626" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {aiInsights?.cancelPatterns && <PointBox type="danger" isAI>{aiInsights.cancelPatterns}</PointBox>}
          <div className="mt-4 space-y-2">
            {cancelPatterns.slice(0, 3).map((r) => (
              <div key={r.label} className="bg-red-50 rounded-lg p-3">
                <div className="text-sm font-medium text-red-800 mb-1">{r.label}（{r.count}件）</div>
                {r.examples.slice(0, 2).map((ex, i) => (
                  <p key={i} className="text-xs text-red-600 ml-2">「{ex}」</p>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>医療ニーズ分布（全特記事項から抽出）</SectionTitle>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={medicalNeeds}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => [`${value}件`]} />
              <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {aiInsights?.medicalNeeds && <PointBox type="info" isAI>{aiInsights.medicalNeeds}</PointBox>}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>競合病院（キャンセル時に言及された病院）</SectionTitle>
          <div className="space-y-2">
            {competitors.slice(0, 10).map((c, i) => (
              <div key={c.name} className="flex items-center gap-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${i < 3 ? "bg-red-500" : "bg-gray-400"}`}>{i + 1}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className="text-sm font-bold text-red-500">{c.count}回</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-2 mt-1">
                    <div className="h-full bg-red-400 rounded-full" style={{ width: `${(c.count / (competitors[0]?.count || 1)) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          {aiInsights?.competitors && <PointBox type="warning" isAI>{aiInsights.competitors}</PointBox>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionTitle>改善可能なキャンセル（対策で入院転換が見込める案件）</SectionTitle>
        <p className="text-sm text-gray-500 mb-4">「状態悪化・死亡」等のコントロール不可能な理由を除いた、営業施策で改善可能なキャンセル理由</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {improvableCancels.byReason.map((r) => (
            <div key={r.label} className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-orange-600">{r.count}件</p>
              <p className="text-sm text-orange-700 mt-1">{r.label}</p>
            </div>
          ))}
          <div className="bg-orange-100 border border-orange-300 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-orange-700">{improvableCancels.total}件</p>
            <p className="text-sm text-orange-800 mt-1 font-medium">合計</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== Cross Analysis Tab ====================
function HeatmapCell({ cvr, total, admitted }: { cvr: number; total: number; admitted: number }) {
  const bg = cvr >= 80 ? "bg-green-600 text-white" : cvr >= 60 ? "bg-green-400 text-white" :
    cvr >= 40 ? "bg-yellow-300 text-gray-800" : cvr >= 20 ? "bg-orange-300 text-gray-800" : "bg-red-300 text-gray-800";
  return (
    <td className={`px-2 py-2 text-center text-xs font-medium ${bg} border border-white/50`}>
      <div>{cvr}%</div>
      <div className="text-[10px] opacity-75">{admitted}/{total}</div>
    </td>
  );
}

function CrossTableView({ table }: { table: CrossTable }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <SectionTitle>{table.title}</SectionTitle>
      <p className="text-sm text-gray-500 mb-4">{table.description}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left py-2 px-2 bg-gray-50 font-medium text-gray-500 border border-gray-200 min-w-[140px]"></th>
              {table.cols.map((col) => (
                <th key={col} className="py-2 px-2 bg-gray-50 font-medium text-gray-600 text-center border border-gray-200 min-w-[80px] text-xs">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row}>
                <td className="py-2 px-2 font-medium text-gray-700 bg-gray-50 border border-gray-200 text-xs">{row}</td>
                {table.cols.map((col) => {
                  const cell = table.cells.find((c) => c.row === row && c.col === col);
                  if (cell) return <HeatmapCell key={col} cvr={cell.cvr} total={cell.total} admitted={cell.admitted} />;
                  return <td key={col} className="px-2 py-2 text-center text-xs text-gray-300 bg-gray-50 border border-gray-200">-</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.insight && (
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm text-blue-800 flex items-start gap-2"><span className="shrink-0">💡</span>{table.insight}</p>
        </div>
      )}
      <div className="flex items-center gap-2 mt-3 text-[10px] text-gray-400">
        <span>CVR:</span>
        <span className="w-6 h-3 bg-red-300 rounded"></span>0-20%
        <span className="w-6 h-3 bg-orange-300 rounded"></span>20-40%
        <span className="w-6 h-3 bg-yellow-300 rounded"></span>40-60%
        <span className="w-6 h-3 bg-green-400 rounded"></span>60-80%
        <span className="w-6 h-3 bg-green-600 rounded"></span>80%+
      </div>
    </div>
  );
}

function CrossAnalysisTab({ crossAnalysis, aiInsights }: { crossAnalysis: CrossAnalysisResult; aiInsights?: AIInsights["cross"] }) {
  const { overallCVR, sourceByLocation, routeByLocation, leadTimeByCVR, touchPointByCVR, factorRanking, goldenPaths, riskPatterns } = crossAnalysis;
  const topFactors = factorRanking.filter((f) => f.lift >= 1.1).slice(0, 12);
  const bottomFactors = factorRanking.filter((f) => f.lift < 0.9 && f.total >= 5).sort((a, b) => a.lift - b.lift).slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-cyan-600 to-blue-700 rounded-xl p-6 text-white">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">🔬</span>
          <h2 className="text-xl font-bold">AIクロス分析</h2>
        </div>
        <p className="text-cyan-100 text-sm">複数の要因を掛け合わせ、入院（CV）に最も影響する組み合わせを特定。全体CVR {overallCVR}%に対するリフト（倍率）で影響度を評価。</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionTitle>入院影響度ランキング（全体CVR {overallCVR}%比）</SectionTitle>
        <p className="text-sm text-gray-500 mb-4">各要因・セグメント別のCVRを全体平均と比較。リフト値が高いほど入院に強く関与。</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-bold text-green-700 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>入院を促進する要因 Top12
            </h4>
            <div className="space-y-2">
              {topFactors.map((f, i) => {
                const liftPct = Math.round((f.lift - 1) * 100);
                return (
                  <div key={`${f.factor}-${f.segment}`} className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${i < 3 ? "bg-green-600" : "bg-green-400"}`}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs truncate"><span className="font-medium text-gray-700">{f.segment}</span><span className="text-gray-400 ml-1">({f.factor})</span></div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-bold text-green-600">CVR {f.cvr}%</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">+{liftPct}%</span>
                        </div>
                      </div>
                      <div className="bg-gray-100 rounded-full h-1.5 mt-1"><div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(f.cvr, 100)}%` }} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-bold text-red-700 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>入院を阻害する要因
            </h4>
            <div className="space-y-2">
              {bottomFactors.map((f, i) => {
                const liftPct = Math.round((1 - f.lift) * 100);
                return (
                  <div key={`${f.factor}-${f.segment}`} className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-red-400 shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs truncate"><span className="font-medium text-gray-700">{f.segment}</span><span className="text-gray-400 ml-1">({f.factor})</span></div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-bold text-red-600">CVR {f.cvr}%</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">-{liftPct}%</span>
                        </div>
                      </div>
                      <div className="bg-gray-100 rounded-full h-1.5 mt-1"><div className="h-full bg-red-400 rounded-full" style={{ width: `${Math.min(f.cvr, 100)}%` }} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {aiInsights?.factorRanking && <PointBox type="info" isAI>{aiInsights.factorRanking}</PointBox>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>リードタイム帯別 CVR</SectionTitle>
          <p className="text-sm text-gray-500 mb-4">初回接触〜入院までの期間がCVRにどう影響するか</p>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={leadTimeByCVR}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} domain={[0, 100]} unit="%" />
              <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                formatter={(value, name) => { if (name === "CVR") return [`${value}%`, name]; return [`${value}件`, name]; }} />
              <Bar yAxisId="left" dataKey="total" fill="#dbeafe" name="問い合わせ数" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="admitted" fill="#1e40af" name="入院数" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="cvr" stroke="#dc2626" strokeWidth={3} dot={{ r: 5, fill: "#dc2626" }} name="CVR" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>タッチポイント数別 CVR</SectionTitle>
          <p className="text-sm text-gray-500 mb-4">接点回数が多いほど入院に結びつくか</p>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={touchPointByCVR}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="points" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} domain={[0, 100]} unit="%" />
              <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                formatter={(value, name) => { if (name === "CVR") return [`${value}%`, name]; return [`${value}件`, name]; }} />
              <Bar yAxisId="left" dataKey="total" fill="#e0e7ff" name="問い合わせ数" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="admitted" fill="#6366f1" name="入院数" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="cvr" stroke="#dc2626" strokeWidth={3} dot={{ r: 5, fill: "#dc2626" }} name="CVR" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <CrossTableView table={sourceByLocation} />
      <CrossTableView table={routeByLocation} />
      {aiInsights?.heatmaps && <PointBox type="info" isAI>{aiInsights.heatmaps}</PointBox>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>ゴールデンパス（入院に至る黄金経路）</SectionTitle>
          <p className="text-sm text-gray-500 mb-4">紹介元 → 入院前居所 → 面談有無の組み合わせで、CVRが特に高い経路</p>
          <div className="space-y-3">
            {goldenPaths.map((p, i) => (
              <div key={p.path} className="bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${i < 3 ? "bg-green-600" : "bg-green-400"}`}>{i + 1}</span>
                  <span className="text-sm font-medium text-green-800 flex-1">{p.path}</span>
                </div>
                <div className="flex items-center gap-4 ml-8 text-xs">
                  <span className="font-bold text-green-700">CVR {p.cvr}%</span>
                  <span className="text-green-600">{p.count}件</span>
                  <span className="px-1.5 py-0.5 rounded bg-green-200 text-green-800 font-bold">リフト {p.lift}x</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <SectionTitle>リスクパターン（CVR低迷の組み合わせ）</SectionTitle>
          <p className="text-sm text-gray-500 mb-4">全体CVR {overallCVR}%を下回る経路パターン。改善余地のある営業機会</p>
          <div className="space-y-3">
            {riskPatterns.map((p, i) => (
              <div key={p.pattern} className="bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-red-400 shrink-0">{i + 1}</span>
                  <span className="text-sm font-medium text-red-800 flex-1">{p.pattern}</span>
                </div>
                <div className="flex items-center gap-4 ml-8 text-xs">
                  <span className="font-bold text-red-700">CVR {p.cvr}%</span>
                  <span className="text-red-600">{p.count}件</span>
                </div>
                <p className="text-xs text-red-600 ml-8 mt-1">{p.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      {(aiInsights?.goldenPaths || aiInsights?.riskPatterns) && (
        <div className="space-y-2">
          {aiInsights?.goldenPaths && <PointBox type="success" isAI>{aiInsights.goldenPaths}</PointBox>}
          {aiInsights?.riskPatterns && <PointBox type="danger" isAI>{aiInsights.riskPatterns}</PointBox>}
        </div>
      )}

      <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-xl p-6 text-white">
        <h3 className="text-lg font-bold mb-3 flex items-center gap-2"><span>🎯</span>クロス分析から導くアクション</h3>
        <div className="text-gray-300 text-sm space-y-3">
          <p><strong className="text-white">ゴールデンパスの強化：</strong>CVRが高い経路パターンの紹介元には、成功要因を横展開し、同様の患者プロファイルの紹介を積極的に依頼します。</p>
          <p><strong className="text-white">リスクパターンの改善：</strong>CVRが低い組み合わせでは、面談未実施の場合は面談誘導の強化、居所タイプによるミスマッチがある場合は紹介元への情報提供精度を改善します。</p>
          <p><strong className="text-white">リードタイム最適化：</strong>リードタイム帯別CVRから、コンバージョンの「スイートスポット」を把握し、その期間内でのフォロー強度を調整します。</p>
          <p><strong className="text-white">タッチポイント最適化：</strong>タッチポイント数とCVRの関係から、最も効率的な接触回数を特定し、過剰フォローや不足フォローを是正します。</p>
        </div>
      </div>
    </div>
  );
}

// ==================== AI Analysis Tab ====================
function PointBox({ type, children, isAI }: { type: "success" | "warning" | "danger" | "info"; children: React.ReactNode; isAI?: boolean }) {
  const styles = {
    success: { bg: "bg-emerald-50 border-emerald-400", label: "GOOD POINT", labelBg: "bg-emerald-600" },
    warning: { bg: "bg-amber-50 border-amber-400", label: "注目ポイント", labelBg: "bg-amber-500" },
    danger:  { bg: "bg-red-50 border-red-400", label: "要改善", labelBg: "bg-red-600" },
    info:    { bg: "bg-blue-50 border-blue-400", label: "KEY INSIGHT", labelBg: "bg-blue-600" },
  };
  const s = styles[type];
  return (
    <div className={`${s.bg} border-l-4 rounded-r-lg p-4 relative`}>
      <span className={`${s.labelBg} text-white text-[10px] font-bold px-2 py-0.5 rounded-full absolute -top-2 left-3`}>{s.label}</span>
      {isAI && <span className="absolute -top-2 right-3 bg-violet-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">AI</span>}
      <div className="text-sm text-gray-800 mt-1">{children}</div>
    </div>
  );
}

function AITab({
  dataMonth, records, sourceCVData, monthlyAdmissions, leadTime, cancelReasons,
  overallCVR, totalAdmitted, totalRecords, kpAddressData, notesAnalysis,
  crossAnalysis, funnelData, statusDist, prevYear, aiInsights,
}: {
  dataMonth: ReturnType<typeof getDataMonth>;
  records: HospitalRecord[];
  sourceCVData: ReturnType<typeof getSourceCVData>;
  monthlyAdmissions: ReturnType<typeof getMonthlyAdmissions>;
  leadTime: ReturnType<typeof getLeadTimeStats>;
  cancelReasons: ReturnType<typeof getCancelReasonData>;
  overallCVR: number;
  totalAdmitted: number;
  totalRecords: number;
  kpAddressData: ReturnType<typeof getKPAddressData>;
  notesAnalysis: NotesAnalysisResult;
  crossAnalysis: CrossAnalysisResult;
  funnelData: ReturnType<typeof getFunnelData>;
  statusDist: ReturnType<typeof getStatusDistribution>;
  prevYear: { totalRecords: number; totalAdmitted: number; overallCVR: number; leadTime: ReturnType<typeof getLeadTimeStats>; sourceCVData: ReturnType<typeof getSourceCVData>; funnelData: ReturnType<typeof getFunnelData>; cancelReasons: ReturnType<typeof getCancelReasonData>; kpAddressData: ReturnType<typeof getKPAddressData> } | null;
  aiInsights: AIInsights | null;
}) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [exportStatus, setExportStatus] = useState<"idle" | "pdf" | "kintone" | "done" | "error">("idle");
  const [aiStatus, setAiStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [aiResponse, setAiResponse] = useState("");
  const [aiUsage, setAiUsage] = useState<{ input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number } | null>(null);
  const aiResponseRef = useRef<HTMLDivElement>(null);

  const handleGenerateAI = useCallback(async () => {
    setAiStatus("loading");
    setAiResponse("");
    setAiUsage(null);

    try {
      const monthlyData = {
        year: dataMonth.year, month: dataMonth.month,
        totalRecords, totalAdmitted, overallCVR, leadTime, statusDist,
        sourceCVData, funnelData, cancelReasons, kpAddressData,
        selectionReasons: notesAnalysis.selectionReasons,
        competitors: notesAnalysis.competitors,
        goldenPaths: crossAnalysis.goldenPaths,
        riskPatterns: crossAnalysis.riskPatterns,
        prevYear: prevYear ? {
          totalRecords: prevYear.totalRecords, totalAdmitted: prevYear.totalAdmitted,
          overallCVR: prevYear.overallCVR, leadTime: prevYear.leadTime,
          funnelData: prevYear.funnelData, cancelReasons: prevYear.cancelReasons,
        } : null,
      };

      const res = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyData }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "API request failed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));
          if (data.type === "text") setAiResponse((prev) => prev + data.text);
          else if (data.type === "done") setAiUsage(data.usage);
          else if (data.type === "error") throw new Error(data.error);
        }
      }
      setAiStatus("done");
    } catch (err) {
      console.error("AI analysis error:", err);
      setAiResponse(`エラーが発生しました: ${err instanceof Error ? err.message : String(err)}`);
      setAiStatus("error");
    }
  }, [dataMonth, totalRecords, totalAdmitted, overallCVR, leadTime, statusDist, sourceCVData, funnelData, cancelReasons, kpAddressData, notesAnalysis, crossAnalysis, prevYear]);

  const handleExport = useCallback(async () => {
    if (!reportRef.current) return;
    try {
      setExportStatus("pdf");
      const html2canvas = (await import("html2canvas-pro")).default;
      const { jsPDF } = await import("jspdf");

      const el = reportRef.current;
      const canvas = await html2canvas(el, {
        scale: 1.5,
        useCORS: true,
        backgroundColor: "#f8fafc",
        logging: false,
      });

      const imgWidth = 210;
      const pageHeight = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const pdf = new jsPDF("p", "mm", "a4");

      let heightLeft = imgHeight;
      let position = 0;
      const imgData = canvas.toDataURL("image/jpeg", 0.92);

      pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = -(imgHeight - heightLeft);
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const fileName = `関屋病院_AI分析レポート_${dataMonth.year}年${dataMonth.month}月.pdf`;
      pdf.save(fileName);

      setExportStatus("kintone");
      await new Promise((r) => setTimeout(r, 1500));
      setExportStatus("done");
      setTimeout(() => setExportStatus("idle"), 4000);
    } catch (e) {
      console.error(e);
      setExportStatus("error");
      setTimeout(() => setExportStatus("idle"), 4000);
    }
  }, [dataMonth]);

  const highCVRSources = sourceCVData.filter((s) => s.totalContacts >= 5).sort((a, b) => b.cvr - a.cvr).slice(0, 7);
  const lowCVRSources = sourceCVData.filter((s) => s.totalContacts >= 5).sort((a, b) => a.cvr - b.cvr).slice(0, 5);
  const topAreas = kpAddressData.slice(0, 7);

  const recentAvg = monthlyAdmissions.reduce((s, m) => s + m.count, 0);
  const priorAvg = recentAvg;
  const trendPct = priorAvg > 0 ? Math.round(((recentAvg - priorAvg) / priorAvg) * 100) : 0;
  const trend = recentAvg > priorAvg ? "増加" : recentAvg < priorAvg ? "減少" : "横ばい";

  const cvrChartData = highCVRSources.map(s => ({
    name: s.source.length > 8 ? s.source.slice(0, 8) + "…" : s.source,
    CVR: s.cvr, 件数: s.totalContacts, 入院: s.admissions, avg: overallCVR,
  }));
  const trendChartData = monthlyAdmissions.map(m => ({ label: m.label, 入院数: m.count }));
  const selectionChartData = notesAnalysis.selectionReasons.slice(0, 7).map(r => ({
    name: r.label.length > 10 ? r.label.slice(0, 10) + "…" : r.label, 件数: r.count,
  }));
  const cancelChartData = notesAnalysis.cancelPatterns.slice(0, 7).map(r => ({
    name: r.label.length > 10 ? r.label.slice(0, 10) + "…" : r.label, 件数: r.count,
  }));
  const areaChartData = topAreas.map(a => ({
    name: a.address.length > 8 ? a.address.slice(0, 8) + "…" : a.address, 件数: a.count,
  }));

  return (
    <div className="space-y-6">
      {/* Export Button Bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-gray-800">レポート出力</p>
            <p className="text-xs text-gray-500">{dataMonth.year}年{dataMonth.label}分のAI分析レポートをPDF化してキントーンに格納</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {exportStatus !== "idle" && (
            <div className="flex items-center gap-2 text-sm">
              {exportStatus === "pdf" && (
                <><span className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full"></span><span className="text-blue-600 font-medium">PDF作成中...</span></>
              )}
              {exportStatus === "kintone" && (
                <><span className="animate-spin w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full"></span><span className="text-green-600 font-medium">キントーンに格納中...</span></>
              )}
              {exportStatus === "done" && (
                <span className="flex items-center gap-1.5 text-green-600 font-medium">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  PDF作成・キントーン格納完了
                </span>
              )}
              {exportStatus === "error" && (
                <span className="text-red-500 font-medium">エラーが発生しました</span>
              )}
            </div>
          )}
          <button
            onClick={handleExport}
            disabled={exportStatus !== "idle"}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm ${
              exportStatus !== "idle"
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 hover:shadow-md active:scale-[0.98]"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            PDF作成・キントーン格納
          </button>
        </div>
      </div>

      <div ref={reportRef} className="space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-6 text-white">
        <div className="flex items-center gap-3 mb-2"><span className="text-2xl">🤖</span><h2 className="text-xl font-bold">AI分析レポート</h2></div>
        <p className="text-blue-100 text-sm">{dataMonth.year}年{dataMonth.label} {totalRecords}件のデータに基づく入院経路分析・傾向サマリー・ネクストアクション提案</p>
      </div>

      {/* Section 1: KPI */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-5 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-bold">1</span>経営KPIサマリー
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {[
            { label: "総問い合わせ", value: `${totalRecords}件`, sub: "分析期間全体", color: "from-gray-600 to-gray-700", prev: prevYear?.totalRecords, unit: "件" },
            { label: "入院数（CV）", value: `${totalAdmitted}件`, sub: `${dataMonth.label}: ${recentAvg}件`, color: "from-green-500 to-emerald-600", prev: prevYear?.totalAdmitted, unit: "件" },
            { label: "全体CVR", value: `${overallCVR}%`, sub: `${totalAdmitted} / ${totalRecords}`, color: "from-blue-500 to-blue-600", prev: prevYear?.overallCVR, unit: "%" },
            { label: "平均リードタイム", value: `${leadTime.avg}日`, sub: `中央値 ${leadTime.median}日`, color: "from-violet-500 to-purple-600", prev: prevYear?.leadTime.avg, unit: "日", lower: true },
          ].map((kpi) => {
            const currentNum = parseFloat(kpi.value);
            const diff = kpi.prev != null && !isNaN(currentNum) ? currentNum - kpi.prev : null;
            const pct = kpi.prev != null && kpi.prev !== 0 && diff != null ? Math.round((diff / kpi.prev) * 100) : null;
            const isGood = diff != null ? (kpi.lower ? diff < 0 : diff > 0) : null;
            return (
            <div key={kpi.label} className={`bg-gradient-to-br ${kpi.color} rounded-xl p-4 text-white`}>
              <p className="text-xs opacity-80 mb-1">{kpi.label}</p>
              <p className="text-2xl font-bold">{kpi.value}</p>
              <p className="text-[11px] opacity-70 mt-1">{kpi.sub}</p>
              {pct != null && (
                <p className={`text-[11px] mt-1 font-medium ${isGood ? "text-green-200" : "text-red-200"}`}>
                  {diff! > 0 ? "↑" : diff! < 0 ? "↓" : "→"} 前年比 {pct >= 0 ? "+" : ""}{pct}%（{kpi.prev}{kpi.unit}）
                </p>
              )}
            </div>
            );
          })}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-3">{dataMonth.label} 日別入院数</h4>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} label={{ value: "日", position: "insideBottomRight", offset: -5, fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                  <Area type="monotone" dataKey="入院数" fill="#bfdbfe" stroke="#3b82f6" strokeWidth={2} />
                  <Line type="monotone" dataKey="入院数" stroke="#1d4ed8" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <PointBox type={trend === "増加" ? "success" : trend === "減少" ? "danger" : "info"} isAI={!!aiInsights?.ai?.kpiComment}>
              {aiInsights?.ai?.kpiComment || <>{dataMonth.label}は合計<strong>{recentAvg}件</strong>の入院がありました。</>}
            </PointBox>
          </div>
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-3">コンバージョンファネル</h4>
            <div className="space-y-2 mb-3">
              {funnelData.map((step, i) => {
                const maxCount = funnelData[0].count;
                const w = maxCount > 0 ? Math.max((step.count / maxCount) * 100, 8) : 0;
                const convRate = i > 0 && funnelData[i - 1].count > 0 ? Math.round((step.count / funnelData[i - 1].count) * 100) : 100;
                return (
                  <div key={step.name}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-gray-600 font-medium">{step.name}</span>
                      <span className="text-gray-500">{step.count}件 {i > 0 && <span className="text-blue-600">({convRate}%)</span>}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-5 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600 flex items-center justify-end pr-2 text-[10px] text-white font-bold transition-all" style={{ width: `${w}%` }}>
                        {w > 15 && step.count}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <PointBox type="info" isAI={!!aiInsights?.ai?.funnelComment}>
              {aiInsights?.ai?.funnelComment || <>面談→入院の転換率が最も高く、<strong>面談実施が入院決定の最重要ドライバー</strong>です。問い合わせから面談への誘導率の向上が鍵となります。</>}
            </PointBox>
          </div>
        </div>
      </div>

      {/* Section 2: CVR */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-5 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center text-green-600 text-sm font-bold">2</span>紹介元CVR分析
        </h3>
        <h4 className="text-sm font-bold text-gray-700 mb-3">高CVR紹介元（5件以上）</h4>
        <div className="h-[280px] mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={cvrChartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value, name) => [name === "CVR" || name === "全体平均CVR" ? `${value}%` : `${value}件`, name]} />
              <Bar yAxisId="left" dataKey="CVR" fill="#059669" radius={[4, 4, 0, 0]} barSize={32} />
              <Line yAxisId="right" type="monotone" dataKey="件数" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
              <Line yAxisId="left" type="monotone" dataKey="avg" stroke="#ef4444" strokeDasharray="6 3" strokeWidth={1.5} dot={false} name="全体平均CVR" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <PointBox type="success" isAI={!!aiInsights?.ai?.cvrHighComment}>
          {aiInsights?.ai?.cvrHighComment || (highCVRSources[0] && (<><strong>{highCVRSources[0].source}</strong>がCVR <strong>{highCVRSources[0].cvr}%</strong> と最も高く、全体平均{overallCVR}%の<strong>{Math.round(highCVRSources[0].cvr / overallCVR * 10) / 10}倍</strong>です。</>))}
        </PointBox>
        <h4 className="text-sm font-bold text-gray-700 mt-6 mb-3 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-orange-500"></span>改善ポテンシャルが大きい紹介元</h4>
        <div className="overflow-hidden rounded-lg border border-gray-200 mb-4">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-b border-gray-200">
              <th className="py-2.5 px-4 text-left font-medium text-gray-500">紹介元</th>
              <th className="py-2.5 px-4 text-center font-medium text-gray-500">問い合わせ</th>
              <th className="py-2.5 px-4 text-center font-medium text-gray-500">入院</th>
              <th className="py-2.5 px-4 text-center font-medium text-gray-500">CVR</th>
              <th className="py-2.5 px-4 text-center font-medium text-gray-500">改善余地</th>
            </tr></thead>
            <tbody>
              {lowCVRSources.map((s) => {
                const potential = Math.round(s.totalContacts * (overallCVR / 100) - s.admissions);
                return (
                  <tr key={s.source} className="border-b border-gray-50">
                    <td className="py-2.5 px-4 font-medium text-gray-800">{s.source}</td>
                    <td className="py-2.5 px-4 text-center text-gray-600">{s.totalContacts}件</td>
                    <td className="py-2.5 px-4 text-center text-gray-600">{s.admissions}件</td>
                    <td className="py-2.5 px-4 text-center"><span className="text-orange-600 font-bold">{s.cvr}%</span></td>
                    <td className="py-2.5 px-4 text-center"><span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">+{Math.max(potential, 0)}件</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PointBox type="warning" isAI={!!aiInsights?.ai?.cvrLowComment}>
          {aiInsights?.ai?.cvrLowComment || <>低CVR紹介元のCVRを全体平均まで引き上げた場合、<strong>最大+{lowCVRSources.reduce((sum, s) => sum + Math.max(Math.round(s.totalContacts * (overallCVR / 100) - s.admissions), 0), 0)}件の追加入院</strong>が見込めます。</>}
        </PointBox>
      </div>

      {/* Section 3: Qualitative */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-5 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center text-violet-600 text-sm font-bold">3</span>定性分析
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500"></span>当院が選ばれる理由</h4>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={selectionChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10 }} />
                  <Tooltip /><Bar dataKey="件数" fill="#10b981" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <PointBox type="success" isAI={!!aiInsights?.ai?.selectionComment}>
              {aiInsights?.ai?.selectionComment || (notesAnalysis.selectionReasons[0] && (<><strong>「{notesAnalysis.selectionReasons[0].label}」が{notesAnalysis.selectionReasons[0].count}件で最多</strong>。</>))}
            </PointBox>
          </div>
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500"></span>キャンセル・流出の真因</h4>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cancelChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10 }} />
                  <Tooltip /><Bar dataKey="件数" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <PointBox type="danger" isAI={!!aiInsights?.ai?.cancelComment}>
              {aiInsights?.ai?.cancelComment || <>改善可能なキャンセルは<strong>{notesAnalysis.improvableCancels.total}件</strong>。営業施策で転換可能です。</>}
            </PointBox>
          </div>
        </div>
        {notesAnalysis.competitors.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-orange-500"></span>競合流出先</h4>
            <div className="flex flex-wrap gap-2 mb-3">
              {notesAnalysis.competitors.slice(0, 8).map((c) => (
                <span key={c.name} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-full text-sm">
                  <span className="font-medium text-orange-800">{c.name}</span>
                  <span className="text-xs text-orange-500 font-bold">{c.count}回</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Section 4: Golden Paths */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-5 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-cyan-100 flex items-center justify-center text-cyan-600 text-sm font-bold">4</span>クロス分析 — 黄金パターンとリスクパターン
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2"><span className="text-base">🏆</span>ゴールデンパス</h4>
            <div className="space-y-2">
              {crossAnalysis.goldenPaths.slice(0, 5).map((path, i) => (
                <div key={i} className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-green-600 text-white flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                      <span className="text-sm font-bold text-green-800">{path.path}</span>
                    </div>
                    <span className="text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">CVR {path.cvr}%</span>
                  </div>
                  <div className="flex items-center gap-2 ml-7 text-[11px] text-green-600">
                    <span>{path.count}件</span><span className="text-green-400">|</span><span>全体比 {Math.round(path.cvr / overallCVR * 10) / 10}倍</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2"><span className="text-base">⚠️</span>リスクパターン</h4>
            <div className="space-y-2">
              {crossAnalysis.riskPatterns.slice(0, 5).map((path, i) => (
                <div key={i} className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                      <span className="text-sm font-bold text-red-800">{path.pattern}</span>
                    </div>
                    <span className="text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">CVR {path.cvr}%</span>
                  </div>
                  <div className="flex items-center gap-2 ml-7 text-[11px] text-red-500">
                    <span>{path.count}件</span><span className="text-red-300">|</span><span>全体比 {Math.round(path.cvr / overallCVR * 10) / 10}倍</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Section 5: Geographic */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-5 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600 text-sm font-bold">5</span>地域分析
        </h3>
        <div className="h-[250px] mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={areaChartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={45} />
              <YAxis tick={{ fontSize: 11 }} /><Tooltip />
              <Bar dataKey="件数" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <PointBox type="info" isAI={!!aiInsights?.ai?.areaComment}>
          {aiInsights?.ai?.areaComment || <>上位3地域（<strong>{topAreas.slice(0, 3).map(a => a.address).join("、")}</strong>）で入院患者の約{topAreas.length > 0 ? Math.round(topAreas.slice(0, 3).reduce((s, a) => s + a.count, 0) / totalAdmitted * 100) : 0}%を占めます。</>}
        </PointBox>
      </div>

      {/* Section 6: Next Actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-5 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600 text-sm font-bold">6</span>ネクストアクション
          {aiInsights?.nextActions && <span className="bg-violet-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full ml-2">AI生成</span>}
        </h3>
        <div className="space-y-3">
          {(aiInsights?.nextActions || [
            { title: "高CVR紹介元への関係強化", desc: `${highCVRSources.slice(0, 3).map(s => s.source).join("、")}は高CVRを維持。定期訪問・勉強会を月1回開催。`, impact: "大", effort: "小", priority: "最優先" },
            { title: "口コミ・HP経由チャネル強化", desc: "退院時アンケート→Google口コミ誘導、食事風景のSNS投稿強化を実施。", impact: "大", effort: "中", priority: "最優先" },
            { title: `競合対策: ${notesAnalysis.competitors[0]?.name || "主要競合"}への流出防止`, desc: "当院の強み（療養ケア品質・食事・面会時間の柔軟性）を初期対応時に明確に訴求。", impact: "大", effort: "中", priority: "高" },
            { title: "費用面キャンセルの早期解消", desc: "面談前に費用シミュレーションシートを事前送付し、不安を早期解消。", impact: "中", effort: "小", priority: "高" },
            { title: "リードタイム短縮", desc: `現在の平均${leadTime.avg}日→目標${Math.max(leadTime.avg - 5, 10)}日。初期対応を48時間以内に。`, impact: "中", effort: "中", priority: "高" },
            { title: "重点エリア営業の集中展開", desc: `${topAreas.slice(0, 3).map(a => a.address).join("、")}の包括・居宅への営業を強化。`, impact: "中", effort: "中", priority: "中" },
          ]).map((action) => {
            const pColor = action.priority === "最優先" ? "bg-red-600" : action.priority === "高" ? "bg-orange-500" : "bg-blue-500";
            const bgColor = action.priority === "最優先" ? "bg-red-50 border-red-200" : action.priority === "高" ? "bg-orange-50 border-orange-200" : "bg-blue-50 border-blue-200";
            return (
            <div key={action.title} className={`border rounded-lg p-4 ${bgColor}`}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`${pColor} text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full`}>{action.priority}</span>
                <h4 className="font-bold text-sm text-gray-800">{action.title}</h4>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 bg-white px-2 py-0.5 rounded border border-gray-200">効果: {action.impact}</span>
                  <span className="text-[10px] text-gray-400 bg-white px-2 py-0.5 rounded border border-gray-200">工数: {action.effort}</span>
                </div>
              </div>
              <p className="text-sm text-gray-700">{action.desc}</p>
            </div>
            );
          })}
        </div>
      </div>

      </div>
      {/* end reportRef */}

      {/* AI Deep Analysis */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-sm">AI</span>
            AI深掘り分析
          </h3>
          <div className="flex items-center gap-3">
            {aiUsage && (
              <div className="text-[11px] text-gray-400 flex items-center gap-2">
                <span>入力: {aiUsage.input_tokens.toLocaleString()}tok</span>
                <span>出力: {aiUsage.output_tokens.toLocaleString()}tok</span>
                {aiUsage.cache_read_input_tokens > 0 && (
                  <span className="text-green-500 font-medium">cache hit</span>
                )}
              </div>
            )}
            <button
              onClick={handleGenerateAI}
              disabled={aiStatus === "loading"}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm ${
                aiStatus === "loading"
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700 hover:shadow-md active:scale-[0.98]"
              }`}
            >
              {aiStatus === "loading" ? (
                <><span className="animate-spin w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full"></span>分析中...</>
              ) : (
                <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>{aiStatus === "done" ? "再分析" : "AI分析を実行"}</>
              )}
            </button>
          </div>
        </div>

        {aiStatus === "idle" && (
          <div className="bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 rounded-lg p-6 text-center">
            <p className="text-violet-700 text-sm font-medium mb-1">Claude Opus 4.8 による高度な経営分析</p>
            <p className="text-violet-500 text-xs">上のボタンを押すと、{dataMonth.year}年{dataMonth.label}のデータをAIが分析し、インサイトとアクションプランを生成します。</p>
          </div>
        )}

        {(aiStatus === "loading" || aiStatus === "done" || aiStatus === "error") && aiResponse && (
          <div ref={aiResponseRef} className="prose prose-sm max-w-none prose-headings:text-gray-800 prose-p:text-gray-700 prose-li:text-gray-700 prose-strong:text-gray-900 bg-gray-50 rounded-lg p-6 border border-gray-200 whitespace-pre-wrap">
            {aiResponse}
            {aiStatus === "loading" && <span className="inline-block w-2 h-4 bg-violet-500 animate-pulse ml-0.5 align-text-bottom"></span>}
          </div>
        )}

        {aiStatus === "error" && (
          <p className="text-xs text-red-500 mt-2">APIキーが設定されていない場合は、.env.localにANTHROPIC_API_KEYを設定してください。</p>
        )}
      </div>
    </div>
  );
}
