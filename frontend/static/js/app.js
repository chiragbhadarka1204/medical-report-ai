/* ============================================================
   Medical Report AI — Application State & API Layer
   ============================================================ */

const API = {
  base: "/api",
  token: null,
  user: null,

  headers() {
    const h = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  },

  async post(path, body) {
    const r = await fetch(this.base + path, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return r;
  },

  async get(path) {
    const r = await fetch(this.base + path, {
      method: "GET",
      headers: this.headers(),
    });
    return r;
  },

  async delete(path) {
    const r = await fetch(this.base + path, {
      method: "DELETE",
      headers: this.headers(),
    });
    return r;
  },

  async uploadFile(path, formData) {
    const headers = {};
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const r = await fetch(this.base + path, {
      method: "POST",
      headers,
      body: formData,
    });
    return r;
  },
};

// ============================================================
// Toast notifications
// ============================================================
function showToast(msg, type = "info", duration = 3500) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ============================================================
// Page routing
// ============================================================
function showPage(pageId) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  const target = document.getElementById("page-" + pageId);
  if (target) target.classList.add("active");

  document.querySelectorAll(".sidebar-nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === pageId);
  });

  // Load data for pages
  if (pageId === "dashboard") loadDashboard();
  if (pageId === "documents") loadDocuments();
  if (pageId === "summary") loadSummaryPage();
  if (pageId === "qa") loadQAHistory();
}

// ============================================================
// AUTH
// ============================================================
let _loginUserId = null;

