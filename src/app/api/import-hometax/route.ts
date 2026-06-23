import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import { parseHometaxCsv } from "@/lib/hometaxCsv";
import { TaxRecord, TaxType } from "@/types/tax";

export const runtime = "nodejs";

async function getAuthUser(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    throw new Error("로그인이 필요합니다.");
  }

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new Error("인증 정보를 확인할 수 없습니다.");
  }

  return data.user;
}

function decodeCsv(buffer: ArrayBuffer) {
  let text = new TextDecoder("utf-8").decode(buffer);

  if (text.includes("�")) {
    try {
      text = new TextDecoder("euc-kr").decode(buffer);
    } catch {
      text = new TextDecoder("utf-8").decode(buffer);
    }
  }

  return text;
}

function scoreRecords(records: Omit<TaxRecord, "id">[]) {
  return records.reduce((sum, record) => {
    let point = 0;

    if (record.vendor_name && record.vendor_name !== "미확인 업체") point += 3;
    if (record.business_number) point += 2;
    if (Number(record.supply_amount ?? 0) !== 0) point += 3;
    if (Number(record.vat_amount ?? 0) !== 0) point += 2;
    if (record.approval_number) point += 2;

    return sum + point;
  }, 0);
}

function parseExcelBuffer(buffer: ArrayBuffer, type: TaxType, userId: string) {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    raw: false,
  });

  if (workbook.SheetNames.length === 0) {
    throw new Error("엑셀 파일에 시트가 없습니다.");
  }

  let bestRows: Omit<TaxRecord, "id">[] = [];
  let bestScore = -1;
  let bestSheetName = "";

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];

    const csvText = XLSX.utils.sheet_to_csv(worksheet, {
      blankrows: false,
    });

    const rows = parseHometaxCsv(csvText, type, userId);
    const score = scoreRecords(rows);

    if (score > bestScore) {
      bestScore = score;
      bestRows = rows;
      bestSheetName = sheetName;
    }
  }

  if (bestRows.length === 0 || bestScore <= 0) {
    throw new Error(
      `홈택스 엑셀에서 거래내역을 인식하지 못했습니다. 확인한 시트: ${bestSheetName || "없음"}`
    );
  }

  return bestRows;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    const formData = await req.formData();

    const file = formData.get("file");
    const type = formData.get("type") as TaxType;

    if (!(file instanceof File)) {
      throw new Error("업로드된 파일이 없습니다.");
    }

    if (type !== "purchase" && type !== "sales") {
      throw new Error("매입/매출 구분이 올바르지 않습니다.");
    }

    const fileName = file.name.toLowerCase();
    const buffer = await file.arrayBuffer();

    let rows: Omit<TaxRecord, "id">[] = [];

    if (fileName.endsWith(".xls") || fileName.endsWith(".xlsx")) {
      rows = parseExcelBuffer(buffer, type, user.id);
    } else if (fileName.endsWith(".csv")) {
      const text = decodeCsv(buffer);
      rows = parseHometaxCsv(text, type, user.id);

      if (rows.length === 0) {
        throw new Error("CSV에서 거래내역을 인식하지 못했습니다.");
      }
    } else {
      throw new Error("지원하지 않는 파일입니다. csv, xls, xlsx만 업로드할 수 있습니다.");
    }

    const supabase = createSupabaseAdmin();

    const { data, error } = await supabase
      .from("tax_records")
      .insert(rows)
      .select("*");

    if (error) {
      throw error;
    }

    await supabase.from("import_batches").insert({
      file_name: file.name,
      source: "hometax_file",
      imported_by: user.id,
      row_count: rows.length,
    });

    return NextResponse.json({
      rowCount: rows.length,
      records: data ?? [],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "홈택스 파일 업로드에 실패했습니다.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
