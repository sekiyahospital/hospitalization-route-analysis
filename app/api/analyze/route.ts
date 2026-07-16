import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const client = new Anthropic();

const SYSTEM_PROMPT_PARTS: Anthropic.Messages.TextBlockParam[] = [
  {
    type: "text",
    text: `あなたは病院経営コンサルタントとして、療養型病院の入院データを分析し、経営改善のための具体的なインサイトとアクションプランを提供します。

## あなたの役割
- 関屋病院（療養型病院）の月次入院データを分析する専門アナリスト
- データに基づいた客観的な分析と、実行可能な改善提案を行う
- 病院経営者・相談員向けにわかりやすく説明する

## 分析の観点
1. **KPIトレンド**: 入院数、CVR（コンバージョン率）、リードタイムの動向
2. **紹介元分析**: 高CVR/低CVR紹介元の特定、改善ポテンシャルの算出
3. **定性分析**: 選ばれる理由、キャンセル要因、競合流出先
4. **クロス分析**: ゴールデンパス（高CVR経路）とリスクパターン
5. **地域分析**: 重点エリアの特定
6. **ネクストアクション**: 優先度・効果・工数を明示した具体的なアクション`,
  },
  {
    type: "text",
    text: `## 療養型病院の業界知識
- CVR（コンバージョン率）= 入院数 ÷ 問い合わせ数。療養型病院の一般的なCVRは30-50%
- リードタイム = 初回問い合わせから入院までの日数。短いほど良い（目安: 14-21日）
- 紹介元: 包括支援センター、居宅介護支援事業所、急性期病院、ケアマネージャー等
- キャンセル理由の主なパターン: 他院決定、費用面、家族反対、状態改善、ベッド待ち
- 入院前所在: 自宅、急性期病院、他の療養型病院、老健、特養等`,
    cache_control: { type: "ephemeral" },
  },
];