async function doLogin(e) {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const phone = document.getElementById("login-phone").value.trim();
  const errEl = document.getElementById("login-error");
  const btn = document.getElementById("btn-continue");

  if (!email || !phone) {
    errEl.textContent = "Please enter your email and phone number.";
    errEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> Sending OTP…';
  errEl.style.display = "none";

  try {
    const r = await API.post("/auth/login", { email, phone });
    const data = await r.json();
    if (!r.ok) {
      errEl.textContent = data.error || "Login failed.";
      errEl.style.display = "block";
      return;
    }
    _loginUserId = data.user_id;

    // Show OTP screen
    document.getElementById("screen-login").style.display = "none";
    document.getElementById("screen-otp").style.display = "block";

    // Dev OTP display
    if (data.dev_otp) {
      const devBox = document.getElementById("dev-otp-box");
      devBox.style.display = "block";
      document.getElementById("dev-otp-value").textContent = data.dev_otp;
      // Auto-fill OTP inputs
      const inputs = document.querySelectorAll(".otp-inputs input");
      [...data.dev_otp].forEach((ch, i) => {
        if (inputs[i]) inputs[i].value = ch;
      });
    }
  } catch (err) {
    errEl.textContent = "Network error. Is the server running?";
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Continue";
  }
}

function getOtpValue() {
  return [...document.querySelectorAll(".otp-inputs input")].map((i) => i.value).join("");
}

async function doVerifyOtp(e) {
  e.preventDefault();
  const otp = getOtpValue();
  const errEl = document.getElementById("otp-error");
  const btn = document.getElementById("btn-verify");

  if (otp.length < 6) {
    errEl.textContent = "Please enter the 6-digit OTP.";
    errEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> Verifying…';
  errEl.style.display = "none";

  try {
    const r = await API.post("/auth/verify-otp", { user_id: _loginUserId, otp });
    const data = await r.json();
    if (!r.ok) {
      errEl.textContent = data.error || "OTP verification failed.";
      errEl.style.display = "block";
      return;
    }
    // Store session
    API.token = data.token;
    API.user = data.user;
    localStorage.setItem("med_token", data.token);
    localStorage.setItem("med_user", JSON.stringify(data.user));

    // Show app
    showApp();
  } catch (err) {
    errEl.textContent = "Network error.";
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Verify OTP";
  }
}

function showApp() {
  document.getElementById("auth-root").style.display = "none";
  const app = document.getElementById("app");
  app.classList.add("visible");

  // Set user display
  const email = API.user?.email || "";
  const initials = (API.user?.full_name || email).substring(0, 2).toUpperCase();
  document.getElementById("user-initials").textContent = initials;
  document.getElementById("user-email-display").textContent = email;

  showPage("dashboard");
}

async function doLogout() {
  await API.post("/auth/logout", {});
  API.token = null;
  API.user = null;
  localStorage.removeItem("med_token");
  localStorage.removeItem("med_user");
  location.reload();
}

// ============================================================
// DASHBOARD
// ============================================================
async function loadDashboard() {
  try {
    const [docsR, patR] = await Promise.all([
      API.get("/documents/"),
      API.get("/summary/patient-data"),
    ]);
    const docs = docsR.ok ? (await docsR.json()).documents : [];
    const pat = patR.ok ? await patR.json() : {};

    document.getElementById("stat-docs").textContent = docs.length;
    document.getElementById("stat-labs").textContent = (pat.lab_results || []).length;
    document.getElementById("stat-meds").textContent = (pat.medications || []).length;
    document.getElementById("stat-diags").textContent = (pat.diagnoses || []).length;

    // Recent documents
    const recentList = document.getElementById("recent-docs-list");
    if (docs.length === 0) {
      recentList.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><h3>No documents yet</h3><p>Upload your first medical document to get started.</p></div>`;
    } else {
      recentList.innerHTML = docs.slice(0, 4).map(docHtml).join("");
    }
  } catch (e) {
    console.error("Dashboard load error:", e);
  }
}

// ============================================================
// DOCUMENTS
// ============================================================
let _uploadQueue = [];

function docIcon(type) {
  const icons = { pdf: "📄", png: "🖼️", jpg: "🖼️", jpeg: "🖼️", docx: "📝", doc: "📝", txt: "📋" };
  return icons[type] || "📁";
}

function docHtml(doc) {
  const badge = {
    extracted: '<span class="doc-badge badge-extracted">✓ Extracted</span>',
    processing: '<span class="doc-badge badge-processing">⏳ Processing</span>',
    error: '<span class="doc-badge badge-error">✗ Error</span>',
    pending: '<span class="doc-badge badge-pending">Pending</span>',
  }[doc.upload_status] || "";
  const size = doc.file_size_bytes ? `${(doc.file_size_bytes / 1024).toFixed(1)} KB` : "";
  const date = doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString() : "";
  return `
    <li class="doc-item" data-id="${doc.id}">
      <span class="doc-icon">${docIcon(doc.file_type)}</span>
      <div class="doc-info">
        <div class="doc-name">${escHtml(doc.original_filename)}</div>
        <div class="doc-meta">${size}${size && date ? " · " : ""}${date}</div>
      </div>
      ${badge}
      <button class="btn-danger" onclick="deleteDocument('${doc.id}')">Delete</button>
    </li>`;
}

async function loadDocuments() {
  const listEl = document.getElementById("docs-list");
  listEl.innerHTML = `<div class="loading-overlay"><span class="loader loader-dark"></span> Loading documents…</div>`;
  try {
    const r = await API.get("/documents/");
    if (!r.ok) throw new Error("Failed to load");
    const { documents } = await r.json();
    if (documents.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><h3>No documents yet</h3><p>Upload your medical documents above.</p></div>`;
    } else {
      listEl.innerHTML = `<ul class="doc-list">${documents.map(docHtml).join("")}</ul>`;
    }
  } catch (e) {
    listEl.innerHTML = `<div class="alert alert-error">Failed to load documents.</div>`;
  }
}

async function deleteDocument(id) {
  if (!confirm("Delete this document and all its extracted data?")) return;
  const r = await API.delete(`/documents/${id}`);
  if (r.ok) {
    showToast("Document deleted.", "success");
    loadDocuments();
    loadDashboard();
  } else {
    showToast("Failed to delete document.", "error");
  }
}

function setupUpload() {
  const zone = document.getElementById("upload-zone");
  const fileInput = document.getElementById("file-input");

  zone.addEventListener("click", () => fileInput.click());
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    handleFiles([...e.dataTransfer.files]);
  });
  fileInput.addEventListener("change", () => {
    handleFiles([...fileInput.files]);
    fileInput.value = "";
  });
}

