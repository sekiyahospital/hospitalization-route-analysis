import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

/**
 * 経営会議報告資料（Excel）をキントーンに新規レコードとして保管する。
 *
 * キントーンは任意オリジンからのCORSを許可しておらず、APIトークンを
 * ブラウザに出すわけにもいかないため、ここをサーバー側の中継役にする。
 *
 * 必要な環境変数:
 *   KINTONE_BASE_URL      https://〇〇.cybozu.com （または .kintone.com）
 *   KINTONE_APP_ID        アプリID
 *   KINTONE_API_TOKEN     APIトークン（レコード追加権限が必要）
 *   KINTONE_FIELD_FILE    添付ファイルフィールドのフィールドコード
 * 任意:
 *   KINTONE_FIELD_MONTH   対象年月を入れるフィールドコード
 *   KINTONE_FIELD_PERIOD  集計期間を入れるフィールドコード
 *   KINTONE_GUEST_SPACE_ID  ゲストスペース内のアプリの場合のスペースID
 */

interface KintoneConfig {
  baseUrl: string;
  appId: string;
  apiToken: string;
  fileField: string;
  monthField?: string;
  periodField?: string;
  guestSpaceId?: string;
}

function readConfig(): KintoneConfig | null {
  const baseUrl = process.env.KINTONE_BASE_URL?.replace(/\/+$/, "");
  const appId = process.env.KINTONE_APP_ID;
  const apiToken = process.env.KINTONE_API_TOKEN;
  const fileField = process.env.KINTONE_FIELD_FILE;
  if (!baseUrl || !appId || !apiToken || !fileField) return null;
  return {
    baseUrl,
    appId,
    apiToken,
    fileField,
    monthField: process.env.KINTONE_FIELD_MONTH,
    periodField: process.env.KINTONE_FIELD_PERIOD,
    guestSpaceId: process.env.KINTONE_GUEST_SPACE_ID,
  };
}

/** ゲストスペース内のアプリはAPIのパスが変わる */
const apiBase = (c: KintoneConfig) =>
  c.guestSpaceId ? `${c.baseUrl}/k/guest/${c.guestSpaceId}/v1` : `${c.baseUrl}/k/v1`;

const recordUrl = (c: KintoneConfig, id: string) =>
  c.guestSpaceId
    ? `${c.baseUrl}/k/guest/${c.guestSpaceId}/${c.appId}/show#record=${id}`
    : `${c.baseUrl}/k/${c.appId}/show#record=${id}`;

/** 設定済みかどうかを返す。UI側のボタン表示の出し分けに使う */
export async function GET() {
  const config = readConfig();
  return NextResponse.json({
    configured: config !== null,
    guestSpace: !!config?.guestSpaceId,
  });
}

export async function POST(req: NextRequest) {
  const config = readConfig();
  if (!config) {
    return NextResponse.json(
      { error: "キントーンの接続情報が未設定です（KINTONE_BASE_URL / KINTONE_APP_ID / KINTONE_API_TOKEN / KINTONE_FIELD_FILE）" },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ファイルが添付されていません" }, { status: 400 });
  }
  const fileName = String(form.get("fileName") || file.name || "report.xlsx");
  const targetMonth = form.get("targetMonth") ? String(form.get("targetMonth")) : null;
  const periodLabel = form.get("periodLabel") ? String(form.get("periodLabel")) : null;

  const headers = { "X-Cybozu-API-Token": config.apiToken };

  try {
    // ① ファイルをアップロードして fileKey を得る
    const upload = new FormData();
    upload.append("file", file, fileName);
    const fileRes = await fetch(`${apiBase(config)}/file.json`, {
      method: "POST",
      headers,
      body: upload,
    });
    const fileJson = await fileRes.json().catch(() => ({}));
    if (!fileRes.ok) {
      return NextResponse.json(
        { error: `ファイルのアップロードに失敗しました: ${fileJson.message || fileRes.status}`, detail: fileJson },
        { status: 502 },
      );
    }

    // ② fileKey を添付フィールドに紐付けて、新規レコードを作成する
    const record: Record<string, { value: unknown }> = {
      [config.fileField]: { value: [{ fileKey: fileJson.fileKey }] },
    };
    if (config.monthField && targetMonth) record[config.monthField] = { value: targetMonth };
    if (config.periodField && periodLabel) record[config.periodField] = { value: periodLabel };

    const recRes = await fetch(`${apiBase(config)}/record.json`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ app: config.appId, record }),
    });
    const recJson = await recRes.json().catch(() => ({}));
    if (!recRes.ok) {
      return NextResponse.json(
        { error: `レコードの作成に失敗しました: ${recJson.message || recRes.status}`, detail: recJson },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      recordId: recJson.id,
      url: recordUrl(config, String(recJson.id)),
      fileName,
    });
  } catch (e) {
    // IPアドレス制限やBasic認証で弾かれた場合もここに来る
    return NextResponse.json(
      { error: `キントーンへの接続に失敗しました: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}
