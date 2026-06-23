import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import { parseHometaxCsv } from "@/lib/hometaxCsv";
import { TaxRecord, TaxType } from "@/types/tax";

export const runtime = "nodejs";

type ImportRow = Omit<TaxRecord, "id">;

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

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function toNumber(value: unknown) {
  const cleaned = clean(value)
    .replace(/,/g, "")
    .replace(/원/g, "")
    .replace(/\s/g, "")
    .replace(/[^\d.-]/g, "");

  const number = Number(cleaned);

  return Number.isFinite(number) ? number : 0;
}

function toDate(value: unknown) {
  const text = clean(value);

  if (!text) return new Date().toISOString().slice(0, 10);

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  if (/^\d{4}\.\d{2}\.\d{2}$/.test(text)) {
    return text.replace(/\./g, "-");
  }

  if (/^\d{4}\/\d{2}\/\d{2}$/.test(text)) {
    return text.replace(/\//g, "-");
  }

  const digits = text.replace(/[^\d]/g, "");

  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  if (digits.length === 6) {
    return `20${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
  }

  return new Date().toISOString().slice(0, 10);
}

function normalizeHeader(value: unknown) {
  return clean(value)
    .replace(/\uFEFF/g, "")
    .replace(/\s/g, "")
    .replace(/\n/g, "")
    .replace(/\r/g, "");
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

function findHeaderIndex(rows: unknown[][]) {
  let bestIndex = -1;
  let bestScore = -1;

  rows.forEach((row, index) => {
    const joined = row.map(normalizeHeader).join("|");

    let score = 0;

    if (joined.includes("작성일자")) score += 3;
    if (joined.includes("승인번호")) score += 3;
    if (joined.includes("공급자사업자등록번호")) score += 3;
    if (joined.includes("공급받는자사업자등록번호")) score += 3;
    if (joined.includes("합계금액")) score += 2;
    if (joined.includes("공급가액")) score += 2;
    if (joined.includes("세액")) score += 2;
    if (joined.includes("품목명")) score += 2;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestScore < 8) {
    return -1;
  }

  return bestIndex;
}

function buildHeaderMap(headerRow: unknown[]) {
  const map = new Map<string, number[]>();

  headerRow.forEach((header, index) => {
    const key = normalizeHeader(header);

    if (!key) return;

    const existing = map.get(key) ?? [];
    existing.push(index);
    map.set(key, existing);
  });

  return map;
}

function firstIndex(map: Map<string, number[]>, key: string) {
  const found = map.get(key);
  return found?.[0] ?? -1;
}

function secondIndex(map: Map<string, number[]>, key: string) {
  const found = map.get(key);
  return found?.[1] ?? -1;
}

function value(row: unknown[], index: number) {
  if (index < 0) return "";
  return clean(row[index]);
}

function parseHometaxSheetRows(
  sheetRows: unknown[][],
  type: TaxType,
  userId: string
): ImportRow[] {
  const headerIndex = findHeaderIndex(sheetRows);

  if (headerIndex < 0) {
    return [];
  }

  const headerRow = sheetRows[headerIndex];
  const map = buildHeaderMap(headerRow);

  const idx = {
    date: firstIndex(map, "작성일자"),
    approvalNumber: firstIndex(map, "승인번호"),
    supplierBusinessNumber: firstIndex(map, "공급자사업자등록번호"),
    buyerBusinessNumber: firstIndex(map, "공급받는자사업자등록번호"),

    // 홈택스 목록에는 상호가 공급자/공급받는자 두 번 나옴
    supplierName: firstIndex(map, "상호"),
    buyerName: secondIndex(map, "상호"),

    totalAmount: firstIndex(map, "합계금액"),
    supplyAmount: firstIndex(map, "공급가액"),
    vatAmount: firstIndex(map, "세액"),

    invoiceCategory: firstIndex(map, "전자세금계산서분류"),
    invoiceType: firstIndex(map, "전자세금계산서종류"),
    note: firstIndex(map, "비고"),

    itemDate: firstIndex(map, "품목일자"),
    itemName: firstIndex(map, "품목명"),
  };

  const rows: ImportRow[] = [];

  for (const row of sheetRows.slice(headerIndex + 1)) {
    const approvalNumber = value(row, idx.approvalNumber);
    const recordDate = value(row, idx.date);
    const supplierName = value(row, idx.supplierName);
    const buyerName = value(row, idx.buyerName);

    const supplierBusinessNumber = value(row, idx.supplierBusinessNumber);
    const buyerBusinessNumber = value(row, idx.buyerBusinessNumber);

    const supplyAmount = toNumber(value(row, idx.supplyAmount));
    const vatAmount = toNumber(value(row, idx.vatAmount));
    const totalAmount =
      toNumber(value(row, idx.totalAmount)) || supplyAmount + vatAmount;

    const hasRealData =
      approvalNumber ||
      supplierBusinessNumber ||
      buyerBusinessNumber ||
      supplyAmount !== 0 ||
      vatAmount !== 0 ||
      totalAmount !== 0;

    if (!hasRealData) continue;

    const vendorName =
      type === "purchase"
        ? supplierName || "미확인 업체"
        : buyerName || "미확인 업체";

    const businessNumber =
      type === "purchase" ? supplierBusinessNumber : buyerBusinessNumber;

    rows.push({
      type,
      record_date: toDate(recordDate),
      vendor_name: vendorName,
      business_number: businessNumber || null,
      business_type: null,
      item_name: value(row, idx.itemName) || null,
      departure: null,
      destination: null,
      payment_status: "미지정",
      vehicle_type: null,
      supply_amount: supplyAmount,
      vat_amount: vatAmount,
      total_amount: totalAmount,
      approval_number: approvalNumber || null,
      source: "hometax_file",
      memo: value(row, idx.note) || null,
      created_by: userId,
      payment_date: null,
      approval_doc_checked: false,
      bank_account_checked: false,
      business_license_checked: false,
      withholding_checked: false,
      etc_evidence: null,
      remark: null,
    });
  }

  return rows;
}

function scoreRows(rows: ImportRow[]) {
  return rows.reduce((sum, row) => {
    let score = 0;

    if (row.vendor_name && row.vendor_name !== "미확인 업체") score += 3;
    if (row.business_number) score += 2;
    if (Number(row.supply_amount ?? 0) !== 0) score += 3;
    if (Number(row.vat_amount ?? 0) !== 0) score += 2;
    if (row.approval_number) score += 2;

    return sum + score;
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

  let bestRows: ImportRow[] = [];
  let bestScore = -1;
  let bestSheetName = "";

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];

    const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    });

    const directRows = parseHometaxSheetRows(sheetRows, type, userId);
    const directScore = scoreRows(directRows);

    if (directScore > bestScore) {
      bestScore = directScore;
      bestRows = directRows;
      bestSheetName = sheetName;
    }

    // 예비 경로: 일반 CSV 파서도 한 번 시도
    const csvText = XLSX.utils.sheet_to_csv(worksheet, {
      blankrows: false,
    });
    const csvRows = parseHometaxCsv(csvText, type, userId);
    const csvScore = scoreRows(csvRows);

    if (csvScore > bestScore) {
      bestScore = csvScore;
      bestRows = csvRows;
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

    let rows: ImportRow[] = [];

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
