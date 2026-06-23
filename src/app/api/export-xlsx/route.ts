import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import { toFixedTaxInvoiceRows } from "@/lib/hometaxCsv";
import { EvidenceAttachment, TaxRecord } from "@/types/tax";

function money(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

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

function borderStyle() {
  return {
    top: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
    left: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
    bottom: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
    right: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    const body = await req.json();

    const from = body.from as string;
    const to = body.to as string;
    const type = body.type as "all" | "purchase" | "sales";

    const supabase = createSupabaseAdmin();

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    let query = supabase
      .from("tax_records")
      .select("*")
      .gte("record_date", from)
      .lte("record_date", to)
      .order("record_date", { ascending: true });

    if (type !== "all") {
      query = query.eq("type", type);
    }

    if (profile?.role !== "admin") {
      query = query.eq("created_by", user.id);
    }

    const { data: records, error } = await query;

    if (error) throw error;

    const rows = (records ?? []) as TaxRecord[];
    const ids = rows.map((r) => r.id);

    let attachments: EvidenceAttachment[] = [];

    if (ids.length > 0) {
      const { data: attRows, error: attError } = await supabase
        .from("attachments")
        .select("*")
        .in("tax_record_id", ids);

      if (attError) throw attError;

      attachments = (attRows ?? []) as EvidenceAttachment[];
    }

    const fixedRows = toFixedTaxInvoiceRows(rows, attachments);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "ERP Tax Manager";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("세금계산서", {
      pageSetup: {
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });

    sheet.columns = [
      { width: 3 },
      { width: 3 },
      { width: 16 },
      { width: 26 },
      { width: 18 },
      { width: 26 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 12 },
      { width: 12 },
      { width: 18 },
      { width: 26 },
    ];

    sheet.getCell("C1").value = "■ 6월 지출명세";
    sheet.getCell("C1").font = { bold: true, size: 18 };

    sheet.getCell("C3").value = "HMG퓨처콤플렉스㈜";
    sheet.getCell("C3").font = { bold: true, size: 13 };
    sheet.getCell("R3").value = "(단위:원)";
    sheet.getCell("R3").alignment = { horizontal: "right" };

    sheet.mergeCells("C4:C5");
    sheet.mergeCells("D4:E4");
    sheet.mergeCells("F4:F5");
    sheet.mergeCells("G4:I4");
    sheet.mergeCells("J4:J5");
    sheet.mergeCells("K4:Q4");
    sheet.mergeCells("R4:R5");

    sheet.getCell("C4").value = "세금계산서\n발행일자";
    sheet.getCell("D4").value = "거래선";
    sheet.getCell("F4").value = "적요";
    sheet.getCell("G4").value = "금액";
    sheet.getCell("J4").value = "지급일";
    sheet.getCell("K4").value = "관련증빙";
    sheet.getCell("R4").value = "비고";

    sheet.getCell("D5").value = "상호";
    sheet.getCell("E5").value = "사업자등록번호";
    sheet.getCell("G5").value = "공급가";
    sheet.getCell("H5").value = "VAT";
    sheet.getCell("I5").value = "계";
    sheet.getCell("K5").value = "품의서";
    sheet.getCell("L5").value = "세금\n계산서";
    sheet.getCell("M5").value = "거래\n명세서";
    sheet.getCell("N5").value = "계좌\n사본";
    sheet.getCell("O5").value = "사업자\n등록증";
    sheet.getCell("P5").value = "원천징수\n영수증";
    sheet.getCell("Q5").value = "기타";

    for (let row = 4; row <= 5; row++) {
      for (let col = 3; col <= 18; col++) {
        const cell = sheet.getCell(row, col);
        cell.border = borderStyle();
        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        };
        cell.font = { bold: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFEFF6FF" },
        };
      }
    }

    let currentRow = 6;

    for (const rowValues of fixedRows) {
      const row = sheet.getRow(currentRow);

      row.getCell(3).value = rowValues[0];
      row.getCell(4).value = rowValues[1];
      row.getCell(5).value = rowValues[2];
      row.getCell(6).value = rowValues[3];
      row.getCell(7).value = money(rowValues[4]);
      row.getCell(8).value = money(rowValues[5]);
      row.getCell(9).value = money(rowValues[6]);
      row.getCell(10).value = rowValues[7];
      row.getCell(11).value = rowValues[8];
      row.getCell(12).value = rowValues[9];
      row.getCell(13).value = rowValues[10];
      row.getCell(14).value = rowValues[11];
      row.getCell(15).value = rowValues[12];
      row.getCell(16).value = rowValues[13];
      row.getCell(17).value = rowValues[14];
      row.getCell(18).value = rowValues[15];

      for (let col = 3; col <= 18; col++) {
        const cell = row.getCell(col);
        cell.border = borderStyle();
        cell.alignment = {
          horizontal: col >= 7 && col <= 9 ? "right" : "center",
          vertical: "middle",
          wrapText: true,
        };

        if (col >= 7 && col <= 9) {
          cell.numFmt = "#,##0";
        }
      }

      currentRow += 1;
    }

    const totalRow = sheet.getRow(currentRow);
    sheet.mergeCells(`C${currentRow}:F${currentRow}`);
    totalRow.getCell(3).value = "합계";

    const supplyTotal = rows.reduce((sum, r) => sum + money(r.supply_amount), 0);
    const vatTotal = rows.reduce((sum, r) => sum + money(r.vat_amount), 0);
    const total = supplyTotal + vatTotal;

    totalRow.getCell(7).value = supplyTotal;
    totalRow.getCell(8).value = vatTotal;
    totalRow.getCell(9).value = total;

    for (let col = 3; col <= 18; col++) {
      const cell = totalRow.getCell(col);
      cell.border = borderStyle();
      cell.font = { bold: true };
      cell.alignment = {
        horizontal: col >= 7 && col <= 9 ? "right" : "center",
        vertical: "middle",
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEFF6FF" },
      };

      if (col >= 7 && col <= 9) {
        cell.numFmt = "#,##0";
      }
    }

    sheet.views = [{ state: "frozen", ySplit: 5 }];

    const buffer = await workbook.xlsx.writeBuffer();
    const excelBuffer = Buffer.from(buffer);

    return new NextResponse(excelBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(
          `세금계산서_내역서_${from}_${to}.xlsx`
        )}"`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "엑셀 내보내기에 실패했습니다.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
