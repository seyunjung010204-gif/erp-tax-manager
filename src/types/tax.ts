export type UserRole = "admin" | "user" | "viewer";

export type TaxType = "purchase" | "sales";

export type EvidenceType =
  | "tax_invoice"
  | "statement"
  | "bank_account"
  | "business_license"
  | "withholding"
  | "approval_doc"
  | "etc"
  | "camera_photo"
  | "evidence";

export type TaxRecord = {
  id: string;
  type: TaxType;
  record_date: string;
  vendor_name: string;
  business_number?: string | null;
  business_type?: string | null;
  item_name?: string | null;
  departure?: string | null;
  destination?: string | null;
  payment_status?: string | null;
  vehicle_type?: string | null;
  supply_amount: number;
  vat_amount: number;
  total_amount: number;
  approval_number?: string | null;
  source: string;
  memo?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;

  payment_date?: string | null;
  approval_doc_checked?: boolean | null;
  bank_account_checked?: boolean | null;
  business_license_checked?: boolean | null;
  withholding_checked?: boolean | null;
  etc_evidence?: string | null;
  remark?: string | null;
};

export type EvidenceAttachment = {
  id: string;
  tax_record_id: string;
  file_name: string;
  file_type: string;
  file_path: string;
  file_size?: number | null;
  attachment_type: EvidenceType | string;
  uploaded_by?: string | null;
  created_at?: string;
};

export type Profile = {
  id: string;
  email: string;
  name?: string | null;
  role: UserRole;
  created_at: string;
};
