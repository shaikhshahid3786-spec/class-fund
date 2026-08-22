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
    const [studentsRes, paymentsRes, expensesRes, announceRes, fundRes] = await Promise.all([
      supabase.from("profiles").select("*").order("full_name", { ascending: true }),
      supabase
        .from("payments")
        .select("*, profiles(full_name, email)")
        .order("created_at", { ascending: false }),
      supabase.from("expenses").select("*").order("spent_on", { ascending: false }),
      supabase.from("announcements").select("*").order("created_at", { ascending: false }),
      supabase.from("fund_settings").select("*").eq("id", 1).single(),
    ]);
    setStudents(studentsRes.data || []);
    setPayments(paymentsRes.data || []);
    setExpenses(expensesRes.data || []);
    setAnnouncements(announceRes.data || []);
    setFundSettings(fundRes.data || null);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
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
          <AdminOverview students={students} payments={payments} expenses={expenses} fundSettings={fundSettings} />
        )}
        {tab === "Students" && <Students students={students} onChanged={loadAll} />}
        {tab === "Payments" && <Payments payments={payments} onChanged={loadAll} />}
        {tab === "Expenses" && <Expenses expenses={expenses} onChanged={loadAll} userId={user.id} />}
        {tab === "Announcements" && <Announcements items={announcements} onChanged={loadAll} userId={user.id} />}
        {tab === "Payment Setup" && <PaymentSetup fundSettings={fundSettings} onChanged={loadAll} />}
      </div>
    </div>
  );
}

function AdminOverview({ students, payments, expenses, fundSettings }) {
  const pending = payments.filter((p) => p.status === "pending");
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div>
      <div className="ledger-card">
        <div className="ledger-row">
          <span className="ledger-label">Total collection</span>
          <span className="ledger-amount big">₹{Number(fundSettings?.total_collection || 0).toLocaleString("en-IN")}</span>
        </div>
        <div className="ledger-row">
          <span className="ledger-label">Total spent</span>
          <span className="ledger-amount">₹{totalExpenses.toLocaleString("en-IN")}</span>
        </div>
        <div className="ledger-row">
          <span className="ledger-label">Balance in hand</span>
          <span className="ledger-amount">₹{(Number(fundSettings?.total_collection || 0) - totalExpenses).toLocaleString("en-IN")}</span>
        </div>
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
    </div>
  );
}

function Students({ students, onChanged }) {
  async function toggleActive(s) {
    await supabase.from("profiles").update({ active: !s.active }).eq("id", s.id);
    onChanged();
  }

  return (
    <div>
      <div className="section-title">
        Students ({students.length}) <span className="rule" />
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-sub" style={{ lineHeight: 1.5 }}>
          Students appear here automatically the first time they sign in with Google — there's nothing to
          add manually. Use <strong style={{ color: "var(--brass-bright)" }}>Deactivate</strong> to hide
          someone who has left the class. To fully delete a person's account, remove them from the
          Supabase dashboard under Authentication.
        </div>
      </div>
      {students.map((s) => (
        <div className="card" key={s.id}>
          <div className="card-row">
            <div>
              <div className="card-title">{s.full_name || "(no name yet)"}</div>
              <div className="card-sub">{s.email}</div>
              <div className="card-sub">Contribution: ₹{Number(s.total_contribution || 0).toLocaleString("en-IN")}</div>
            </div>
            <button className="btn btn-ghost btn-small" onClick={() => toggleActive(s)}>
              {s.active === false ? "Reactivate" : "Deactivate"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Payments({ payments, onChanged }) {
  const [busyId, setBusyId] = useState(null);

  async function setStatus(p, status) {
    setBusyId(p.id);
    await supabase.from("payments").update({ status }).eq("id", p.id);
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
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn btn-small" disabled={busyId === p.id} onClick={() => setStatus(p, "verified")}>
              Verify
            </button>
            <button className="btn btn-ghost btn-small" disabled={busyId === p.id} onClick={() => setStatus(p, "rejected")}>
              Reject
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
        </div>
      ))}
    </div>
  );
}

function Expenses({ expenses, onChanged, userId }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [spentOn, setSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    await supabase.from("expenses").insert({
      title,
      amount: parseFloat(amount),
      spent_on: spentOn,
      note: note || null,
      created_by: userId,
    });
    setBusy(false);
    setTitle("");
    setAmount("");
    setNote("");
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
        <button className="btn" disabled={busy} type="submit">
          {busy ? "Adding…" : "Add expense"}
        </button>
      </form>

      <div className="section-title">
        All expenses <span className="rule" />
      </div>
      {expenses.map((e) => (
        <div className="card" key={e.id}>
          <div className="card-row">
            <div>
              <div className="card-title">{e.title}</div>
              <div className="card-sub">
                {new Date(e.spent_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                {e.note ? ` · ${e.note}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="card-amount">₹{Number(e.amount).toLocaleString("en-IN")}</div>
              <button className="btn btn-ghost btn-small" onClick={() => remove(e.id)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
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
      .update({ upi_id: upiId, payee_name: payeeName })
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
