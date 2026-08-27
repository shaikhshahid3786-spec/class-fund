"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, ADMIN_EMAIL } from "../../lib/supabaseClient";

const TABS = ["Overview", "Add Fund", "Announcements", "Expenses", "Profile"];

export default function StudentPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [fundSettings, setFundSettings] = useState(null);
  const [payments, setPayments] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [activeCount, setActiveCount] = useState(1);
  const [tab, setTab] = useState("Overview");

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
    if (session.user.email === ADMIN_EMAIL) {
      router.replace("/admin");
      return;
    }
    setUser(session.user);
    await loadAll(session.user.id);
    setLoading(false);
  }

  async function loadAll(userId) {
    const [profileRes, fundRes, paymentsRes, announceRes, expenseRes, countRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).single(),
      supabase.from("fund_settings").select("*").eq("id", 1).single(),
      supabase.from("payments").select("*").eq("student_id", userId).order("created_at", { ascending: false }),
      supabase.from("announcements").select("*").order("created_at", { ascending: false }).limit(20),
      supabase
        .from("expenses")
        .select("*, expense_students(student_id, profiles(full_name))")
        .order("spent_on", { ascending: false })
        .limit(30),
      supabase.rpc("active_student_count"),
    ]);
    setProfile(profileRes.data || null);
    setFundSettings(fundRes.data || null);
    setPayments(paymentsRes.data || []);
    setAnnouncements(announceRes.data || []);
    setExpenses(expenseRes.data || []);
    setActiveCount(countRes.data || 1);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (loading) return <div className="loading">Loading your fund page…</div>;

  const myShare = computeMyShare(expenses, user.id, activeCount);
  const netContribution = Number(profile?.total_contribution || 0) - myShare;

  return (
    <div className="page">
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark">◆</span> Class Fund
        </div>
        <div className="topbar-right">
          {profile?.full_name || user?.email}
          <button className="signout" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <div className="content">
        {tab === "Overview" && (
          <Overview profile={profile} fundSettings={fundSettings} payments={payments} myShare={myShare} netContribution={netContribution} />
        )}
        {tab === "Add Fund" && (
          <AddFund
            userId={user.id}
            fundSettings={fundSettings}
            payments={payments}
            onSubmitted={() => loadAll(user.id)}
          />
        )}
        {tab === "Announcements" && <Announcements items={announcements} />}
        {tab === "Expenses" && <Expenses items={expenses} userId={user.id} activeCount={activeCount} />}
        {tab === "Profile" && (
          <Profile
            user={user}
            profile={profile}
            onSaved={() => loadAll(user.id)}
          />
        )}
      </div>
    </div>
  );
}