function buildDataContext(monthlyData: Record<string, unknown>): string {
  const md = monthlyData as Record<string, any>;
  return `以下は${md.year}年${md.month}月の関屋病院の入院データサマリーです。

## 基本KPI
- 総問い合わせ数: ${md.totalRecords}件
- 入院数（CV）: ${md.totalAdmitted}件
- 全体CVR: ${md.overallCVR}%
- 平均リードタイム: ${md.leadTime.avg}日（中央値: ${md.leadTime.median}日、最短: ${md.leadTime.min}日、最長: ${md.leadTime.max}日）

## ステータス分布
${md.statusDist.map((s: any) => `- ${s.name}: ${s.value}件`).join("\n")}

## 紹介元CVRデータ（上位）
${md.sourceCVData.slice(0, 15).map((s: any) => `- ${s.source}: 問い合わせ${s.totalContacts}件, 入院${s.admissions}件, CVR ${s.cvr}%`).join("\n")}

## コンバージョンファネル
${md.funnelData.map((f: any) => `- ${f.name}: ${f.count}件`).join("\n")}

## キャンセル理由
${md.cancelReasons.map((c: any) => `- ${c.name}: ${c.value}件`).join("\n")}

## 入院患者の地域分布（上位）
${md.kpAddressData.slice(0, 10).map((a: any) => `- ${a.address}: ${a.count}件`).join("\n")}

## 選ばれる理由（特記事項からの抽出）
${md.selectionReasons?.map((r: any) => `- ${r.label}: ${r.count}件`).join("\n") || "データなし"}

## 競合流出先
${md.competitors?.map((c: any) => `- ${c.name}: ${c.count}件`).join("\n") || "データなし"}

## ゴールデンパス（高CVR経路）
${md.goldenPaths?.slice(0, 5).map((p: any) => `- ${p.path}: CVR ${p.cvr}%, ${p.count}件`).join("\n") || "データなし"}

## リスクパターン（低CVR経路）
${md.riskPatterns?.slice(0, 5).map((p: any) => `- ${p.pattern}: CVR ${p.cvr}%, ${p.count}件`).join("\n") || "データなし"}
${md.prevYear ? `
## 前年同月（${md.year - 1}年${md.month}月）との比較データ
- 前年 総問い合わせ数: ${md.prevYear.totalRecords}件 → 今年: ${md.totalRecords}件（${md.totalRecords - md.prevYear.totalRecords >= 0 ? "+" : ""}${md.totalRecords - md.prevYear.totalRecords}件）
- 前年 入院数: ${md.prevYear.totalAdmitted}件 → 今年: ${md.totalAdmitted}件（${md.totalAdmitted - md.prevYear.totalAdmitted >= 0 ? "+" : ""}${md.totalAdmitted - md.prevYear.totalAdmitted}件）
- 前年 CVR: ${md.prevYear.overallCVR}% → 今年: ${md.overallCVR}%
- 前年 平均リードタイム: ${md.prevYear.leadTime.avg}日 → 今年: ${md.leadTime.avg}日
- 前年 コンバージョンファネル:
${md.prevYear.funnelData.map((f: any) => `  - ${f.name}: ${f.count}件`).join("\n")}` : "前年同月のデータはありません。"}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { monthlyData, mode } = body;

    if (!monthlyData) {
      return Response.json({ error: "monthlyData is required" }, { status: 400 });
    }

    const dataContext = buildDataContext(monthlyData);

    if (mode === "sections") {
      const sectionPrompt = `${dataContext}

上記データに基づいて、以下のJSON形式で分析コメントとネクストアクションを出力してください。
各コメントは必ず1文（50文字以内）で、具体的な数値を1つ含めてください。簡潔に。JSONのみを出力し、他のテキストは含めないでください。

{
  "overview": {
    "dailyAdmissions": "日別入院数チャートの分析（ピーク日・曜日パターン等）",
    "statusDist": "進捗・転帰の分布に対するコメント",
    "funnel": "営業ファネルのボトルネック分析",
    "referralRoute": "紹介経路の内訳に対するコメント（主要チャネルの評価）",
    "preAdmissionLoc": "入院前居所の分布に対するコメント"
  },
  "cv": {
    "sourceMonthly": "紹介元別日別入院数推移の分析",
    "sourceTable": "紹介元別CV数・CVRテーブルの分析（Top/Bottom紹介元の評価）",
    "dailyTrend": "日別入院数トレンドの分析",
    "cancelReasons": "キャンセル理由の分析（改善可能性）"
  },
  "contacts": {
    "dailyContacts": "日別コンタクト数vs入院数の相関分析",
    "touchPoints": "患者あたりタッチポイント数の分析（最適接触回数）",
    "funnelDetail": "コンバージョンファネル詳細の分析"
  },
  "notes": {
    "selectionReasons": "当院選定理由の分析",
    "cancelPatterns": "キャンセル詳細理由の分析",
    "medicalNeeds": "医療ニーズ分布の分析",
    "competitors": "競合病院の分析"
  },
  "cross": {
    "factorRanking": "入院影響度ランキングの分析（促進要因・阻害要因）",
    "goldenPaths": "ゴールデンパスに関するコメント",
    "riskPatterns": "リスクパターンに関するコメント",
    "heatmaps": "ヒートマップ（紹介元×地域、経路×地域等）の分析"
  },
  "map": {
    "geoDistribution": "地域分布の全体分析",
    "topAreas": "上位地域の評価と営業ポテンシャル"
  },
  "ai": {
    "kpiComment": "KPIサマリーに対するコメント（入院数やCVRのトレンド評価）",
    "funnelComment": "ファネル分析のコメント",
    "cvrHighComment": "高CVR紹介元に対するコメント",
    "cvrLowComment": "低CVR紹介元の改善ポテンシャルに関するコメント",
    "selectionComment": "当院が選ばれる理由の分析コメント",
    "cancelComment": "キャンセル・流出の分析コメント",
    "areaComment": "地域分析のコメント"
  },
  "nextActions": [
    {
      "title": "アクションのタイトル",
      "desc": "具体的な施策の説明",
      "impact": "大|中|小",
      "effort": "大|中|小",
      "priority": "最優先|高|中"
    }
  ]
}`;

      const stream = await client.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8192,
        system: SYSTEM_PROMPT_PARTS,
        messages: [{ role: "user", content: sectionPrompt }],
      });

      let jsonText = "";
      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          const delta = event.delta;
          if ("text" in delta && delta.text) {
            jsonText += delta.text;
          }
        }
      }

      const cleaned = jsonText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const startIdx = cleaned.indexOf("{");
      const endIdx = cleaned.lastIndexOf("}");
      if (startIdx === -1 || endIdx === -1) {
        return Response.json({ error: "Failed to parse AI response", raw: cleaned.slice(0, 200) }, { status: 500 });
      }

      let parsed;
      try {
        parsed = JSON.parse(cleaned.slice(startIdx, endIdx + 1));
      } catch (e) {
        return Response.json({ error: `JSON parse error: ${e}`, raw: cleaned.slice(startIdx, startIdx + 300) }, { status: 500 });
      }

      const finalMessage = await stream.finalMessage();
      const usage = finalMessage.usage;
      return Response.json({
        sections: parsed,
        usage: {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_creation_input_tokens: (usage as unknown as Record<string, number>).cache_creation_input_tokens || 0,
          cache_read_input_tokens: (usage as unknown as Record<string, number>).cache_read_input_tokens || 0,
        },
      });
    }

    const narrativePrompt = `${dataContext}

このデータに基づいて、経営コンサルタントとして深掘り分析を行ってください。

以下のMarkdown形式で出力してください。

### 📊 総合サマリー
（2-3文で月次データの全体像を簡潔に要約）

### 🔍 重要インサイト
（データから読み取れる重要な発見を3-5個、箇条書きで。各項目は具体的な数値を含めること）

### ⚠️ 注意すべきリスク
（経営上注意すべきリスクや課題を2-3個）

### 🎯 推奨アクション
（優先度順に3-5個の具体的なアクションプラン。各アクションには「効果」「工数」「期限目安」を含めること）

### 📈 前年同月比分析
（前年データがある場合: 主要KPIの前年比変化、改善点と悪化点、トレンドの評価。前年データがない場合は省略）

### 💡 追加の考察
（データからは直接読み取れないが、コンサルタントとして気づいた点やアドバイス）`;

    const stream = await client.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT_PARTS,
      messages: [{ role: "user", content: narrativePrompt }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta") {
              const delta = event.delta;
              if ("text" in delta && delta.text) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", text: delta.text })}\n\n`));
              }
            }
          }

          const finalMessage = await stream.finalMessage();
          const usage = finalMessage.usage;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "done",
                usage: {
                  input_tokens: usage.input_tokens,
                  output_tokens: usage.output_tokens,
                  cache_creation_input_tokens: (usage as unknown as Record<string, number>).cache_creation_input_tokens || 0,
                  cache_read_input_tokens: (usage as unknown as Record<string, number>).cache_read_input_tokens || 0,
                },
              })}\n\n`
            )
          );
          controller.close();
        } catch (err) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: String(err) })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
