"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  Download,
  FileText,
  Camera,
  Trash2,
  Shield,
  ChevronDown,
  LogOut,
  Search,
  Plus,
  Save,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { parseHometaxCsv } from "@/lib/hometaxCsv";
import { EvidenceAttachment, Profile, TaxRecord, TaxType } from "@/types/tax";

function won(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString("ko-KR");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function Home() {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string>("");
  const [profile, setProfile] = useState<Profile | null>(null);

  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [records, setRecords] = useState<TaxRecord[]>([]);
  const [attachments, setAttachments] = useState<EvidenceAttachment[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const [selected, setSelected] = useState<TaxRecord | null>(null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [typeFilter, setTypeFilter] = useState<"all" | TaxType>("all");
  const [search, setSearch] = useState("");
  const [csvType, setCsvType] = useState<TaxType>("purchase");

  const [aiOpen, setAiOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const evidenceInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const selectedAttachments = useMemo(() => {
    if (!selected) return [];
    return attachments.filter((a) => a.tax_record_id === selected.id);
  }, [attachments, selected]);

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      const inDate = r.record_date >= from && r.record_date <= to;
      const inType = typeFilter === "all" || r.type === typeFilter;
      const inSearch =
        !search.trim() ||
        r.vendor_name.toLowerCase().includes(search.toLowerCase()) ||
        (r.business_number ?? "").includes(search) ||
        (r.approval_number ?? "").includes(search);

      return inDate && inType && inSearch;
    });
  }, [records, from, to, typeFilter, search]);

  const summary = useMemo(() => {
    const purchase = filteredRecords
      .filter((r) => r.type === "purchase")
      .reduce((sum, r) => sum + Number(r.supply_amount), 0);

    const sales = filteredRecords
      .filter((r) => r.type === "sales")
      .reduce((sum, r) => sum + Number(r.supply_amount), 0);

    const vat = filteredRecords.reduce(
      (sum, r) => sum + Number(r.vat_amount),
      0
    );

    const missingEvidence = filteredRecords.filter(
      (r) => !attachments.some((a) => a.tax_record_id === r.id)
    ).length;

    return { purchase, sales, vat, missingEvidence };
  }, [filteredRecords, attachments]);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;

    if (!user) return;

    setSessionUserId(user.id);
    setSessionEmail(user.email ?? "");

    await loadProfile(user.id);
    await loadData();
  }

  async function loadProfile(userId: string) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    setProfile(data as Profile | null);
  }

  async function loadData() {
    const [{ data: taxRows }, { data: attRows }] = await Promise.all([
      supabase
        .from("tax_records")
        .select("*")
        .order("record_date", { ascending: false }),
      supabase
        .from("attachments")
        .select("*")
        .order("created_at", { ascending: false }),
    ]);

    setRecords((taxRows ?? []) as TaxRecord[]);
    setAttachments((attRows ?? []) as EvidenceAttachment[]);
  }

  async function loadProfiles() {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    setProfiles((data ?? []) as Profile[]);
  }

  async function handleAuth() {
    setLoading(true);

    try {
      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name: email.split("@")[0] },
          },
        });

        if (error) throw error;
      }

      await init();
    } catch (e) {
      alert(e instanceof Error ? e.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    setSessionUserId(null);
    setSessionEmail("");
    setProfile(null);
    setRecords([]);
    setAttachments([]);
  }

  async function handleCsvUpload(file: File) {
    if (!sessionUserId) return;

    setLoading(true);

    try {
      const text = await file.text();
      const parsed = parseHometaxCsv(text, csvType, sessionUserId);

      const { data, error } = await supabase
        .from("tax_records")
        .insert(parsed)
        .select("*");

      if (error) throw error;

      await supabase.from("import_batches").insert({
        file_name: file.name,
        source: "hometax_csv",
        imported_by: sessionUserId,
        row_count: parsed.length,
      });

      setRecords((prev) => [...((data ?? []) as TaxRecord[]), ...prev]);
      alert(`${parsed.length}건을 홈택스 CSV에서 가져왔습니다.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "CSV 업로드에 실패했습니다.");
    } finally {
      setLoading(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  }

  async function saveRecord(record: TaxRecord) {
    const before = records.find((r) => r.id === record.id) ?? null;

    const { data, error } = await supabase
      .from("tax_records")
      .update({
        type: record.type,
        record_date: record.record_date,
        vendor_name: record.vendor_name,
        business_number: record.business_number,
        business_type: record.business_type,
        item_name: record.item_name,
        departure: record.departure,
        destination: record.destination,
        payment_status: record.payment_status,
        vehicle_type: record.vehicle_type,
        supply_amount: Number(record.supply_amount),
        vat_amount: Number(record.vat_amount),
        total_amount: Number(record.supply_amount) + Number(record.vat_amount),
        approval_number: record.approval_number,
        memo: record.memo,
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id)
      .select("*")
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    await supabase.from("audit_logs").insert({
      target_type: "tax_record",
      target_id: record.id,
      action: "update",
      before_data: before,
      after_data: data,
      user_id: sessionUserId,
    });

    setRecords((prev) =>
      prev.map((r) => (r.id === record.id ? (data as TaxRecord) : r))
    );
    setSelected(data as TaxRecord);
  }

  async function createManualRecord() {
    if (!sessionUserId) return;

    const payload = {
      type: "purchase" as TaxType,
      record_date: today(),
      vendor_name: "새 거래처",
      business_number: null,
      business_type: null,
      item_name: null,
      departure: null,
      destination: null,
      payment_status: "미지정",
      vehicle_type: null,
      supply_amount: 0,
      vat_amount: 0,
      total_amount: 0,
      approval_number: null,
      source: "manual",
      memo: null,
      created_by: sessionUserId,
    };

    const { data, error } = await supabase
      .from("tax_records")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    setRecords((prev) => [data as TaxRecord, ...prev]);
    setSelected(data as TaxRecord);
  }

  async function deleteRecord(record: TaxRecord) {
    if (!confirm("이 거래내역과 연결된 증빙자료를 삭제할까요?")) return;

    const { error } = await supabase
      .from("tax_records")
      .delete()
      .eq("id", record.id);

    if (error) {
      alert(error.message);
      return;
    }

    setRecords((prev) => prev.filter((r) => r.id !== record.id));
    setAttachments((prev) =>
      prev.filter((a) => a.tax_record_id !== record.id)
    );
    setSelected(null);
  }

  async function uploadEvidence(file: File, source: "upload" | "camera") {
    if (!selected || !sessionUserId) {
      alert("먼저 거래내역을 선택하세요.");
      return;
    }

    setLoading(true);

    try {
      const safeName = file.name.replace(/[\\/:*?"<>|]/g, "_");
      const filePath = `${sessionUserId}/${selected.id}/${Date.now()}_${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("evidence")
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from("attachments")
        .insert({
          tax_record_id: selected.id,
          file_name: file.name,
          file_type: file.type || "application/octet-stream",
          file_path: filePath,
          file_size: file.size,
          attachment_type: source === "camera" ? "camera_photo" : "evidence",
          uploaded_by: sessionUserId,
        })
        .select("*")
        .single();

      if (error) throw error;

      setAttachments((prev) => [data as EvidenceAttachment, ...prev]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "증빙자료 업로드에 실패했습니다.");
    } finally {
      setLoading(false);
      if (evidenceInputRef.current) evidenceInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  }

  async function openEvidence(file: EvidenceAttachment) {
    const { data, error } = await supabase.storage
      .from("evidence")
      .createSignedUrl(file.file_path, 60);

    if (error || !data?.signedUrl) {
      alert("증빙자료를 열 수 없습니다.");
      return;
    }

    window.open(data.signedUrl, "_blank");
  }

  async function deleteEvidence(file: EvidenceAttachment) {
    if (!confirm("이 증빙자료를 삭제할까요?")) return;

    await supabase.storage.from("evidence").remove([file.file_path]);
    const { error } = await supabase
      .from("attachments")
      .delete()
      .eq("id", file.id);

    if (error) {
      alert(error.message);
      return;
    }

    setAttachments((prev) => prev.filter((a) => a.id !== file.id));
  }

  async function exportData(
    mode: "csv" | "zip" | "pdf-merged" | "pdf-separate"
  ) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      alert("로그인이 필요합니다.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mode,
          from,
          to,
          type: typeFilter,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "내보내기에 실패했습니다.");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      const ext = mode === "csv" ? "csv" : mode === "pdf-merged" ? "pdf" : "zip";
      a.href = url;
      a.download = `세금계산서_자료_${from}_${to}.${ext}`;
      a.click();

      URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "내보내기에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function exportXlsx() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      alert("로그인이 필요합니다.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/export-xlsx", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          from,
          to,
          type: typeFilter,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "엑셀 내보내기에 실패했습니다.");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      a.href = url;
      a.download = `세금계산서_내역서_${from}_${to}.xlsx`;
      a.click();

      URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "엑셀 내보내기에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function updateUserRole(
    userId: string,
    role: "admin" | "user" | "viewer"
  ) {
    const { error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", userId);

    if (error) {
      alert(error.message);
      return;
    }

    await loadProfiles();
  }

  if (!sessionUserId) {
    return (
      <main className="min-h-screen flex items-center justify-center p-5">
        <section className="glass w-full max-w-md rounded-[28px] p-7">
          <div className="mb-8">
            <div className="badge badge-blue mb-4">ERP Tax Manager</div>
            <h1 className="text-3xl font-black tracking-[-0.04em]">
              홈택스 세금계산서와 증빙자료를 한 곳에서 관리합니다.
            </h1>
            <p className="mt-3 text-sm text-slate-500">
              로그인 후 CSV 업로드, 증빙 1:1 매칭, 기간별 내보내기를 사용할 수 있습니다.
            </p>
          </div>

          <div className="flex gap-2 mb-4">
            <button
              className={`btn flex-1 ${authMode === "login" ? "btn-dark" : ""}`}
              onClick={() => setAuthMode("login")}
            >
              로그인
            </button>
            <button
              className={`btn flex-1 ${authMode === "signup" ? "btn-dark" : ""}`}
              onClick={() => setAuthMode("signup")}
            >
              회원가입
            </button>
          </div>

          <div className="space-y-3">
            <input
              className="input w-full"
              placeholder="이메일"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="input w-full"
              placeholder="비밀번호"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <button
              className="btn btn-primary w-full"
              onClick={handleAuth}
              disabled={loading}
            >
              {loading
                ? "처리 중..."
                : authMode === "login"
                  ? "로그인"
                  : "회원가입"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 md:p-6">
      <div className="mx-auto max-w-[1480px]">
        <header className="glass rounded-[28px] px-5 py-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="badge badge-dark">ERP</div>
              <div className="badge badge-blue">Tax Evidence</div>
              {profile?.role === "admin" && <div className="badge">관리자</div>}
            </div>
            <h1 className="mt-3 text-2xl md:text-3xl font-black tracking-[-0.04em]">
              홈택스 매입·매출 및 증빙자료 관리
            </h1>
            <p className="mt-1 text-sm text-slate-500">{sessionEmail}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={createManualRecord}>
              <Plus size={16} />
              직접 추가
            </button>

            <button className="btn" onClick={() => csvInputRef.current?.click()}>
              <Upload size={16} />
              CSV 업로드
            </button>

            <button className="btn btn-primary" onClick={() => setExportOpen(true)}>
              <Download size={16} />
              내보내기
            </button>

            <div className="relative">
              <button className="btn" onClick={() => setAiOpen((v) => !v)}>
                AI 기능 <ChevronDown size={16} />
              </button>

              {aiOpen && (
                <div className="absolute right-0 mt-2 w-52 glass-strong rounded-2xl p-2 z-30">
                  <button className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100">
                    이상감지
                  </button>
                  <button className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100">
                    재무 브리핑
                  </button>
                  <button className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100">
                    부가세 요약
                  </button>
                  <button className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100">
                    증빙 누락 체크
                  </button>
                </div>
              )}
            </div>

            {profile?.role === "admin" && (
              <button
                className="btn"
                onClick={async () => {
                  await loadProfiles();
                  alert("관리자 패널이 아래에 표시됩니다.");
                }}
              >
                <Shield size={16} />
                권한관리
              </button>
            )}

            <button className="btn" onClick={logout}>
              <LogOut size={16} />
              로그아웃
            </button>
          </div>

          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCsvUpload(file);
            }}
          />
        </header>

        <section className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
          <div className="glass-strong rounded-3xl p-5">
            <p className="text-sm text-slate-500">매입 공급가</p>
            <p className="text-2xl font-black mt-2">{won(summary.purchase)}원</p>
          </div>
          <div className="glass-strong rounded-3xl p-5">
            <p className="text-sm text-slate-500">매출 공급가</p>
            <p className="text-2xl font-black mt-2">{won(summary.sales)}원</p>
          </div>
          <div className="glass-strong rounded-3xl p-5">
            <p className="text-sm text-slate-500">부가세 합계</p>
            <p className="text-2xl font-black mt-2">{won(summary.vat)}원</p>
          </div>
          <div className="glass-strong rounded-3xl p-5">
            <p className="text-sm text-slate-500">증빙 미연결</p>
            <p className="text-2xl font-black mt-2">{summary.missingEvidence}건</p>
          </div>
        </section>

        <section className="glass rounded-[28px] mt-4 p-4 relative overflow-visible">
          <div className="flex flex-wrap gap-2 items-center">
            <select
              className="input"
              value={csvType}
              onChange={(e) => setCsvType(e.target.value as TaxType)}
            >
              <option value="purchase">업로드 CSV: 매입</option>
              <option value="sales">업로드 CSV: 매출</option>
            </select>

            <input
              className="input"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />

            <input
              className="input"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />

            <select
              className="input"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as "all" | TaxType)}
            >
              <option value="all">전체</option>
              <option value="purchase">매입</option>
              <option value="sales">매출</option>
            </select>

            <div className="relative flex-1 min-w-[220px]">
              <Search
                size={16}
                className="absolute left-3 top-3 text-slate-400"
              />
              <input
                className="input w-full pl-9"
                placeholder="업체명, 사업자번호, 승인번호 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-4 mt-4">
          <section className="glass rounded-[28px] overflow-hidden">
            <div className="overflow-auto">
              <table className="w-full min-w-[1080px]">
                <thead>
                  <tr>
                    <th className="table-th">날짜</th>
                    <th className="table-th">구분</th>
                    <th className="table-th">상호</th>
                    <th className="table-th">출발</th>
                    <th className="table-th">도착</th>
                    <th className="table-th">지급</th>
                    <th className="table-th">차종</th>
                    <th className="table-th money">공급가액</th>
                    <th className="table-th money">부가세</th>
                    <th className="table-th">증빙</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((r) => {
                    const count = attachments.filter(
                      (a) => a.tax_record_id === r.id
                    ).length;
                    const isSelected = selected?.id === r.id;

                    return (
                      <tr
                        key={r.id}
                        className={`cursor-pointer hover:bg-white/70 ${
                          isSelected ? "bg-blue-50/80" : ""
                        }`}
                        onClick={() => setSelected(r)}
                      >
                        <td className="table-td">{r.record_date}</td>
                        <td className="table-td">
                          <span
                            className={`badge ${
                              r.type === "purchase"
                                ? "badge-gray"
                                : "badge-blue"
                            }`}
                          >
                            {r.type === "purchase" ? "매입" : "매출"}
                          </span>
                        </td>
                        <td className="table-td font-bold">{r.vendor_name}</td>
                        <td className="table-td">{r.departure || "-"}</td>
                        <td className="table-td">{r.destination || "-"}</td>
                        <td className="table-td">{r.payment_status || "-"}</td>
                        <td className="table-td">{r.vehicle_type || "-"}</td>
                        <td className="table-td money">
                          {won(r.supply_amount)}
                        </td>
                        <td className="table-td money">{won(r.vat_amount)}</td>
                        <td className="table-td">
                          {count > 0 ? (
                            <span className="badge badge-blue">
                              연결됨 {count}
                            </span>
                          ) : (
                            <span className="badge badge-gray">미연결</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filteredRecords.length === 0 && (
                <div className="p-12 text-center text-slate-500">
                  조회 조건에 맞는 거래내역이 없습니다.
                </div>
              )}
            </div>
          </section>

          <aside className="glass rounded-[28px] p-4 min-h-[560px]">
            {!selected ? (
              <div className="h-full flex items-center justify-center text-center text-slate-500">
                거래내역을 선택하면 증빙자료와 수정 화면이 열립니다.
              </div>
            ) : (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="badge badge-blue mb-2">1:1 증빙 매칭</div>
                    <h2 className="text-xl font-black tracking-[-0.03em]">
                      {selected.vendor_name}
                    </h2>
                    <p className="text-sm text-slate-500">
                      {selected.record_date} ·{" "}
                      {selected.type === "purchase" ? "매입" : "매출"}
                    </p>
                  </div>

                  {profile?.role === "admin" && (
                    <button className="btn" onClick={() => deleteRecord(selected)}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4">
                  <input
                    className="input"
                    type="date"
                    value={selected.record_date}
                    onChange={(e) =>
                      setSelected({ ...selected, record_date: e.target.value })
                    }
                  />
                  <select
                    className="input"
                    value={selected.type}
                    onChange={(e) =>
                      setSelected({
                        ...selected,
                        type: e.target.value as TaxType,
                      })
                    }
                  >
                    <option value="purchase">매입</option>
                    <option value="sales">매출</option>
                  </select>
                  <input
                    className="input col-span-2"
                    value={selected.vendor_name}
                    onChange={(e) =>
                      setSelected({ ...selected, vendor_name: e.target.value })
                    }
                    placeholder="상호"
                  />
                  <input
                    className="input"
                    value={selected.departure ?? ""}
                    onChange={(e) =>
                      setSelected({ ...selected, departure: e.target.value })
                    }
                    placeholder="출발"
                  />
                  <input
                    className="input"
                    value={selected.destination ?? ""}
                    onChange={(e) =>
                      setSelected({ ...selected, destination: e.target.value })
                    }
                    placeholder="도착"
                  />
                  <input
                    className="input"
                    value={selected.payment_status ?? ""}
                    onChange={(e) =>
                      setSelected({
                        ...selected,
                        payment_status: e.target.value,
                      })
                    }
                    placeholder="지급상태"
                  />
                  <input
                    className="input"
                    value={selected.vehicle_type ?? ""}
                    onChange={(e) =>
                      setSelected({
                        ...selected,
                        vehicle_type: e.target.value,
                      })
                    }
                    placeholder="차종"
                  />
                  <input
                    className="input"
                    type="number"
                    value={selected.supply_amount}
                    onChange={(e) =>
                      setSelected({
                        ...selected,
                        supply_amount: Number(e.target.value),
                        total_amount:
                          Number(e.target.value) + Number(selected.vat_amount),
                      })
                    }
                    placeholder="공급가액"
                  />
                  <input
                    className="input"
                    type="number"
                    value={selected.vat_amount}
                    onChange={(e) =>
                      setSelected({
                        ...selected,
                        vat_amount: Number(e.target.value),
                        total_amount:
                          Number(selected.supply_amount) +
                          Number(e.target.value),
                      })
                    }
                    placeholder="부가세"
                  />
                  <input
                    className="input col-span-2"
                    value={selected.approval_number ?? ""}
                    onChange={(e) =>
                      setSelected({
                        ...selected,
                        approval_number: e.target.value,
                      })
                    }
                    placeholder="홈택스 승인번호"
                  />
                  <textarea
                    className="input col-span-2 h-24 py-3"
                    value={selected.memo ?? ""}
                    onChange={(e) =>
                      setSelected({ ...selected, memo: e.target.value })
                    }
                    placeholder="메모"
                  />
                </div>

                <button
                  className="btn btn-primary w-full mt-3"
                  onClick={() => saveRecord(selected)}
                >
                  <Save size={16} />
                  수정 저장
                </button>

                <div className="mt-6">
                  <div className="flex items-center justify-between">
                    <h3 className="font-black">증빙자료</h3>
                    <span className="badge badge-gray">
                      {selectedAttachments.length}개
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <button
                      className="btn"
                      onClick={() => evidenceInputRef.current?.click()}
                    >
                      <FileText size={16} />
                      파일 추가
                    </button>
                    <button
                      className="btn"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera size={16} />
                      촬영 추가
                    </button>
                  </div>

                  <input
                    ref={evidenceInputRef}
                    hidden
                    type="file"
                    accept="image/*,.pdf,.xlsx,.xls"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadEvidence(file, "upload");
                    }}
                  />

                  <input
                    ref={cameraInputRef}
                    hidden
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadEvidence(file, "camera");
                    }}
                  />

                  <div className="space-y-2 mt-3">
                    {selectedAttachments.map((file) => (
                      <div
                        key={file.id}
                        className="rounded-2xl bg-white/80 border border-slate-200 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            className="text-left font-bold text-sm hover:underline"
                            onClick={() => openEvidence(file)}
                          >
                            {file.file_name}
                          </button>
                          <button onClick={() => deleteEvidence(file)}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          이 파일은 현재 선택된 거래내역에만 연결됩니다.
                        </p>
                      </div>
                    ))}

                    {selectedAttachments.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                        아직 연결된 증빙자료가 없습니다.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>

        {profile?.role === "admin" && profiles.length > 0 && (
          <section className="glass rounded-[28px] mt-4 p-4">
            <h2 className="text-xl font-black mb-3">관리자 권한 관리</h2>

            <div className="overflow-auto">
              <table className="w-full min-w-[680px]">
                <thead>
                  <tr>
                    <th className="table-th">이메일</th>
                    <th className="table-th">현재 권한</th>
                    <th className="table-th">변경</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={p.id}>
                      <td className="table-td font-bold">{p.email}</td>
                      <td className="table-td">
                        <span className="badge">{p.role}</span>
                      </td>
                      <td className="table-td">
                        <select
                          className="input"
                          value={p.role}
                          onChange={(e) =>
                            updateUserRole(
                              p.id,
                              e.target.value as "admin" | "user" | "viewer"
                            )
                          }
                        >
                          <option value="admin">admin</option>
                          <option value="user">user</option>
                          <option value="viewer">viewer</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {exportOpen && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <section className="glass-strong rounded-[28px] p-5 w-full max-w-lg">
              <h2 className="text-2xl font-black tracking-[-0.04em]">
                내보내기 조건 선택
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                현재 설정된 기간과 구분 조건을 기준으로 내려받습니다.
              </p>

              <div className="grid grid-cols-2 gap-2 mt-5">
                <input
                  className="input"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
                <input
                  className="input"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
                <select
                  className="input col-span-2"
                  value={typeFilter}
                  onChange={(e) =>
                    setTypeFilter(e.target.value as "all" | TaxType)
                  }
                >
                  <option value="all">전체</option>
                  <option value="purchase">매입</option>
                  <option value="sales">매출</option>
                </select>
              </div>

              <div className="grid grid-cols-1 gap-2 mt-5">
                <button
                  className="btn btn-primary"
                  onClick={() => exportData("csv")}
                >
                  CSV만 내려받기
                </button>

                <button className="btn" onClick={exportXlsx}>
                  엑셀 양식으로 내려받기
                </button>

                <button className="btn" onClick={() => exportData("zip")}>
                  CSV + 증빙자료 ZIP으로 내려받기
                </button>

                <button
                  className="btn"
                  onClick={() => exportData("pdf-merged")}
                >
                  증빙자료 하나의 통합 PDF로 내려받기
                </button>

                <button
                  className="btn"
                  onClick={() => exportData("pdf-separate")}
                >
                  증빙자료 각각 개별 파일로 내려받기
                </button>

                <button className="btn" onClick={() => setExportOpen(false)}>
                  닫기
                </button>
              </div>
            </section>
          </div>
        )}

        {loading && (
          <div className="fixed bottom-5 right-5 glass-strong rounded-2xl px-4 py-3 font-bold">
            처리 중...
          </div>
        )}
      </div>
    </main>
  );
}