async function handleFiles(files) {
  if (!files.length) return;
  const container = document.getElementById("upload-progress-container");
  container.innerHTML = "";

  for (const file of files) {
    const itemId = `up-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    container.insertAdjacentHTML("beforeend", `
      <div class="upload-progress-item" id="${itemId}">
        <div class="up-filename">${escHtml(file.name)}</div>
        <div class="progress-bar-wrap"><div class="progress-bar" style="width:30%"></div></div>
        <div class="up-status">Uploading…</div>
      </div>`);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const r = await API.uploadFile("/documents/upload", fd);
      const data = await r.json();
      const item = document.getElementById(itemId);

      if (r.ok) {
        item.querySelector(".progress-bar").style.width = "100%";
        item.querySelector(".progress-bar").style.background = "var(--success)";
        item.querySelector(".up-status").textContent = "✓ Extracted successfully";
        item.querySelector(".up-status").style.color = "var(--success)";
        showToast(`${file.name} — extracted successfully.`, "success");
      } else {
        item.querySelector(".progress-bar").style.background = "var(--error)";
        item.querySelector(".up-status").textContent = `✗ ${data.error || "Upload failed"}`;
        item.querySelector(".up-status").style.color = "var(--error)";
        showToast(`${file.name} — ${data.error || "Upload failed"}`, "error");
      }
    } catch (err) {
      const item = document.getElementById(itemId);
      item.querySelector(".up-status").textContent = `✗ Network error`;
      item.querySelector(".up-status").style.color = "var(--error)";
    }
  }

  // Refresh document list
  setTimeout(loadDocuments, 500);
}

// ============================================================
// SUMMARY & ANALYSIS
// ============================================================
async function loadSummaryPage() {
  await Promise.all([loadLatestSummary(), loadPatientDataTables()]);
}

async function loadLatestSummary() {
  const summaryEl = document.getElementById("summary-content");
  const genEl = document.getElementById("summary-generated-at");
  summaryEl.innerHTML = `<div class="loading-overlay"><span class="loader loader-dark"></span> Loading…</div>`;

  try {
    const r = await API.get("/summary/latest");
    if (!r.ok) throw new Error();
    const data = await r.json();

    if (data.summary) {
      summaryEl.textContent = data.summary;
      if (data.generated_at) genEl.textContent = `Generated: ${new Date(data.generated_at).toLocaleString()}`;
    } else {
      summaryEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><h3>No summary yet</h3><p>Click "Generate Summary" to create your medical summary.</p></div>`;
      genEl.textContent = "";
    }
  } catch (e) {
    summaryEl.innerHTML = `<div class="alert alert-error">Failed to load summary.</div>`;
  }
}

