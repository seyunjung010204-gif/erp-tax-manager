import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import { toTemplateCsv } from "@/lib/hometaxCsv";
import { EvidenceAttachment, TaxRecord } from "@/types/tax";

type ExportMode = "csv" | "zip" | "pdf-merged" | "pdf-separate";

function safeFileName(value: string) {
  return value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
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

async function buildMergedPdf(
  records: TaxRecord[],
  attachments: EvidenceAttachment[]
) {
  const supabase = createSupabaseAdmin();
  const outputPdf = await PDFDocument.create();

  for (const record of records) {
    const linked = attachments.filter((a) => a.tax_record_id === record.id);

    for (const file of linked) {
      const { data, error } = await supabase.storage
        .from("evidence")
        .download(file.file_path);

      if (error || !data) {
        continue;
      }

      const bytes = new Uint8Array(await data.arrayBuffer());
      const contentType = file.file_type || "";
      const lowerFileName = file.file_name.toLowerCase();

      try {
        if (contentType.includes("pdf") || lowerFileName.endsWith(".pdf")) {
          const srcPdf = await PDFDocument.load(bytes);
          const pages = await outputPdf.copyPages(
            srcPdf,
            srcPdf.getPageIndices()
          );

          pages.forEach((page) => outputPdf.addPage(page));
        } else if (
          contentType.includes("png") ||
          lowerFileName.endsWith(".png")
        ) {
          const page = outputPdf.addPage([595.28, 841.89]);
          const image = await outputPdf.embedPng(bytes);
          const { width, height } = image.scale(1);
          const scale = Math.min(520 / width, 760 / height);

          page.drawImage(image, {
            x: 37,
            y: 40,
            width: width * scale,
            height: height * scale,
          });
        } else if (
          contentType.includes("jpg") ||
          contentType.includes("jpeg") ||
          lowerFileName.endsWith(".jpg") ||
          lowerFileName.endsWith(".jpeg")
        ) {
          const page = outputPdf.addPage([595.28, 841.89]);
          const image = await outputPdf.embedJpg(bytes);
          const { width, height } = image.scale(1);
          const scale = Math.min(520 / width, 760 / height);

          page.drawImage(image, {
            x: 37,
            y: 40,
            width: width * scale,
            height: height * scale,
          });
        }
      } catch {
        continue;
      }
    }
  }

  return outputPdf.save();
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    const body = await req.json();

    const mode = body.mode as ExportMode;
    const from = body.from as string;
    const to = body.to as string;
    const type = body.type as "all" | "purchase" | "sales";

    if (!mode || !from || !to || !type) {
      throw new Error("내보내기 조건이 올바르지 않습니다.");
    }

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

    const { data: records, error: recordsError } = await query;

    if (recordsError) {
      throw recordsError;
    }

    const typedRecords = (records ?? []) as TaxRecord[];
    const recordIds = typedRecords.map((r) => r.id);

    const csv = "\uFEFF" + toTemplateCsv(typedRecords);

    if (mode === "csv") {
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(
            `세금계산서_정리_${from}_${to}.csv`
          )}"`,
        },
      });
    }

    let typedAttachments: EvidenceAttachment[] = [];

    if (recordIds.length > 0) {
      const { data: attachments, error: attError } = await supabase
        .from("attachments")
        .select("*")
        .in("tax_record_id", recordIds);

      if (attError) {
        throw attError;
      }

      typedAttachments = (attachments ?? []) as EvidenceAttachment[];
    }

    if (mode === "pdf-merged") {
      const pdfBytes = await buildMergedPdf(typedRecords, typedAttachments);
      const pdfBuffer = Buffer.from(pdfBytes);

      return new NextResponse(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(
            `증빙자료_통합_${from}_${to}.pdf`
          )}"`,
        },
      });
    }

    const zip = new JSZip();

    if (mode === "zip") {
      zip.file(`세금계산서_정리_${from}_${to}.csv`, csv);
    }

    if (mode === "zip" || mode === "pdf-separate") {
      for (const record of typedRecords) {
        const linked = typedAttachments.filter(
          (a) => a.tax_record_id === record.id
        );

        for (const file of linked) {
          const { data } = await supabase.storage
            .from("evidence")
            .download(file.file_path);

          if (!data) {
            continue;
          }

          const ext = file.file_name.includes(".")
            ? file.file_name.split(".").pop()
            : "bin";

          const name = `${record.record_date}_${safeFileName(
            record.vendor_name
          )}_${record.type === "purchase" ? "매입" : "매출"}_${
            record.supply_amount
          }_${safeFileName(file.attachment_type)}.${ext}`;

          zip.file(`증빙자료/${name}`, await data.arrayBuffer());
        }
      }
    }

    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    const zipBuffer = Buffer.from(zipBytes);

    return new NextResponse(zipBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(
          mode === "pdf-separate"
            ? `증빙자료_개별_${from}_${to}.zip`
            : `세금계산서_자료_${from}_${to}.zip`
        )}"`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "내보내기에 실패했습니다.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}