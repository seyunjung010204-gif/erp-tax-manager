import Papa from "papaparse";
import { TaxRecord, TaxType } from "@/types/tax";

type CsvRow = Record<string, string>;

const aliases = {
  date: [
    "작성일자",
    "작성 일자",
    "발급일자",
    "발급 일자",
    "일자",
    "거래일자",
    "거래 일자",
  ],
  issueDate: ["발급일자", "발급 일자"],
  supplierName: [
    "공급자 상호",
    "공급자상호",
    "공급자",
    "공급자명",
    "공급하는 자",
  ],
  buyerName: [
    "공급받는자 상호",
    "공급받는자상호",
    "공급받는 자 상호",
    "공급받는자",
    "공급받는자명",
  ],
  vendorName: ["상호", "거래처명", "업체명"],
  supplierBusinessNumber: [
    "공급자 사업자등록번호",
    "공급자사업자등록번호",
    "공급자 등록번호",
  ],
  buyerBusinessNumber: [
    "공급받는자 사업자등록번호",
    "공급받는자사업자등록번호",
    "공급받는자 등록번호",
  ],
  businessNumber: ["사업자등록번호", "등록번호"],
  businessType: ["업태", "업종"],
  supplyAmount: ["공급가액", "공급가", "공급 금액", "공급금액"],
  vatAmount: ["세액", "부가세", "부가가치세", "세금"],
  totalAmount: ["합계금액", "합계", "총액", "총금액"],
  itemName: ["품목", "품목명", "내용", "비고", "적요"],
  approvalNumber: [
    "승인번호",
    "전자세금계산서승인번호",
    "전자세금계산서 승인번호",
  ],
};

function normalizeKey(value: string) {
  return String(value ?? "")
    .replace(/\s/g, "")
    .replace(/\uFEFF/g, "")
    .trim();
}

function pick(row: CsvRow, keys: string[]) {
  const normalizedRow = Object.entries(row).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      acc[normalizeKey(key)] = value;
      return acc;
    },
    {}
  );

  for (const key of keys) {
    const found = normalizedRow[normalizeKey(key)];
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
    .trim();

  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function parseDate(value: string) {
  if (!value) return new Date().toISOString().slice(0, 10);

  const cleaned = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  const digits = cleaned.replace(/[^\d]/g, "");

  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  if (digits.length === 6) {
    return `20${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
  }

  return new Date().toISOString().slice(0, 10);
}

export function parseHometaxCsv(
  fileText: string,
  type: TaxType,
  userId: string
): Omit<TaxRecord, "id">[] {
  const parsed = Papa.parse<CsvRow>(fileText, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    console.warn(parsed.errors);
  }

  return parsed.data
    .filter((row) => Object.values(row).some((v) => String(v ?? "").trim()))
    .map((row) => {
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
      };
    });
}

export function toTemplateCsv(records: TaxRecord[]) {
  const headers = [
    "날짜",
    "상호",
    "출발",
    "도착",
    "지급상태",
    "차종",
    "공급가액",
    "부가세",
    "증빙상태",
    "승인번호",
    "메모",
  ];

  const escapeCsv = (value: unknown) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const rows = records.map((r) => [
    r.record_date,
    r.vendor_name,
    r.departure ?? "",
    r.destination ?? "",
    r.payment_status ?? "",
    r.vehicle_type ?? "",
    r.supply_amount,
    r.vat_amount,
    "",
    r.approval_number ?? "",
    r.memo ?? "",
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}