async function generateSummary() {
  const btn = document.getElementById("btn-generate-summary");
  const summaryEl = document.getElementById("summary-content");
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> Generating…';
  summaryEl.innerHTML = `<div class="loading-overlay"><span class="loader loader-dark"></span> AI is generating your medical summary…</div>`;

  try {
    const r = await API.post("/summary/generate", {});
    const data = await r.json();
    if (!r.ok) {
      summaryEl.innerHTML = `<div class="alert alert-error">${data.error || "Generation failed."}</div>`;
      showToast(data.error || "Generation failed.", "error");
      return;
    }
    summaryEl.textContent = data.summary;
    document.getElementById("summary-generated-at").textContent = `Generated: ${new Date().toLocaleString()}`;
    showToast("Summary generated successfully.", "success");
  } catch (e) {
    summaryEl.innerHTML = `<div class="alert alert-error">Network error.</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = "♻ Regenerate";
  }
}

async function runAnalysis() {
  const btn = document.getElementById("btn-run-analysis");
  const container = document.getElementById("analysis-container");
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> Analyzing…';
  container.innerHTML = `<div class="loading-overlay"><span class="loader loader-dark"></span> Analyzing medical records…</div>`;

  try {
    const r = await API.post("/summary/analyze", {});
    const data = await r.json();
    if (!r.ok) {
      container.innerHTML = `<div class="alert alert-error">${data.error || "Analysis failed."}</div>`;
      return;
    }
    renderAnalysis(data.analysis);
    showToast("Analysis complete.", "success");
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">Network error.</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = "▶ Run Analysis";
  }
}

function renderAnalysis(analysis) {
  const container = document.getElementById("analysis-container");
  const timeline = (analysis.timeline || []);
  const changes = (analysis.changes || []);
  const meds = (analysis.medication_summary || []);
  const missing = (analysis.missing_info || []);

  container.innerHTML = `
    <div class="analysis-grid">
      <div class="analysis-panel">
        <h3>📅 Medical Timeline</h3>
        ${timeline.length ? timeline.map(t => `
          <div class="timeline-item">
            <div class="timeline-dot"></div>
            <div>
              <div class="tl-date">${escHtml(t.date || "—")}</div>
              <div class="tl-event">${escHtml(t.event || "")}</div>
            </div>
          </div>`).join("") : "<p style='color:var(--text-muted);font-size:13px'>No timeline data available.</p>"}
      </div>
      <div class="analysis-panel">
        <h3>💊 Medication Summary</h3>
        ${meds.length ? meds.map(m => `
          <div class="med-chip">
            💊 ${escHtml(m.name || "—")}
            ${m.dose ? `<span style="font-weight:400">${escHtml(m.dose)}</span>` : ""}
          </div>`).join("") : "<p style='color:var(--text-muted);font-size:13px'>No medication data available.</p>"}
      </div>
      <div class="analysis-panel">
        <h3>📊 Notable Changes</h3>
        ${changes.length ? changes.map(c => `
          <div style="margin-bottom:10px">
            <strong style="font-size:13px">${escHtml(c.field || "")}</strong>
            <p style="font-size:13px;color:var(--text-muted)">${escHtml(c.observations || "")}</p>
          </div>`).join("") : "<p style='color:var(--text-muted);font-size:13px'>Not enough data to identify changes.</p>"}
      </div>
      <div class="analysis-panel">
        <h3>⚠ Missing Information</h3>
        ${missing.length ? missing.map(m => `<span class="missing-tag">${escHtml(m)}</span>`).join("") : "<p style='color:var(--text-muted);font-size:13px'>No obvious missing information detected.</p>"}
      </div>
    </div>`;
}

async function loadPatientDataTables() {
  try {
    const r = await API.get("/summary/patient-data");
    if (!r.ok) return;
    const data = await r.json();

    // Lab results table
    const labEl = document.getElementById("lab-table-body");
    if (data.lab_results?.length) {
      labEl.innerHTML = data.lab_results.map(l => `
        <tr>
          <td>${escHtml(l.field_name || "—")}</td>
          <td><strong>${escHtml(l.field_value || "—")}</strong></td>
          <td>${escHtml(l.unit || "—")}</td>
          <td>${escHtml(l.reference_range || "—")}</td>
          <td>${escHtml(l.report_date || "—")}</td>
        </tr>`).join("");
    } else {
      labEl.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No lab results found.</td></tr>`;
    }

    // Vitals
    const vitalsEl = document.getElementById("vitals-table-body");
    if (data.vital_signs?.length) {
      vitalsEl.innerHTML = data.vital_signs.map(v => `
        <tr>
          <td>${escHtml(v.field_name || "—")}</td>
          <td><strong>${escHtml(v.field_value || "—")}</strong></td>
          <td>${escHtml(v.unit || "—")}</td>
          <td>${escHtml(v.report_date || "—")}</td>
        </tr>`).join("");
    } else {
      vitalsEl.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No vital signs found.</td></tr>`;
    }

    // Diagnoses
    const diagEl = document.getElementById("diagnoses-list");
    if (data.diagnoses?.length) {
      diagEl.innerHTML = data.diagnoses.map(d =>
        `<div class="missing-tag" style="background:#f0fdf4;border-color:#86efac;color:#166534;">🩺 ${escHtml(d.field_name || "")}</div>`
      ).join("");
    } else {
      diagEl.innerHTML = `<span style="color:var(--text-muted);font-size:13px">No diagnoses recorded.</span>`;
    }

    // Allergies
    const allergyEl = document.getElementById("allergies-list");
    if (data.allergies?.length) {
      allergyEl.innerHTML = data.allergies.map(a =>
        `<span class="missing-tag" style="background:#fff7ed;border-color:#fdba74;color:#c2410c;">⚠ ${escHtml(a.field_name || "")}</span>`
      ).join("");
    } else {
      allergyEl.innerHTML = `<span style="color:var(--text-muted);font-size:13px">No allergies recorded.</span>`;
    }
  } catch (e) {
    console.error("Patient data error:", e);
  }
}

async function downloadPDF() {
  const btn = document.getElementById("btn-download-pdf");
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> Generating PDF…';
  showToast("Preparing PDF, please wait…", "info");

  try {
    const headers = {};
    if (API.token) headers["Authorization"] = `Bearer ${API.token}`;
    headers["Content-Type"] = "application/json";

    const r = await fetch("/api/pdf/generate", {
      method: "POST",
      headers,
      body: JSON.stringify({ include_analysis: true }),
    });

    if (!r.ok) {
      const err = await r.json();
      showToast(err.error || "PDF generation failed.", "error");
      return;
    }

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "medical_summary.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("PDF downloaded.", "success");
  } catch (e) {
    showToast("Network error during PDF generation.", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "⬇ Download PDF Report";
  }
}

// ============================================================
// Q&A CHATBOT
// ============================================================
async function loadQAHistory() {
  try {
    const r = await API.get("/qa/history");
    if (!r.ok) return;
    const { history } = await r.json();
    const chatEl = document.getElementById("chat-messages");

    if (history.length === 0) {
      chatEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">💬</div>
          <h3>Ask anything about your medical records</h3>
          <p>Type your question below. The AI will answer using only your uploaded documents.</p>
        </div>`;
      return;
    }

    // Show last 20 in chronological order
    const sorted = [...history].reverse().slice(-20);
    chatEl.innerHTML = sorted.map(h => `
      ${chatBubbleHtml("user", h.question, h.created_at)}
      ${chatBubbleHtml("ai", h.answer, h.created_at)}`
    ).join("");
    chatEl.scrollTop = chatEl.scrollHeight;
  } catch (e) {
    console.error("QA history load error:", e);
  }
}

