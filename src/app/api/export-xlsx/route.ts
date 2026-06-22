import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TaxRecord } from "@/types/tax";

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

    if (error) {
      throw error;
    }

    const rows = (records ?? []) as TaxRecord[];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "ERP Tax Manager";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("내역서", {
      pageSetup: {
        paperSize: 9,
        orientation: "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });

    sheet.columns = [
      { key: "date", width: 15 },
      { key: "vendor", width: 28 },
      { key: "departure", width: 16 },
      { key: "destination", width: 16 },
      { key: "payment", width: 14 },
      { key: "vehicle", width: 12 },
      { key: "supply", width: 16 },
      { key: "vat", width: 16 },
      { key: "total", width: 16 },
      { key: "memo", width: 24 },
    ];

    sheet.mergeCells("A1:J1");
    sheet.getCell("A1").value = "거래명세서";
    sheet.getCell("A1").font = {
      size: 24,
      bold: true,
      color: { argb: "FF0F172A" },
    };
    sheet.getCell("A1").alignment = {
      horizontal: "center",
      vertical: "middle",
    };
    sheet.getRow(1).height = 42;

    sheet.mergeCells("A2:J2");
    sheet.getCell("A2").value = "홈택스 세금계산서 기준 매입·매출 내역";
    sheet.getCell("A2").font = {
      size: 11,
      color: { argb: "FF64748B" },
    };
    sheet.getCell("A2").alignment = {
      horizontal: "center",
    };

    sheet.getCell("A4").value = "조회기간";
    sheet.getCell("B4").value = `${from} ~ ${to}`;
    sheet.getCell("D4").value = "자료구분";
    sheet.getCell("E4").value =
      type === "all" ? "전체" : type === "purchase" ? "매입" : "매출";

    sheet.getCell("A5").value = "출력일자";
    sheet.getCell("B5").value = new Date().toISOString().slice(0, 10);
    sheet.getCell("D5").value = "건수";
    sheet.getCell("E5").value = `${rows.length}건`;

    for (const cell of ["A4", "D4", "A5", "D5"]) {
      sheet.getCell(cell).font = { bold: true, color: { argb: "FF0F172A" } };
      sheet.getCell(cell).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEFF6FF" },
      };
      sheet.getCell(cell).border = borderStyle();
      sheet.getCell(cell).alignment = { horizontal: "center" };
    }

    for (const cell of ["B4", "E4", "B5", "E5"]) {
      sheet.getCell(cell).border = borderStyle();
      sheet.getCell(cell).alignment = { horizontal: "center" };
    }

    const supplyTotal = rows.reduce((sum, r) => sum + money(r.supply_amount), 0);
    const vatTotal = rows.reduce((sum, r) => sum + money(r.vat_amount), 0);
    const total = supplyTotal + vatTotal;

    sheet.getCell("G4").value = "공급가 합계";
    sheet.getCell("H4").value = supplyTotal;
    sheet.getCell("G5").value = "부가세 합계";
    sheet.getCell("H5").value = vatTotal;
    sheet.getCell("I4").value = "총합계";
    sheet.getCell("J4").value = total;

    for (const cell of ["G4", "G5", "I4"]) {
      sheet.getCell(cell).font = { bold: true, color: { argb: "FF0F172A" } };
      sheet.getCell(cell).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEFF6FF" },
      };
      sheet.getCell(cell).border = borderStyle();
      sheet.getCell(cell).alignment = { horizontal: "center" };
    }

    for (const cell of ["H4", "H5", "J4"]) {
      sheet.getCell(cell).numFmt = "#,##0";
      sheet.getCell(cell).font = { bold: true };
      sheet.getCell(cell).border = borderStyle();
      sheet.getCell(cell).alignment = { horizontal: "right" };
    }

    const headerRowNumber = 7;
    const header = [
      "날짜",
      "상호",
      "출발",
      "도착",
      "지급상태",
      "차종",
      "공급가액",
      "부가세",
      "합계",
      "메모",
    ];

    sheet.getRow(headerRowNumber).values = header;

    sheet.getRow(headerRowNumber).eachCell((cell) => {
      cell.font = {
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0F172A" },
      };
      cell.border = borderStyle();
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
      };
    });

    let currentRow = headerRowNumber + 1;

    for (const record of rows) {
      const row = sheet.getRow(currentRow);

      row.values = [
        record.record_date,
        record.vendor_name,
        record.departure ?? "",
        record.destination ?? "",
        record.payment_status ?? "",
        record.vehicle_type ?? "",
        money(record.supply_amount),
        money(record.vat_amount),
        money(record.supply_amount) + money(record.vat_amount),
        record.memo ?? record.item_name ?? "",
      ];

      row.eachCell((cell, colNumber) => {
        cell.border = borderStyle();
        cell.alignment = {
          vertical: "middle",
          horizontal: colNumber >= 7 && colNumber <= 9 ? "right" : "center",
        };

        if (colNumber >= 7 && colNumber <= 9) {
          cell.numFmt = "#,##0";
        }
      });

      currentRow += 1;
    }

    const footerRow = currentRow + 1;

    sheet.mergeCells(`A${footerRow}:F${footerRow}`);
    sheet.getCell(`A${footerRow}`).value = "합계";
    sheet.getCell(`A${footerRow}`).font = { bold: true };
    sheet.getCell(`A${footerRow}`).alignment = { horizontal: "center" };
    sheet.getCell(`A${footerRow}`).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEFF6FF" },
    };
    sheet.getCell(`A${footerRow}`).border = borderStyle();

    sheet.getCell(`G${footerRow}`).value = supplyTotal;
    sheet.getCell(`H${footerRow}`).value = vatTotal;
    sheet.getCell(`I${footerRow}`).value = total;

    for (const col of ["G", "H", "I", "J"]) {
      const cell = sheet.getCell(`${col}${footerRow}`);
      cell.font = { bold: true };
      cell.numFmt = "#,##0";
      cell.border = borderStyle();
      cell.alignment = { horizontal: "right" };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEFF6FF" },
      };
    }

    sheet.views = [{ state: "frozen", ySplit: 7 }];

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
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