function computeMyShare(expenses, userId, activeCount) {
  let share = 0;
  for (const e of expenses) {
    const tagged = e.expense_students || [];
    if (tagged.length > 0) {
      const included = tagged.some((t) => t.student_id === userId);
      if (included) share += Number(e.amount) / tagged.length;
    } else {
      share += Number(e.amount) / Math.max(activeCount, 1);
    }
  }
  return share;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function Overview({ profile, fundSettings, payments, myShare, netContribution }) {
  const lastPayment = payments[0];
  const days = daysSince(lastPayment?.created_at);

  let reminder = null;
  if (days === null) {
    reminder = "You haven't added a contribution yet — head to Add Fund to make your first one.";
  } else if (days >= 30) {
    reminder = `It's been ${days} days since your last contribution. Your monthly top-up is due.`;
  } else if (days >= 7) {
    reminder = `It's been ${days} days since your last contribution. A weekly top-up keeps you on track.`;
  }

  return (
    <div>
      {reminder && (
        <div className="banner">
          <strong>Reminder — </strong>
          {reminder}
        </div>
      )}

      <div className="ledger-card">
        <div className="ledger-row">
          <span className="ledger-label">Total class collection</span>
          <span className="ledger-amount big">₹{Number(fundSettings?.total_collection || 0).toLocaleString("en-IN")}</span>
        </div>
        <div className="ledger-row">
          <span className="ledger-label">My contribution (net)</span>
          <span className="ledger-amount">₹{netContribution.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
        </div>
        <div className="ledger-row">
          <span className="ledger-label">Total paid in</span>
          <span className="ledger-amount" style={{ fontSize: 15 }}>₹{Number(profile?.total_contribution || 0).toLocaleString("en-IN")}</span>
        </div>
        <div className="ledger-row">
          <span className="ledger-label">My share of expenses</span>
          <span className="ledger-amount" style={{ fontSize: 15, color: "var(--rust)" }}>
            −₹{myShare.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </span>
        </div>
      </div>

      <div className="section-title">
        Recent activity <span className="rule" />
      </div>
      {payments.length === 0 && <div className="empty">No contributions submitted yet.</div>}
      {payments.slice(0, 6).map((p) => (
        <div className="card" key={p.id}>
          <div className="card-row">
            <div>
              <div className="card-title">₹{Number(p.amount).toLocaleString("en-IN")}</div>
              <div className="card-sub">{new Date(p.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
            </div>
            <span className={`stamp ${p.status}`}>{p.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function AddFund({ userId, fundSettings, payments, onSubmitted }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const upiId = fundSettings?.upi_id;
  const payeeName = fundSettings?.payee_name || "Class Fund";
  const qrUrl = upiId
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
        `upi://pay?pa=${upiId}&pn=${encodeURIComponent(payeeName)}&cu=INR`
      )}`
    : null;

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setMsg({ type: "err", text: "Enter a valid amount." });
      return;
    }
    if (!screenshotFile) {
      setMsg({ type: "err", text: "Please attach a screenshot of your payment as proof." });
      return;
    }
    setBusy(true);

    const ext = screenshotFile.name.split(".").pop();
    const path = `${userId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("payment-proofs").upload(path, screenshotFile);
    if (upErr) {
      setBusy(false);
      setMsg({ type: "err", text: "Screenshot upload failed: " + upErr.message });
      return;
    }
    const { data: pub } = supabase.storage.from("payment-proofs").getPublicUrl(path);

    const { error } = await supabase.from("payments").insert({
      student_id: userId,
      amount: amt,
      note: note || null,
      status: "pending",
      screenshot_url: pub.publicUrl,
    });
    setBusy(false);
    if (error) {
      setMsg({ type: "err", text: error.message });
      return;
    }
    setAmount("");
    setNote("");
    setScreenshotFile(null);
    setMsg({ type: "ok", text: "Submitted. It will show as verified once the admin confirms your payment." });
    onSubmitted();
  }

  async function deletePending(id) {
    await supabase.from("payments").delete().eq("id", id);
    onSubmitted();
  }

  return (
    <div>
      <div className="section-title">
        Pay via UPI <span className="rule" />
      </div>
      {upiId ? (
        <div className="ledger-card">
          <div className="qr-box">
            {qrUrl && <img src={qrUrl} alt="UPI QR code" />}
            <div className="upi-id">{upiId}</div>
            <div className="card-sub">Scan or pay to this UPI ID, then log it below.</div>
          </div>
        </div>
      ) : (
        <div className="empty">The admin hasn't set up a payment UPI ID yet.</div>
      )}

      <div className="section-title">
        Log your contribution <span className="rule" />
      </div>
      <form onSubmit={submit}>
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        <div className="field">
          <label>Amount paid (₹)</label>
          <input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div className="field">
          <label>Reference / UTR number (optional)</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. UPI ref number" />
        </div>
        <div className="field">
          <label>Payment screenshot (required)</label>
          <input
            type="file"
            accept="image/*"
            required
            onChange={(e) => setScreenshotFile(e.target.files[0] || null)}
          />
        </div>
        <button className="btn" disabled={busy} type="submit">
          {busy ? "Submitting…" : "Submit for verification"}
        </button>
      </form>

      <div className="section-title">
        My submissions <span className="rule" />
      </div>
      {payments.length === 0 && <div className="empty">Nothing submitted yet.</div>}
      {payments.map((p) => (
        <div className="card" key={p.id}>
          <div className="card-row">
            <div>
              <div className="card-title">₹{Number(p.amount).toLocaleString("en-IN")}</div>
              <div className="card-sub">
                {new Date(p.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                {p.note ? ` · ${p.note}` : ""}
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
          {p.status === "pending" && (
            <button
              className="btn btn-ghost btn-small"
              style={{ marginTop: 10 }}
              onClick={() => deletePending(p.id)}
            >
              Delete this entry
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Announcements({ items }) {
  return (
    <div>
      <div className="section-title">
        Announcements <span className="rule" />
      </div>
      {items.length === 0 && <div className="empty">No announcements yet.</div>}
      {items.map((a) => (
        <div className="card" key={a.id}>
          <div className="card-title">{a.title}</div>
          <div className="card-sub" style={{ marginTop: 6, lineHeight: 1.5 }}>
            {a.body}
          </div>
          <div className="card-sub" style={{ marginTop: 8 }}>
            {new Date(a.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Expenses({ items, userId, activeCount }) {
  const total = items.reduce((sum, e) => sum + Number(e.amount), 0);
  return (
    <div>
      <div className="ledger-card">
        <div className="ledger-row">
          <span className="ledger-label">Total spent</span>
          <span className="ledger-amount big">₹{total.toLocaleString("en-IN")}</span>
        </div>
      </div>
      <div className="section-title">
        Expense log <span className="rule" />
      </div>
      {items.length === 0 && <div className="empty">No expenses recorded yet.</div>}
      {items.map((e) => {
        const tagged = e.expense_students || [];
        const appliesTo =
          tagged.length > 0 ? tagged.map((t) => t.profiles?.full_name).filter(Boolean).join(", ") : "Whole class";
        const includesMe = tagged.length > 0 ? tagged.some((t) => t.student_id === userId) : true;
        const myShare = includesMe ? Number(e.amount) / (tagged.length > 0 ? tagged.length : Math.max(activeCount, 1)) : 0;
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
                {includesMe && (
                  <div className="card-sub" style={{ marginTop: 2, color: "var(--rust)" }}>
                    My share: −₹{myShare.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </div>
                )}
              </div>
              <div className="card-amount">₹{Number(e.amount).toLocaleString("en-IN")}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Profile({ user, profile, onSaved }) {
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName, phone })
      .eq("id", user.id);
    setBusy(false);
    if (error) {
      setMsg({ type: "err", text: error.message });
      return;
    }
    setMsg({ type: "ok", text: "Profile updated." });
    onSaved();
  }

  return (
    <div>
      <div className="section-title">
        Profile <span className="rule" />
      </div>
      <form onSubmit={save}>
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        <div className="field">
          <label>Email</label>
          <input type="text" value={user.email} disabled />
        </div>
        <div className="field">
          <label>Full name</label>
          <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div className="field">
          <label>Phone (optional)</label>
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <button className="btn" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
