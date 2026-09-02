"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, ADMIN_EMAIL } from "../../lib/supabaseClient";

const TABS = ["Overview", "Students", "Payments", "Expenses", "Announcements", "Payment Setup"];

export default function AdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("Overview");

  const [students, setStudents] = useState([]);
  const [payments, setPayments] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [fundSettings, setFundSettings] = useState(null);
  const [actions, setActions] = useState([]);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init() {
    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    if (!session?.user) {
      router.replace("/");
      return;
    }
    if (session.user.email !== ADMIN_EMAIL) {
      router.replace("/student");
      return;
    }
    setUser(session.user);
    await loadAll();
    setLoading(false);
  }

  async function loadAll() {
    const [studentsRes, paymentsRes, expensesRes, announceRes, fundRes, actionsRes] = await Promise.all([
      supabase.from("profiles").select("*").order("full_name", { ascending: true }),
      supabase
        .from("payments")
        .select("*, profiles(full_name, email)")
        .order("created_at", { ascending: false }),
      supabase
        .from("expenses")
        .select("*, expense_students(student_id, profiles(full_name))")
        .order("spent_on", { ascending: false }),
      supabase.from("announcements").select("*").order("created_at", { ascending: false }),
      supabase.from("fund_settings").select("*").eq("id", 1).single(),
      supabase.from("admin_actions").select("*").order("created_at", { ascending: false }).limit(15),
    ]);
    setStudents(studentsRes.data || []);
    setPayments(paymentsRes.data || []);
    setExpenses(expensesRes.data || []);
    setAnnouncements(announceRes.data || []);
    setFundSettings(fundRes.data || null);
    setActions(actionsRes.data || []);
  }

  async function logAction(action, details) {
    await supabase.from("admin_actions").insert({ action, details, performed_by: user.id });
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const [studentsRes, paymentsRes, expensesRes, announceRes] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("payments").select("*, profiles(full_name,email)"),
      supabase.from("expenses").select("*"),
      supabase.from("announcements").select("*"),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        (studentsRes.data || []).map((s) => ({
          Name: s.full_name,
          Email: s.email,
          Phone: s.phone,
          Contribution: s.total_contribution,
          Active: s.active,
          ExcludedFromTotal: s.contribution_excluded,
        }))
      ),
      "Students"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        (paymentsRes.data || []).map((p) => ({
          Student: p.profiles?.full_name || p.profiles?.email,
          Amount: p.amount,
          Status: p.status,
          Note: p.note,
          SubmittedAt: p.created_at,
          VerifiedAt: p.verified_at,
        }))
      ),
      "Payments"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        (expensesRes.data || []).map((e) => ({
          Title: e.title,
          Amount: e.amount,
          Date: e.spent_on,
          Note: e.note,
        }))
      ),
      "Expenses"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        (announceRes.data || []).map((a) => ({
          Title: a.title,
          Body: a.body,
          PostedAt: a.created_at,
        }))
      ),
      "Announcements"
    );
    XLSX.writeFile(wb, `class-fund-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  if (loading) return <div className="loading">Loading admin panel…</div>;

  const pendingCount = payments.filter((p) => p.status === "pending").length;

  return (
    <div className="page">
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark">◆</span> Class Fund <span style={{ color: "var(--brass)", fontSize: 12 }}>Admin</span>
        </div>
        <div className="topbar-right">
          {user?.email}
          <button className="signout" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t} {t === "Payments" && pendingCount > 0 ? `(${pendingCount})` : ""}
          </button>
        ))}
      </div>

      <div className="content">
        {tab === "Overview" && (
          <AdminOverview
            students={students}
            payments={payments}
            expenses={expenses}
            fundSettings={fundSettings}
            actions={actions}
            onExport={exportExcel}
          />
        )}
        {tab === "Students" && (
          <Students students={students} fundSettings={fundSettings} onChanged={loadAll} onLog={logAction} />
        )}
        {tab === "Payments" && (
          <Payments payments={payments} fundSettings={fundSettings} onChanged={loadAll} onLog={logAction} />
        )}
        {tab === "Expenses" && (
          <Expenses expenses={expenses} students={students} onChanged={loadAll} userId={user.id} />
        )}
        {tab === "Announcements" && <Announcements items={announcements} onChanged={loadAll} userId={user.id} />}
        {tab === "Payment Setup" && <PaymentSetup fundSettings={fundSettings} onChanged={loadAll} />}
      </div>
    </div>
  );
}

function AdminOverview({ students, payments, expenses, fundSettings, actions, onExport }) {
  const pending = payments.filter((p) => p.status === "pending");
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const goal = Number(fundSettings?.goal_amount || 0);
  const collected = Number(fundSettings?.total_collection || 0);
  const pct = goal > 0 ? Math.min(100, Math.round((collected / goal) * 100)) : null;

  return (
    <div>
      <div className="ledger-card">
        <div className="ledger-row">
          <span className="ledger-label">Total collection</span>
          <span className="ledger-amount big">₹{collected.toLocaleString("en-IN")}</span>
        </div>
        <div className="ledger-row">
          <span className="ledger-label">Total spent</span>
          <span className="ledger-amount">₹{totalExpenses.toLocaleString("en-IN")}</span>
        </div>
        <div className="ledger-row">
          <span className="ledger-label">Balance in hand</span>
          <span className="ledger-amount">₹{(collected - totalExpenses).toLocaleString("en-IN")}</span>
        </div>
        {goal > 0 && (
          <div style={{ paddingTop: 12 }}>
            <div className="ledger-row" style={{ border: "none", padding: "0 0 4px" }}>
              <span className="ledger-label">Goal: ₹{goal.toLocaleString("en-IN")}</span>
              <span className="ledger-label">{pct}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="ledger-card">
        <div className="ledger-row">
          <span className="ledger-label">Students</span>
          <span className="ledger-amount">{students.length}</span>
        </div>
        <div className="ledger-row">
          <span className="ledger-label">Payments awaiting verification</span>
          <span className="ledger-amount">{pending.length}</span>
        </div>
      </div>

      <button className="btn" style={{ marginTop: 4 }} onClick={onExport}>
        Download all data (Excel)
      </button>

      <div className="section-title">
        Recent admin activity <span className="rule" />
      </div>
      {actions.length === 0 && <div className="empty">No corrections logged yet.</div>}
      {actions.map((a) => (
        <div className="card" key={a.id}>
          <div className="card-title">{a.action}</div>
          {a.details && <div className="card-sub" style={{ marginTop: 4 }}>{a.details}</div>}
          <div className="card-sub" style={{ marginTop: 4 }}>
            {new Date(a.created_at).toLocaleString("en-IN")}
          </div>
        </div>
      ))}
    </div>
  );
}

function Students({ students, fundSettings, onChanged, onLog }) {
  const [confirmId, setConfirmId] = useState(null);
  const [resetId, setResetId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  async function deactivate(s, removeFromTotal) {
    setBusy(true);
    await supabase.from("profiles").update({ active: false, contribution_excluded: removeFromTotal }).eq("id", s.id);
    if (removeFromTotal) {
      const newTotal = Number(fundSettings?.total_collection || 0) - Number(s.total_contribution || 0);
      await supabase.from("fund_settings").update({ total_collection: newTotal, updated_at: new Date().toISOString() }).eq("id", 1);
    }
    await onLog(
      "Deactivated student",
      `${s.full_name || s.email} — ${removeFromTotal ? "removed" : "kept"} ₹${Number(s.total_contribution || 0).toLocaleString("en-IN")} in total`
    );
    setBusy(false);
    setConfirmId(null);
    onChanged();
  }

  async function reactivate(s) {
    setBusy(true);
    await supabase.from("profiles").update({ active: true, contribution_excluded: false }).eq("id", s.id);
    if (s.contribution_excluded) {
      const newTotal = Number(fundSettings?.total_collection || 0) + Number(s.total_contribution || 0);
      await supabase.from("fund_settings").update({ total_collection: newTotal, updated_at: new Date().toISOString() }).eq("id", 1);
    }
    await onLog("Reactivated student", `${s.full_name || s.email}`);
    setBusy(false);
    onChanged();
  }

  async function resetContribution(s) {
    setBusy(true);
    const oldAmount = Number(s.total_contribution || 0);
    await supabase.from("profiles").update({ total_contribution: 0 }).eq("id", s.id);
    if (!s.contribution_excluded) {
      const newTotal = Number(fundSettings?.total_collection || 0) - oldAmount;
      await supabase.from("fund_settings").update({ total_collection: newTotal, updated_at: new Date().toISOString() }).eq("id", 1);
    }
    await onLog("Reset contribution", `${s.full_name || s.email} — was ₹${oldAmount.toLocaleString("en-IN")}, reset to ₹0`);
    setBusy(false);
    setResetId(null);
    onChanged();
  }

  const filtered = students.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (s.full_name || "").toLowerCase().includes(q) || (s.email || "").toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="section-title">
        Students ({students.length}) <span className="rule" />
      </div>
      <div className="field">
        <input type="text" placeholder="Search by name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-sub" style={{ lineHeight: 1.5 }}>
          Students appear here automatically the first time they sign in with Google — there's nothing to
          add manually. To fully delete a person's account, remove them from the Supabase dashboard under
          Authentication.
        </div>
      </div>
      {filtered.map((s) => (
        <div className="card" key={s.id}>
          <div className="card-row">
            <div>
              <div className="card-title">{s.full_name || "(no name yet)"}</div>
              <div className="card-sub">{s.email}</div>
              <div className="card-sub">
                Contribution: ₹{Number(s.total_contribution || 0).toLocaleString("en-IN")}
                {s.active === false && s.contribution_excluded ? " (excluded from total)" : ""}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {s.active === false ? (
              <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => reactivate(s)}>
                Reactivate
              </button>
            ) : confirmId === s.id ? (
              <>
                <button className="btn btn-small" disabled={busy} onClick={() => deactivate(s, false)}>
                  Deactivate — keep in total
                </button>
                <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => deactivate(s, true)}>
                  Deactivate — remove from total
                </button>
                <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirmId(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn btn-ghost btn-small" onClick={() => setConfirmId(s.id)}>
                Deactivate
              </button>
            )}

            {resetId === s.id ? (
              <>
                <button className="btn btn-danger btn-small" disabled={busy} onClick={() => resetContribution(s)}>
                  Confirm reset to ₹0
                </button>
                <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => setResetId(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn btn-ghost btn-small" onClick={() => setResetId(s.id)}>
                Reset contribution
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Payments({ payments, fundSettings, onChanged, onLog }) {
  const [busyId, setBusyId] = useState(null);

  async function setStatus(p, status) {
    setBusyId(p.id);
    await supabase.from("payments").update({ status }).eq("id", p.id);
    setBusyId(null);
    onChanged();
  }

  async function deletePayment(p) {
    setBusyId(p.id);
    if (p.status === "verified") {
      const { data: profile } = await supabase.from("profiles").select("total_contribution").eq("id", p.student_id).single();
      const newContribution = Number(profile?.total_contribution || 0) - Number(p.amount);
      await supabase.from("profiles").update({ total_contribution: newContribution }).eq("id", p.student_id);
      const newTotal = Number(fundSettings?.total_collection || 0) - Number(p.amount);
      await supabase.from("fund_settings").update({ total_collection: newTotal, updated_at: new Date().toISOString() }).eq("id", 1);
    }
    await supabase.from("payments").delete().eq("id", p.id);
    await onLog(
      "Deleted payment",
      `${p.profiles?.full_name || p.profiles?.email} — ₹${Number(p.amount).toLocaleString("en-IN")} (was ${p.status})`
    );
    setBusyId(null);
    onChanged();
  }

  const pending = payments.filter((p) => p.status === "pending");
  const resolved = payments.filter((p) => p.status !== "pending");

  return (
    <div>
      <div className="section-title">
        Awaiting verification <span className="rule" />
      </div>
      {pending.length === 0 && <div className="empty">Nothing to verify right now.</div>}
      {pending.map((p) => (
        <div className="card" key={p.id}>
          <div className="card-row">
            <div>
              <div className="card-title">{p.profiles?.full_name || p.profiles?.email}</div>
              <div className="card-sub">
                ₹{Number(p.amount).toLocaleString("en-IN")} ·{" "}
                {new Date(p.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                {p.note ? ` · ${p.note}` : ""}
              </div>
            </div>
          </div>
          {p.screenshot_url && (
            <a href={p.screenshot_url} target="_blank" rel="noreferrer">
              <img
                src={p.screenshot_url}
                alt="Payment proof"
                style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 8, marginTop: 8 }}
              />
            </a>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button className="btn btn-small" disabled={busyId === p.id} onClick={() => setStatus(p, "verified")}>
              Verify
            </button>
            <button className="btn btn-ghost btn-small" disabled={busyId === p.id} onClick={() => setStatus(p, "rejected")}>
              Reject
            </button>
            <button className="btn btn-ghost btn-small" disabled={busyId === p.id} onClick={() => deletePayment(p)}>
              Delete
            </button>
          </div>
        </div>
      ))}

      <div className="section-title">
        History <span className="rule" />
      </div>
      {resolved.slice(0, 30).map((p) => (
        <div className="card" key={p.id}>
          <div className="card-row">
            <div>
              <div className="card-title">{p.profiles?.full_name || p.profiles?.email}</div>
              <div className="card-sub">
                ₹{Number(p.amount).toLocaleString("en-IN")} ·{" "}
                {new Date(p.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </div>
            </div>
            <span className={`stamp ${p.status}`}>{p.status}</span>
          </div>
          {p.screenshot_url && (
            <a href={p.screenshot_url} target="_blank" rel="noreferrer">
              <img
                src={p.screenshot_url}
                alt="Payment proof"
                style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 8, marginTop: 8 }}
              />
            </a>
          )}
          <button
            className="btn btn-ghost btn-small"
            style={{ marginTop: 8 }}
            disabled={busyId === p.id}
            onClick={() => deletePayment(p)}
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}

function Expenses({ expenses, students, onChanged, userId }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [spentOn, setSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [applyWhole, setApplyWhole] = useState(true);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    const { data: inserted, error } = await supabase
      .from("expenses")
      .insert({
        title,
        amount: parseFloat(amount),
        spent_on: spentOn,
        note: note || null,
        created_by: userId,
      })
      .select()
      .single();

    if (!error && inserted && !applyWhole && selectedStudents.length > 0) {
      const rows = selectedStudents.map((sid) => ({ expense_id: inserted.id, student_id: sid }));
      await supabase.from("expense_students").insert(rows);
    }

    setBusy(false);
    setTitle("");
    setAmount("");
    setNote("");
    setApplyWhole(true);
    setSelectedStudents([]);
    onChanged();
  }

  async function remove(id) {
    await supabase.from("expenses").delete().eq("id", id);
    onChanged();
  }

  return (
    <div>
      <div className="section-title">
        Add expense <span className="rule" />
      </div>
      <form onSubmit={add}>
        <div className="field">
          <label>Title</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="field">
          <label>Amount (₹)</label>
          <input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div className="field">
          <label>Date</label>
          <input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} required />
        </div>
        <div className="field">
          <label>Note (optional)</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="field">
          <label>Applies to</label>
          <div style={{ display: "flex", gap: 8, marginBottom: applyWhole ? 0 : 10 }}>
            <button
              type="button"
              className={`btn btn-small ${applyWhole ? "" : "btn-ghost"}`}
              onClick={() => setApplyWhole(true)}
            >
              Whole class
            </button>
            <button
              type="button"
              className={`btn btn-small ${!applyWhole ? "" : "btn-ghost"}`}
              onClick={() => setApplyWhole(false)}
            >
              Specific students
            </button>
          </div>
          {!applyWhole && (
            <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 9, padding: 10 }}>
              {students.map((s) => (
                <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13.5 }}>
                  <input
                    type="checkbox"
                    checked={selectedStudents.includes(s.id)}
                    onChange={(e) => {
                      setSelectedStudents((prev) =>
                        e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                      );
                    }}
                  />
                  {s.full_name || s.email}
                </label>
              ))}
            </div>
          )}
        </div>

        <button className="btn" disabled={busy} type="submit">
          {busy ? "Adding…" : "Add expense"}
        </button>
      </form>

      <div className="section-title">
        All expenses <span className="rule" />
      </div>
      {expenses.map((e) => {
        const tagged = e.expense_students || [];
        const appliesTo = tagged.length > 0 ? tagged.map((t) => t.profiles?.full_name).filter(Boolean).join(", ") : "Whole class";
        return (
          <div className="card" key={e.id}>
            <div className="card-row">
              <div>
                <div className="card-title">{e.title}</div>
                <div className="card-sub">
                  {new Date(e.spent_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  {e.note ? ` · ${e.note}` : ""}
                </div>
                <div className="card-sub" style={{ marginTop: 4 }}>Applies to: {appliesTo}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="card-amount">₹{Number(e.amount).toLocaleString("en-IN")}</div>
                <button className="btn btn-ghost btn-small" onClick={() => remove(e.id)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Announcements({ items, onChanged, userId }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    await supabase.from("announcements").insert({ title, body, created_by: userId });
    setBusy(false);
    setTitle("");
    setBody("");
    onChanged();
  }

  async function remove(id) {
    await supabase.from("announcements").delete().eq("id", id);
    onChanged();
  }

  return (
    <div>
      <div className="section-title">
        Post announcement <span className="rule" />
      </div>
      <form onSubmit={add}>
        <div className="field">
          <label>Title</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="field">
          <label>Message</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} required />
        </div>
        <button className="btn" disabled={busy} type="submit">
          {busy ? "Posting…" : "Post announcement"}
        </button>
      </form>

      <div className="section-title">
        Posted <span className="rule" />
      </div>
      {items.map((a) => (
        <div className="card" key={a.id}>
          <div className="card-row">
            <div className="card-title">{a.title}</div>
            <button className="btn btn-ghost btn-small" onClick={() => remove(a.id)}>
              Delete
            </button>
          </div>
          <div className="card-sub" style={{ marginTop: 6, lineHeight: 1.5 }}>
            {a.body}
          </div>
        </div>
      ))}
    </div>
  );
}

function PaymentSetup({ fundSettings, onChanged }) {
  const [upiId, setUpiId] = useState(fundSettings?.upi_id || "");
  const [payeeName, setPayeeName] = useState(fundSettings?.payee_name || "");
  const [goalAmount, setGoalAmount] = useState(fundSettings?.goal_amount || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const qrUrl = upiId
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
        `upi://pay?pa=${upiId}&pn=${encodeURIComponent(payeeName || "Class Fund")}&cu=INR`
      )}`
    : null;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase
      .from("fund_settings")
      .update({
        upi_id: upiId,
        payee_name: payeeName,
        goal_amount: goalAmount ? parseFloat(goalAmount) : null,
      })
      .eq("id", 1);
    setBusy(false);
    if (error) {
      setMsg({ type: "err", text: error.message });
      return;
    }
    setMsg({ type: "ok", text: "Payment details updated. The QR below is what students will see." });
    onChanged();
  }

  return (
    <div>
      <div className="section-title">
        Payment details <span className="rule" />
      </div>
      <form onSubmit={save}>
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        <div className="field">
          <label>UPI ID</label>
          <input type="text" value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="yourname@bank" required />
        </div>
        <div className="field">
          <label>Payee name (shown to students)</label>
          <input type="text" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="Class Fund" />
        </div>
        <div className="field">
          <label>Fund goal / target (₹, optional)</label>
          <input
            type="number"
            min="0"
            value={goalAmount}
            onChange={(e) => setGoalAmount(e.target.value)}
            placeholder="e.g. 50000"
          />
        </div>
        <button className="btn" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save payment details"}
        </button>
      </form>

      {qrUrl && (
        <div className="ledger-card" style={{ marginTop: 18 }}>
          <div className="qr-box">
            <img src={qrUrl} alt="UPI QR preview" />
            <div className="card-sub">This QR is generated automatically from your UPI ID — nothing to upload.</div>
          </div>
        </div>
      )}
    </div>
  );
}