function chatBubbleHtml(role, text, timestamp) {
  const isUser = role === "user";
  const avatar = isUser
    ? `<div class="bubble-avatar user-av">👤</div>`
    : `<div class="bubble-avatar ai-av">🤖</div>`;
  const time = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return `
    <div class="chat-bubble ${isUser ? "user" : "ai"}">
      ${avatar}
      <div>
        <div class="bubble-body">${escHtml(text)}</div>
        ${time ? `<div class="bubble-time">${time}</div>` : ""}
      </div>
    </div>`;
}

function appendChatBubble(role, text) {
  const chatEl = document.getElementById("chat-messages");
  // Remove empty state if present
  const emptyState = chatEl.querySelector(".empty-state");
  if (emptyState) emptyState.remove();

  chatEl.insertAdjacentHTML("beforeend", chatBubbleHtml(role, text, new Date().toISOString()));
  chatEl.scrollTop = chatEl.scrollHeight;
}

async function sendQuestion(e) {
  if (e) e.preventDefault();
  const inputEl = document.getElementById("qa-input");
  const question = inputEl.value.trim();
  if (!question) return;

  const btn = document.getElementById("btn-ask");
  inputEl.value = "";
  btn.disabled = true;

  appendChatBubble("user", question);

  // Thinking indicator
  const chatEl = document.getElementById("chat-messages");
  const thinkingId = `thinking-${Date.now()}`;
  chatEl.insertAdjacentHTML("beforeend", `
    <div class="chat-bubble ai" id="${thinkingId}">
      <div class="bubble-avatar ai-av">🤖</div>
      <div class="bubble-body" style="color:var(--text-muted)">
        <span class="loader loader-dark"></span> Thinking…
      </div>
    </div>`);
  chatEl.scrollTop = chatEl.scrollHeight;

  try {
    const r = await API.post("/qa/ask", { question });
    const data = await r.json();
    document.getElementById(thinkingId)?.remove();

    if (r.ok) {
      appendChatBubble("ai", data.answer);
    } else {
      appendChatBubble("ai", data.error || "Sorry, I couldn't process that question.");
    }
  } catch (err) {
    document.getElementById(thinkingId)?.remove();
    appendChatBubble("ai", "Network error. Please check your connection.");
  } finally {
    btn.disabled = false;
    inputEl.focus();
  }
}

async function clearQAHistory() {
  if (!confirm("Clear all conversation history?")) return;
  const r = await API.delete("/qa/history");
  if (r.ok) {
    showToast("Conversation cleared.", "success");
    loadQAHistory();
  }
}

// ============================================================
// TABS
// ============================================================
function switchTab(tabGroup, tabId) {
  document.querySelectorAll(`[data-tab-group="${tabGroup}"]`).forEach((el) => {
    el.classList.toggle("active", el.dataset.tabId === tabId);
  });
  document.querySelectorAll(`[data-tab-content="${tabGroup}"]`).forEach((el) => {
    el.classList.toggle("active", el.dataset.tabId === tabId);
  });
}

// ============================================================
// UTILITIES
// ============================================================
function escHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================
// INIT
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  // Check saved session
  const savedToken = localStorage.getItem("med_token");
  const savedUser = localStorage.getItem("med_user");
  if (savedToken && savedUser) {
    API.token = savedToken;
    API.user = JSON.parse(savedUser);
    showApp();
  }

  // OTP input keyboard navigation
  document.querySelectorAll(".otp-inputs input").forEach((inp, idx, all) => {
    inp.addEventListener("input", () => {
      if (inp.value.length >= 1 && idx < all.length - 1) all[idx + 1].focus();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !inp.value && idx > 0) all[idx - 1].focus();
    });
  });

  // Setup upload zone
  setupUpload();

  // Q&A: send on Enter (Shift+Enter for newline)
  const qaInput = document.getElementById("qa-input");
  if (qaInput) {
    qaInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendQuestion();
      }
    });
  }
});
