import Papa from "papaparse";
import { EvidenceAttachment, TaxRecord, TaxType } from "@/types/tax";

type CsvRow = Record<string, string>;

const aliases = {
  date: [
    "작성일자",
    "작성 일자",
    "발급일자",
    "발급 일자",
    "전자세금계산서 작성일자",
    "전자세금계산서작성일자",
    "일자",
    "거래일자",
    "거래 일자",
  ],
  supplierName: [
    "공급자 상호",
    "공급자상호",
    "공급자 상호명",
    "공급자상호명",
    "공급자",
    "공급자명",
    "상호(공급자)",
    "상호",
  ],
  buyerName: [
    "공급받는자 상호",
    "공급받는자상호",
    "공급받는 자 상호",
    "공급받는자 상호명",
    "공급받는자상호명",
    "공급받는자",
    "공급받는자명",
    "상호(공급받는자)",
  ],
  vendorName: ["거래처명", "업체명", "상호명", "상호"],
  supplierBusinessNumber: [
    "공급자 사업자등록번호",
    "공급자사업자등록번호",
    "공급자 등록번호",
    "사업자등록번호(공급자)",
    "등록번호(공급자)",
  ],
  buyerBusinessNumber: [
    "공급받는자 사업자등록번호",
    "공급받는자사업자등록번호",
    "공급받는자 등록번호",
    "사업자등록번호(공급받는자)",
    "등록번호(공급받는자)",
  ],
  businessNumber: ["사업자등록번호", "등록번호", "사업자 번호"],
  businessType: ["업태", "업종"],
  supplyAmount: [
    "공급가액",
    "공급가",
    "공급 금액",
    "공급금액",
    "공급가액 합계",
  ],
  vatAmount: ["세액", "부가세", "부가가치세", "세금", "세액 합계"],
  totalAmount: ["합계금액", "합계", "총액", "총금액", "합계 금액"],
  itemName: ["품목", "품목명", "내용", "비고", "적요"],
  approvalNumber: [
    "승인번호",
    "전자세금계산서승인번호",
    "전자세금계산서 승인번호",
    "국세청승인번호",
    "국세청 승인번호",
  ],
};

function normalize(value: string) {
  return String(value ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/\s/g, "")
    .replace(/["']/g, "")
    .replace(/\./g, "")
    .replace(/\-/g, "")
    .replace(/\_/g, "")
    .replace(/\(/g, "")
    .replace(/\)/g, "")
    .trim();
}

function pick(row: CsvRow, keys: string[]) {
  const normalizedRow = Object.entries(row).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      acc[normalize(key)] = String(value ?? "").trim();
      return acc;
    },
    {}
  );

  for (const key of keys) {
    const found = normalizedRow[normalize(key)];
    if (found !== undefined && found !== null && String(found).trim() !== "") {
      return String(found).trim();
    }
  }

  return "";
}

