import Anthropic from "@anthropic-ai/sdk";

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
6. **ネクストアクション**: 優先度・効果・工数を明示した具体的なアクション

## 出力形式
以下のMarkdown形式で出力してください。各セクションの見出しは必ず含めてください。

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
（データからは直接読み取れないが、コンサルタントとして気づいた点やアドバイス）`,
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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { monthlyData } = body;

    if (!monthlyData) {
      return Response.json({ error: "monthlyData is required" }, { status: 400 });
    }

    const userMessage = `以下は${monthlyData.year}年${monthlyData.month}月の関屋病院の入院データサマリーです。このデータに基づいて分析を行ってください。

## 基本KPI
- 総問い合わせ数: ${monthlyData.totalRecords}件
- 入院数（CV）: ${monthlyData.totalAdmitted}件
- 全体CVR: ${monthlyData.overallCVR}%
- 平均リードタイム: ${monthlyData.leadTime.avg}日（中央値: ${monthlyData.leadTime.median}日、最短: ${monthlyData.leadTime.min}日、最長: ${monthlyData.leadTime.max}日）

## ステータス分布
${monthlyData.statusDist.map((s: { name: string; value: number }) => `- ${s.name}: ${s.value}件`).join("\n")}

## 紹介元CVRデータ（上位）
${monthlyData.sourceCVData.slice(0, 15).map((s: { source: string; totalContacts: number; admissions: number; cvr: number }) => `- ${s.source}: 問い合わせ${s.totalContacts}件, 入院${s.admissions}件, CVR ${s.cvr}%`).join("\n")}

## コンバージョンファネル
${monthlyData.funnelData.map((f: { name: string; count: number }) => `- ${f.name}: ${f.count}件`).join("\n")}

## キャンセル理由
${monthlyData.cancelReasons.map((c: { name: string; value: number }) => `- ${c.name}: ${c.value}件`).join("\n")}

## 入院患者の地域分布（上位）
${monthlyData.kpAddressData.slice(0, 10).map((a: { address: string; count: number }) => `- ${a.address}: ${a.count}件`).join("\n")}

## 選ばれる理由（特記事項からの抽出）
${monthlyData.selectionReasons?.map((r: { label: string; count: number }) => `- ${r.label}: ${r.count}件`).join("\n") || "データなし"}

## 競合流出先
${monthlyData.competitors?.map((c: { name: string; count: number }) => `- ${c.name}: ${c.count}件`).join("\n") || "データなし"}

## ゴールデンパス（高CVR経路）
${monthlyData.goldenPaths?.slice(0, 5).map((p: { path: string; cvr: number; count: number }) => `- ${p.path}: CVR ${p.cvr}%, ${p.count}件`).join("\n") || "データなし"}

## リスクパターン（低CVR経路）
${monthlyData.riskPatterns?.slice(0, 5).map((p: { pattern: string; cvr: number; count: number }) => `- ${p.pattern}: CVR ${p.cvr}%, ${p.count}件`).join("\n") || "データなし"}
${monthlyData.prevYear ? `
## 前年同月（${monthlyData.year - 1}年${monthlyData.month}月）との比較データ
- 前年 総問い合わせ数: ${monthlyData.prevYear.totalRecords}件 → 今年: ${monthlyData.totalRecords}件（${monthlyData.totalRecords - monthlyData.prevYear.totalRecords >= 0 ? "+" : ""}${monthlyData.totalRecords - monthlyData.prevYear.totalRecords}件）
- 前年 入院数: ${monthlyData.prevYear.totalAdmitted}件 → 今年: ${monthlyData.totalAdmitted}件（${monthlyData.totalAdmitted - monthlyData.prevYear.totalAdmitted >= 0 ? "+" : ""}${monthlyData.totalAdmitted - monthlyData.prevYear.totalAdmitted}件）
- 前年 CVR: ${monthlyData.prevYear.overallCVR}% → 今年: ${monthlyData.overallCVR}%
- 前年 平均リードタイム: ${monthlyData.prevYear.leadTime.avg}日 → 今年: ${monthlyData.leadTime.avg}日
- 前年 コンバージョンファネル:
${monthlyData.prevYear.funnelData.map((f: { name: string; count: number }) => `  - ${f.name}: ${f.count}件`).join("\n")}

前年比の変化について重点的に分析し、改善点・悪化点を明確にしてください。` : "前年同月のデータはありません。"}`;

    const stream = await client.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT_PARTS,
      messages: [{ role: "user", content: userMessage }],
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