function parseNumber(value: string) {
  if (!value) return 0;

  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/원/g, "")
    .replace(/\s/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();

  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function parseDate(value: string) {
  if (!value) return new Date().toISOString().slice(0, 10);

  const cleaned = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  if (/^\d{4}\.\d{2}\.\d{2}$/.test(cleaned)) {
    return cleaned.replace(/\./g, "-");
  }

  if (/^\d{4}\/\d{2}\/\d{2}$/.test(cleaned)) {
    return cleaned.replace(/\//g, "-");
  }

  const digits = cleaned.replace(/[^\d]/g, "");

  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  if (digits.length === 6) {
    return `20${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
  }

  return new Date().toISOString().slice(0, 10);
}

function splitLines(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "");
}

function findHeaderLineIndex(lines: string[]) {
  const hints = [
    "공급가액",
    "세액",
    "작성일자",
    "발급일자",
    "승인번호",
    "공급자",
    "공급받는자",
    "상호",
  ];

  let bestIndex = 0;
  let bestScore = -1;

  lines.forEach((line, index) => {
    const normalizedLine = normalize(line);
    const score = hints.reduce((sum, hint) => {
      return normalizedLine.includes(normalize(hint)) ? sum + 1 : sum;
    }, 0);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function parseWithDetectedHeader(fileText: string) {
  const lines = splitLines(fileText);
  const headerIndex = findHeaderLineIndex(lines);
  const trimmedText = lines.slice(headerIndex).join("\n");

  const parsed = Papa.parse<CsvRow>(trimmedText, {
    header: true,
    skipEmptyLines: true,
    delimiter: "",
    transformHeader: (header) => header.trim(),
  });

  return parsed.data.filter((row) =>
    Object.values(row).some((v) => String(v ?? "").trim())
  );
}

export function parseHometaxCsv(
  fileText: string,
  type: TaxType,
  userId: string
): Omit<TaxRecord, "id">[] {
  const rows = parseWithDetectedHeader(fileText);

  return rows.map((row) => {
    const supplierName = pick(row, aliases.supplierName);
    const buyerName = pick(row, aliases.buyerName);
    const fallbackVendor = pick(row, aliases.vendorName);

    const supplierBizNo = pick(row, aliases.supplierBusinessNumber);
    const buyerBizNo = pick(row, aliases.buyerBusinessNumber);
    const fallbackBizNo = pick(row, aliases.businessNumber);

    const vendorName =
      type === "purchase"
        ? supplierName || fallbackVendor || buyerName || "미확인 업체"
        : buyerName || fallbackVendor || supplierName || "미확인 업체";

    const businessNumber =
      type === "purchase"
        ? supplierBizNo || fallbackBizNo || buyerBizNo
        : buyerBizNo || fallbackBizNo || supplierBizNo;

    const supplyAmount = parseNumber(pick(row, aliases.supplyAmount));
    const vatAmount = parseNumber(pick(row, aliases.vatAmount));
    const totalAmount =
      parseNumber(pick(row, aliases.totalAmount)) || supplyAmount + vatAmount;

    return {
      type,
      record_date: parseDate(pick(row, aliases.date)),
      vendor_name: vendorName,
      business_number: businessNumber || null,
      business_type: pick(row, aliases.businessType) || null,
      item_name: pick(row, aliases.itemName) || null,
      departure: null,
      destination: null,
      payment_status: "미지정",
      vehicle_type: null,
      supply_amount: supplyAmount,
      vat_amount: vatAmount,
      total_amount: totalAmount,
      approval_number: pick(row, aliases.approvalNumber) || null,
      source: "hometax_csv",
      memo: null,
      created_by: userId,
      payment_date: null,
      approval_doc_checked: false,
      bank_account_checked: false,
      business_license_checked: false,
      withholding_checked: false,
      etc_evidence: null,
      remark: null,
    };
  });
}

function hasAttachment(
  record: TaxRecord,
  attachments: EvidenceAttachment[],
  types: string[]
) {
  return attachments.some(
    (a) => a.tax_record_id === record.id && types.includes(String(a.attachment_type))
  );
}

function mark(value: boolean) {
  return value ? "●" : "";
}

export function toFixedTaxInvoiceRows(
  records: TaxRecord[],
  attachments: EvidenceAttachment[] = []
) {
  return records.map((r) => {
    const hasTaxInvoice =
      r.source === "hometax_csv" ||
      hasAttachment(r, attachments, ["tax_invoice"]);

    const hasStatement = hasAttachment(r, attachments, ["statement"]);

    const hasBankAccount =
      Boolean(r.bank_account_checked) ||
      hasAttachment(r, attachments, ["bank_account"]);

    const hasBusinessLicense =
      Boolean(r.business_license_checked) ||
      hasAttachment(r, attachments, ["business_license"]);

    const hasWithholding =
      Boolean(r.withholding_checked) ||
      hasAttachment(r, attachments, ["withholding"]);

    const hasApprovalDoc =
      Boolean(r.approval_doc_checked) ||
      hasAttachment(r, attachments, ["approval_doc"]);

    const etcText =
      r.etc_evidence ||
      (hasAttachment(r, attachments, ["etc", "camera_photo", "evidence"])
        ? "기타증빙"
        : "");

    return [
      r.record_date,
      r.vendor_name,
      r.business_number ?? "",
      r.item_name ?? r.memo ?? "",
      Number(r.supply_amount ?? 0),
      Number(r.vat_amount ?? 0),
      Number(r.supply_amount ?? 0) + Number(r.vat_amount ?? 0),
      r.payment_date ?? "",
      mark(hasApprovalDoc),
      mark(hasTaxInvoice),
      mark(hasStatement),
      mark(hasBankAccount),
      mark(hasBusinessLicense),
      mark(hasWithholding),
      etcText,
      r.remark ?? "",
    ];
  });
}

export function toTemplateCsv(
  records: TaxRecord[],
  attachments: EvidenceAttachment[] = []
) {
  const headers = [
    "세금계산서 발행일자",
    "거래선 - 상호",
    "거래선 - 사업자등록번호",
    "적요",
    "금액 - 공급가",
    "금액 - VAT",
    "금액 - 계",
    "지급일",
    "관련증빙 - 품의서",
    "관련증빙 - 세금계산서",
    "관련증빙 - 거래명세서",
    "관련증빙 - 계좌사본",
    "관련증빙 - 사업자등록증",
    "관련증빙 - 원천징수영수증",
    "관련증빙 - 기타",
    "비고",
  ];

  const escapeCsv = (value: unknown) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const rows = toFixedTaxInvoiceRows(records, attachments);

  return [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");
}
