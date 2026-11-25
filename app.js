/* =========================================================
   BuyerCheck — CarDesk US | Ultra-Clean US Engine (v2.2)
   Live Google Sheets Backend + Auto HTML Emails + NHTSA APIs
   ========================================================= */

const CONFIG = {
  APP_VERSION: "2.2.0",
  DAILY_FREE_AI_LIMIT: 4,
  STAGE1_TARGET_CARS: 10,
  STAGE2_TARGET_CARS: 5,
  STAGE3_TARGET_TOP3: 3,
  PASS_CREDITS_AMOUNT: 5,
  // 1) Google Cloud OAuth Client ID (milte hi chat mein bhejein, main add kar dunga)
  GOOGLE_CLIENT_ID: "",
  // 2) Connected Google Apps Script Backend & HTML Email Webhook
  BACKEND_WEBHOOK_URL: "https://script.google.com/macros/s/AKfycbyBApfT2_QreQEpULEA2dI2eB_G4a6Is0ozjy7k8mLLzLciGkKOuwzdP2p4YKob-8hY/exec",
  // 3) Dodo Payments ($8.99 5-Car Pass) checkout URL
  DODO_CHECKOUT_URL: ""
};

const US_STATES = [
  ["AL", "Alabama (AL)"], ["AK", "Alaska (AK)"], ["AZ", "Arizona (AZ)"],
  ["AR", "Arkansas (AR)"], ["CA", "California (CA)"], ["CO", "Colorado (CO)"],
  ["CT", "Connecticut (CT)"], ["DE", "Delaware (DE)"], ["DC", "District of Columbia (DC)"],
  ["FL", "Florida (FL)"], ["GA", "Georgia (GA)"], ["HI", "Hawaii (HI)"],
  ["ID", "Idaho (ID)"], ["IL", "Illinois (IL)"], ["IN", "Indiana (IN)"],
  ["IA", "Iowa (IA)"], ["KS", "Kansas (KS)"], ["KY", "Kentucky (KY)"],
  ["LA", "Louisiana (LA)"], ["ME", "Maine (ME)"], ["MD", "Maryland (MD)"],
  ["MA", "Massachusetts (MA)"], ["MI", "Michigan (MI)"], ["MN", "Minnesota (MN)"],
  ["MS", "Mississippi (MS)"], ["MO", "Missouri (MO)"], ["MT", "Montana (MT)"],
  ["NE", "Nebraska (NE)"], ["NV", "Nevada (NV)"], ["NH", "New Hampshire (NH)"],
  ["NJ", "New Jersey (NJ)"], ["NM", "New Mexico (NM)"], ["NY", "New York (NY)"],
  ["NC", "North Carolina (NC)"], ["ND", "North Dakota (ND)"], ["OH", "Ohio (OH)"],
  ["OK", "Oklahoma (OK)"], ["OR", "Oregon (OR)"], ["PA", "Pennsylvania (PA)"],
  ["RI", "Rhode Island (RI)"], ["SC", "South Carolina (SC)"], ["SD", "South Dakota (SD)"],
  ["TN", "Tennessee (TN)"], ["TX", "Texas (TX)"], ["UT", "Utah (UT)"],
  ["VT", "Vermont (VT)"], ["VA", "Virginia (VA)"], ["WA", "Washington (WA)"],
  ["WV", "West Virginia (WV)"], ["WI", "Wisconsin (WI)"], ["WY", "Wyoming (WY)"]
];

const RED_FLAG_RULES = [
  {
    pattern: /(no title|lost title|bill of sale only|title coming soon|title in mail)/i,
    severity: "HIGH",
    points: 35,
    title: "Title Risk (Missing or Delayed Title)",
    detail: "Buying without a clean title in the seller's legal name can block DMV registration or hide a lien.",
    question: "Can you show the physical title matching your photo ID before I hand over any cash?"
  },
  {
    pattern: /(salvage|rebuilt|flood|water damage|total loss|frame damage|airbag deployed)/i,
    severity: "HIGH",
    points: 30,
    title: "Major Accident / Title Brand Signal",
    detail: "Salvage, rebuilt, or flood history sharply lowers resale value and can raise insurance rates.",
    question: "Do you have pre-repair photos, alignment sheets, and state inspection paperwork for this title?"
  },
  {
    pattern: /(cash today|must sell today|leaving country|deployed|wire transfer|zelle deposit|gift card|shipping car)/i,
    severity: "HIGH",
    points: 35,
    title: "High-Pressure / Payment Scam Pattern",
    detail: "Artificial urgency or requests for upfront digital transfers/gift cards are classic used-car scam tactics.",
    question: "I only inspect in person and pay at a bank or DMV — are you okay meeting there?"
  },
  {
    pattern: /(check engine|cel on|easy fix|cheap fix|just needs|minor leak|ac needs recharge|o2 sensor|transmission slip)/i,
    severity: "MEDIUM",
    points: 20,
    title: "Downplayed Mechanical Issue ('Easy Fix')",
    detail: "'Cheap fix' claims often mask $1,000–$4,000 catalytic, transmission, or head-gasket repairs.",
    question: "Can my independent mechanic run an OBD-II scan and lift inspection before we agree on price?"
  },
  {
    pattern: /(no test drive|no mechanics|as-is no inspection|serious buyers only no tire kickers)/i,
    severity: "MEDIUM",
    points: 22,
    title: "Inspection / Test-Drive Resistance",
    detail: "Refusing a normal test drive or pre-purchase inspection (PPI) is a strong sign of hidden defects.",
    question: "Why is a standard test drive or independent mechanic check not allowed?"
  },
  {
    pattern: /(odometer|mileage unknown|cluster replaced|tmu|not actual miles|rolled back)/i,
    severity: "HIGH",
    points: 30,
    title: "Odometer / Mileage Discrepancy Risk",
    detail: "Replaced instrument clusters or mileage mismatches can indicate rollback or heavy hidden wear.",
    question: "Do you have service records or state inspection slips proving the mileage history?"
  },
  {
    pattern: /(curbston|selling for a friend|brother's car|uncle's car|not my name)/i,
    severity: "MEDIUM",
    points: 18,
    title: "Possible Curbstoning / Third-Party Flipper",
    detail: "Unlicensed dealers posing as private sellers often flip auction cars without disclosure.",
    question: "How long has the car been registered in your own name, and will your name be on the bill of sale?"
  }
];

const STORAGE_KEY = "buyercheck_state_v2";
const RING_CIRCUMFERENCE = 2 * Math.PI * 20; // 125.66 for r=20

const DEFAULT_STATE = {
  email: "",
  name: "",
  picture: "",
  authMethod: "guest",
  usState: "CA",
  sellerType: "Private Seller",
  freeScansUsedToday: 0,
  lastScanDate: new Date().toISOString().slice(0, 10),
  carsChecked: 0,
  vinCredits: 1,
  cars: [],
  coreCarId: null,
  boughtCarId: null,
  funnelEvents: []
};

let state = loadState();
let deferredInstallPrompt = null;
let lastAiDraft = null;
let lastVinDraft = null;
let toastTimer = null;

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : { ...DEFAULT_STATE };
    const today = new Date().toISOString().slice(0, 10);
    if (parsed.lastScanDate !== today) {
      parsed.freeScansUsedToday = 0;
      parsed.lastScanDate = today;
    }
    if (!Array.isArray(parsed.cars)) parsed.cars = [];
    if (!Array.isArray(parsed.funnelEvents)) parsed.funnelEvents = [];
    return parsed;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
}

function setBanner(msg) {
  const el = document.getElementById("statusBanner");
  if (el) el.textContent = msg;

  const toast = document.getElementById("toast");
  if (toast) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3800);
  }
}

window.jumpToSection = function (sectionId) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.style.boxShadow = "0 0 28px rgba(0, 240, 255, 0.42)";
  setTimeout(() => {
    el.style.boxShadow = "";
  }, 850);
};

function trackFunnelEvent(stage, detail = {}) {
  const eventObj = {
    timestamp: new Date().toISOString(),
    stage,
    email: state.email || "guest",
    name: state.name || "",
    authMethod: state.authMethod || "guest",
    usState: state.usState,
    sellerType: state.sellerType,
    carsChecked: state.carsChecked,
    shortlistedCount: state.cars.filter((c) => c.shortlisted).length,
    top3Count: state.cars.filter((c) => c.top3).length,
    hasCorePick: Boolean(state.coreCarId),
    vinCredits: state.vinCredits,
    ...detail
  };

  state.funnelEvents.unshift(eventObj);
  if (state.funnelEvents.length > 40) state.funnelEvents.pop();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  if (CONFIG.BACKEND_WEBHOOK_URL) {
    fetch(CONFIG.BACKEND_WEBHOOK_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(eventObj)
    }).catch(() => {});
  }
}

/* =========================================================
   GOOGLE 1-CLICK SIGN-IN & AUTO-LOGIN (GSI)
   ========================================================= */
function decodeJwtPayload(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

function handleGoogleCredential(response) {
  const payload = decodeJwtPayload(response.credential);
  if (!payload || !payload.email) {
    setBanner("Google sign-in could not read your email. Please enter it manually below.");
    return;
  }
  state.email = payload.email;
  state.name = payload.name || "";
  state.picture = payload.picture || "";
  state.authMethod = "google";
  trackFunnelEvent("stage_0_google_login");
  saveState();
  setBanner(`Signed in as ${state.name || state.email}. Welcome email & sync active!`);
}

function initGoogleAuth() {
  const wrap = document.getElementById("googleSignInBtnWrap");
  const hint = document.getElementById("googleAuthHint");
  if (!wrap || !hint) return;

  if (!CONFIG.GOOGLE_CLIENT_ID) {
    wrap.innerHTML = `<span class="badge-neon">1-Click Google Login Ready</span>`;
    hint.textContent = "Connect your Google OAuth Client ID to enable 1-click sign-in, or save your email on the right to receive HTML reports.";
    return;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (window.google && window.google.accounts && window.google.accounts.id) {
      clearInterval(timer);
      window.google.accounts.id.initialize({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential,
        auto_select: true,
        cancel_on_tap_outside: false
      });

      wrap.innerHTML = "";
      window.google.accounts.id.renderButton(wrap, {
        theme: "filled_black",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width: 260
      });

      hint.textContent = "Sign in once — returning visits auto-login seamlessly.";
      if (!state.email) window.google.accounts.id.prompt();
    } else if (attempts > 25) {
      clearInterval(timer);
      hint.textContent = "Google Sign-In could not load right now. You can still save your email directly.";
    }
  }, 200);
}

function populateStates() {
  const sel = document.getElementById("usState");
  if (!sel) return;
  sel.innerHTML = US_STATES.map(([code, label]) => `<option value="${code}">${label}</option>`).join("");
  sel.value = state.usState || "CA";
}

function computeVerdict(riskScore) {
  if (riskScore >= 45) return { code: "NO", label: "HIGH RISK — WALK AWAY", css: "verdict-no" };
  if (riskScore >= 18) return { code: "CAUTION", label: "CAUTION — VERIFY FIRST", css: "verdict-caution" };
  return { code: "YES", label: "LOOKS CLEAN — DO PPI & TEST DRIVE", css: "verdict-yes" };
}

/* =========================================================
   STEP 1: FREE AI RED-FLAG SCANNER (4/DAY)
   ========================================================= */
function runAiListingScan() {
  const carName = document.getElementById("carNameInput")?.value.trim() || "Unnamed Vehicle";
  const price = document.getElementById("carPriceInput")?.value.trim() || "";
  const listingText = document.getElementById("listingTextInput")?.value.trim() || "";

  if (!listingText) {
    setBanner("Paste the seller's listing description or chat message first.");
    return;
  }

  if (state.freeScansUsedToday >= CONFIG.DAILY_FREE_AI_LIMIT) {
    setBanner("4/4 free scans used today. Come back tomorrow or unlock the $8.99 5-Car VIN Pass.");
    return;
  }

  const hits = [];
  let riskScore = 0;

  RED_FLAG_RULES.forEach((rule) => {
    if (rule.pattern.test(listingText)) {
      hits.push(rule);
      riskScore += rule.points;
    }
  });

  if (listingText.length < 45) {
    hits.push({
      severity: "MEDIUM",
      points: 12,
      title: "Very Short / Vague Listing",
      detail: "Sellers who omit mileage, service history, or VIN often expect buyers to miss defects.",
      question: "Can you share the 17-digit VIN, exact mileage, and any recent repair receipts?"
    });
    riskScore += 12;
  }

  riskScore = Math.min(100, riskScore);
  const verdict = computeVerdict(riskScore);

  const questions = hits.length
    ? hits.map((h) => h.question)
    : [
        "Can you send the 17-digit VIN so I can check official NHTSA recalls?",
        "Has the car had any accidents, paintwork, or warning lights in the past year?",
        "Are you open to an independent mechanic pre-purchase inspection (PPI)?"
      ];

  const walkAwayScript =
    verdict.code === "NO"
      ? "Thanks for your time, but the risk signals on this car don't fit my checklist. I'm going to pass."
      : verdict.code === "CAUTION"
      ? "I'm interested, but I'll need the 17-digit VIN, title verification in your name, and a mechanic check first."
      : "Looks solid so far. If the VIN check and test drive come back clean, I'm ready to make a fair offer.";

  state.freeScansUsedToday += 1;
  state.carsChecked += 1;

  lastAiDraft = {
    id: "car_" + Date.now(),
    name: carName,
    price: price || "N/A",
    vin: "",
    source: "AI Listing Scan",
    verdict: verdict.code,
    riskScore,
    recallsCount: null,
    complaintsCount: null,
    flags: hits.map((h) => h.title),
    questions,
    walkAwayScript,
    shortlisted: false,
    top3: false,
    createdAt: new Date().toLocaleDateString("en-US")
  };

  renderAiResult(lastAiDraft, hits, verdict);
  trackFunnelEvent("stage_1_free_ai_scan", {
    carName,
    source: lastAiDraft.source,
    verdict: verdict.code,
    riskScore,
    flags: lastAiDraft.flags,
    questions: lastAiDraft.questions,
    walkAwayScript: lastAiDraft.walkAwayScript
  });
  saveState();
  setBanner(`Scan done for "${carName}" (${verdict.code}). ${CONFIG.DAILY_FREE_AI_LIMIT - state.freeScansUsedToday} free scans left today.`);
}

function renderAiResult(draft, hits, verdict) {
  const box = document.getElementById("aiResultBox");
  if (!box) return;

  const flagsHtml = hits.length
    ? hits
        .map(
          (h) => `
        <div class="flag-row">
          <span class="sev-badge sev-${h.severity.toLowerCase()}">${h.severity}</span>
          <div>
            <strong>${escapeHtml(h.title)}</strong>
            <div class="brand-sub">${escapeHtml(h.detail)}</div>
          </div>
        </div>`
        )
        .join("")
    : `<div class="flag-row"><span class="sev-badge sev-low">CLEAN</span><div><strong>No obvious scam or defect triggers in text</strong><div class="brand-sub">Still verify the 17-digit VIN and inspect in person.</div></div></div>`;

  const questionsHtml = draft.questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("");

  box.innerHTML = `
    <div class="result-panel">
      <div class="result-head">
        <div>
          <div class="verdict-pill ${verdict.css}">${verdict.label}</div>
          <h3 style="margin-top:6px; font-size:0.98rem;">${escapeHtml(draft.name)} ${draft.price !== "N/A" ? `• $${escapeHtml(draft.price)}` : ""}</h3>
        </div>
        <div class="risk-meter">Risk: <strong>${draft.riskScore}/100</strong></div>
      </div>

      <div class="result-section">
        <div class="mini-label">Detected Flags</div>
        ${flagsHtml}
      </div>

      <div class="result-section">
        <div class="mini-label">Ask the Seller</div>
        <ul class="clean-list">${questionsHtml}</ul>
      </div>

      <div class="result-section">
        <div class="mini-label">Reply Script</div>
        <div class="script-box">"${escapeHtml(draft.walkAwayScript)}"</div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
        <button type="button" class="btn btn-cyan btn-sm" onclick="saveCurrentAiToGarage(true)">★ Shortlist (Top 5)</button>
        <button type="button" class="btn btn-install btn-sm" onclick="emailCurrentAiReport()">📧 Email Report</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick="saveCurrentAiToGarage(false)">Save Only</button>
      </div>
    </div>
  `;
}

window.saveCurrentAiToGarage = function (isShortlisted) {
  if (!lastAiDraft) return;
  const exists = state.cars.find((c) => c.id === lastAiDraft.id);
  if (exists) {
    exists.shortlisted = isShortlisted || exists.shortlisted;
  } else {
    state.cars.unshift({ ...lastAiDraft, shortlisted: isShortlisted });
  }
  trackFunnelEvent(isShortlisted ? "stage_1_shortlisted" : "stage_1_saved", { carName: lastAiDraft.name });
  saveState();
  setBanner(
    isShortlisted
      ? `"${lastAiDraft.name}" added to your Top 5 Shortlist! Run its VIN in Step 2.`
      : `"${lastAiDraft.name}" saved to My Garage.`
  );
};

window.emailCurrentAiReport = function () {
  if (!lastAiDraft) return;
  sendReportPayloadToEmail(lastAiDraft);
};

/* =========================================================
   STEP 2: OFFICIAL U.S. NHTSA VIN API
   ========================================================= */
async function runVinNhtsaCheck() {
  const vinRaw = (document.getElementById("vinInput")?.value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (vinRaw.length !== 17) {
    setBanner("Enter a valid 17-character VIN (letters & numbers, no spaces).");
    return;
  }

  if (state.vinCredits <= 0) {
    setBanner("0 VIN credits left. Unlock the $8.99 5-Car Pass below to keep checking VINs.");
    jumpToSection("pricingSection");
    return;
  }

  const box = document.getElementById("vinResultBox");
  if (box) {
    box.innerHTML = `<div class="status-banner" style="margin-top:12px;">Pulling live U.S. NHTSA VIN specs, safety recalls &amp; owner complaints...</div>`;
  }

  try {
    const decodeRes = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vinRaw)}?format=json`
    );
    const decodeJson = await decodeRes.json();
    const info = decodeJson?.Results?.[0] || {};

    const year = info.ModelYear || "";
    const make = info.Make || "";
    const model = info.Model || "";
    const trim = info.Trim || info.Series || "Standard";
    const body = info.BodyClass || "N/A";
    const engine = [
      info.EngineCylinders ? `${info.EngineCylinders} Cyl` : "",
      info.DisplacementL ? `${info.DisplacementL}L` : "",
      info.FuelTypePrimary || ""
    ]
      .filter(Boolean)
      .join(" • ") || "N/A";
    const plant = [info.PlantCity, info.PlantCountry].filter(Boolean).join(", ") || "N/A";

    if (!year || !make || !model) {
      if (box) {
        box.innerHTML = `<div class="status-banner" style="margin-top:12px;">NHTSA couldn't decode Make/Model/Year for <strong>${escapeHtml(vinRaw)}</strong>. Double-check the 17 characters (I, O, Q aren't used in VINs).</div>`;
      }
      return;
    }

    const [recallsRes, complaintsRes] = await Promise.all([
      fetch(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`).catch(() => null),
      fetch(`https://api.nhtsa.gov/complaints/complaintsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`).catch(() => null)
    ]);

    const recallsData = recallsRes && recallsRes.ok ? await recallsRes.json() : { results: [] };
    const complaintsData = complaintsRes && complaintsRes.ok ? await complaintsRes.json() : { results: [] };

    const recalls = Array.isArray(recallsData.results) ? recallsData.results : [];
    const complaints = Array.isArray(complaintsData.results) ? complaintsData.results : [];

    state.vinCredits = Math.max(0, state.vinCredits - 1);

    let riskScore = 10;
    if (recalls.length >= 4) riskScore += 30;
    else if (recalls.length >= 1) riskScore += 15;
    if (complaints.length >= 150) riskScore += 25;
    else if (complaints.length >= 40) riskScore += 12;

    const verdict = computeVerdict(riskScore);
    const fullName = `${year} ${make} ${model}`;

    lastVinDraft = {
      id: "vin_" + Date.now(),
      name: fullName,
      price: "NHTSA Verified",
      vin: vinRaw,
      source: "Official U.S. NHTSA VIN Check",
      verdict: verdict.code,
      riskScore,
      recallsCount: recalls.length,
      complaintsCount: complaints.length,
      specs: { trim, body, engine, plant },
      flags: recalls.slice(0, 4).map((r) => `Recall: ${r.Component || "Safety Component"}`),
      questions: [
        recalls.length > 0
          ? `NHTSA lists ${recalls.length} safety recall(s) for this model year — have all recalls been completed at a dealer?`
          : "No model-year recalls listed — can I still review recent maintenance receipts?",
        "Does the dashboard VIN match the driver door-jamb sticker and paper title?"
      ],
      walkAwayScript:
        recalls.length > 0
          ? "I pulled NHTSA safety records and saw recalls on this model year. I'll need dealer proof they were fixed or a price adjustment."
          : "NHTSA records look clean. Let's verify the title in your name and schedule a test drive.",
      shortlisted: true,
      top3: false,
      createdAt: new Date().toLocaleDateString("en-US")
    };

    state.cars.unshift(lastVinDraft);
    trackFunnelEvent("stage_2_vin_nhtsa_check", {
      vin: vinRaw,
      carName: fullName,
      source: lastVinDraft.source,
      recallsCount: recalls.length,
      complaintsCount: complaints.length,
      verdict: verdict.code,
      riskScore,
      flags: lastVinDraft.flags,
      questions: lastVinDraft.questions,
      walkAwayScript: lastVinDraft.walkAwayScript
    });
    saveState();

    const recallCards = recalls.length
      ? recalls
          .slice(0, 3)
          .map(
            (r) => `
          <div class="flag-row">
            <span class="sev-badge sev-medium">RECALL</span>
            <div>
              <strong>${escapeHtml(r.Component || "Safety Recall")}</strong>
              <div class="brand-sub">${escapeHtml((r.Summary || "").slice(0, 155))}${(r.Summary || "").length > 155 ? "..." : ""}</div>
            </div>
          </div>`
          )
          .join("")
      : `<div class="flag-row"><span class="sev-badge sev-low">0 RECALLS</span><div><strong>No model-year safety recalls returned by NHTSA</strong></div></div>`;

    if (box) {
      box.innerHTML = `
        <div class="result-panel">
          <div class="result-head">
            <div>
              <div class="verdict-pill ${verdict.css}">${verdict.label}</div>
              <h3 style="margin-top:6px; font-size:0.98rem;">${escapeHtml(fullName)} (${escapeHtml(trim)})</h3>
              <div class="brand-sub">VIN: <strong>${escapeHtml(vinRaw)}</strong></div>
            </div>
            <div class="risk-meter">Recalls: <strong>${recalls.length}</strong> • Complaints: <strong>${complaints.length}</strong></div>
          </div>

          <div class="specs-grid">
            <div class="spec-chip"><span>Body</span><strong>${escapeHtml(body)}</strong></div>
            <div class="spec-chip"><span>Engine</span><strong>${escapeHtml(engine)}</strong></div>
            <div class="spec-chip"><span>Plant</span><strong>${escapeHtml(plant)}</strong></div>
          </div>

          <div class="result-section">
            <div class="mini-label">U.S. NHTSA Safety Recalls (${recalls.length})</div>
            ${recallCards}
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
            <button type="button" class="btn btn-amber btn-sm" onclick="toggleTop3('${lastVinDraft.id}')">🎯 Add to Top 3</button>
            <button type="button" class="btn btn-install btn-sm" onclick="emailCarReport('${lastVinDraft.id}')">📧 Email Report</button>
            <button type="button" class="btn btn-cyan btn-sm" onclick="copyCarReport('${lastVinDraft.id}')">Copy</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="setCorePick('${lastVinDraft.id}')">🔬 Core Pick</button>
          </div>
        </div>
      `;
    }

    setBanner(
      isValidEmail(state.email)
        ? `NHTSA VIN verified for ${fullName}! Full HTML report auto-emailed to ${state.email}.`
        : `NHTSA VIN verified for ${fullName}! Save your email below to receive HTML reports.`
    );
  } catch {
    if (box) {
      box.innerHTML = `<div class="status-banner" style="margin-top:12px;">Couldn't reach NHTSA right now. Check your connection and try again.</div>`;
    }
  }
}

/* =========================================================
   EMAIL REPORT HELPER (TRIGGERS APPS SCRIPT HTML EMAIL)
   ========================================================= */
function sendReportPayloadToEmail(car) {
  if (!isValidEmail(state.email)) {
    setBanner("Save your Gmail / Email below first so we can email your HTML report!");
    jumpToSection("profileCard");
    document.getElementById("buyerEmail")?.focus();
    return;
  }

  trackFunnelEvent("manual_email_report", {
    carName: car.name,
    vin: car.vin || "",
    source: car.source || "BuyerCheck Report",
    verdict: car.verdict || "CAUTION",
    riskScore: car.riskScore || 0,
    recallsCount: car.recallsCount,
    complaintsCount: car.complaintsCount,
    flags: car.flags || [],
    questions: car.questions || [],
    walkAwayScript: car.walkAwayScript || ""
  });

  setBanner(`📧 World-class HTML report for "${car.name}" sent to ${state.email}! Check your inbox.`);
}

window.emailCarReport = function (carId) {
  const car = state.cars.find((c) => c.id === carId);
  if (!car) return;
  sendReportPayloadToEmail(car);
};

/* =========================================================
   GARAGE SHOWDOWN (TOP 5 -> TOP 3 -> 1 CORE -> BOUGHT)
   ========================================================= */
function buildWorldClassReportText(car) {
  const lines = [
    "==========================================",
    "CARDESK US — BUYERCHECK PRE-BUY REPORT",
    "==========================================",
    `Buyer         : ${state.name ? `${state.name} (${state.email})` : state.email || "Guest Buyer"} [${state.usState}]`,
    `Vehicle       : ${car.name}`,
    `VIN           : ${car.vin || "Not entered yet"}`,
    `Check Type    : ${car.source}`,
    `Verdict       : ${car.verdict} (Risk Score: ${car.riskScore}/100)`,
    car.recallsCount !== null ? `NHTSA Data    : ${car.recallsCount} Recall(s) | ${car.complaintsCount} Owner Complaint(s)` : "",
    "",
    "KEY FINDINGS:",
    ...(car.flags && car.flags.length ? car.flags.map((f) => `• ${f}`) : ["• No major text/recall triggers flagged"]),
    "",
    "QUESTIONS FOR THE SELLER:",
    ...(car.questions || []).map((q, i) => `${i + 1}. ${q}`),
    "",
    "REPLY / NEGOTIATION SCRIPT:",
    `"${car.walkAwayScript || ""}"`,
    "",
    "Checked with BuyerCheck by CarDesk US — https://buyercheck.cardeskus.com",
    "Disclaimer: Self-help informational report, not legal advice or a certified inspection."
  ];
  return lines.filter((l) => l !== "").join("\n");
}

window.copyCarReport = async function (carId) {
  const car = state.cars.find((c) => c.id === carId);
  if (!car) return;
  try {
    await navigator.clipboard.writeText(buildWorldClassReportText(car));
    setBanner(`Report copied for "${car.name}" — ready to paste into Gmail or text.`);
  } catch {
    setBanner("Clipboard blocked — copy manually from your browser.");
  }
};

window.toggleShortlist = function (carId) {
  const car = state.cars.find((c) => c.id === carId);
  if (!car) return;
  car.shortlisted = !car.shortlisted;
  if (!car.shortlisted) car.top3 = false;
  saveState();
};

window.toggleTop3 = function (carId) {
  const car = state.cars.find((c) => c.id === carId);
  if (!car) return;
  const currentTop3 = state.cars.filter((c) => c.top3).length;
  if (!car.top3 && currentTop3 >= 3) {
    setBanner("Top 3 is full. Remove one car from Top 3 before adding another.");
    return;
  }
  car.top3 = !car.top3;
  if (car.top3) car.shortlisted = true;
  trackFunnelEvent("stage_3_top3_updated", { carName: car.name, inTop3: car.top3 });
  saveState();
};

window.setCorePick = function (carId) {
  const car = state.cars.find((c) => c.id === carId);
  if (!car) return;
  car.shortlisted = true;
  car.top3 = true;
  state.coreCarId = carId;
  trackFunnelEvent("stage_3_core_car_selected", { carName: car.name, vin: car.vin || "" });
  saveState();
  setBanner(`"${car.name}" selected as your 1 Core Car for deep audit & PPI!`);
};

window.markCarBought = function (carId) {
  const car = state.cars.find((c) => c.id === carId);
  if (!car) return;
  car.shortlisted = true;
  car.top3 = true;
  state.coreCarId = carId;
  state.boughtCarId = carId;
  trackFunnelEvent("stage_4_car_bought", {
    carName: car.name,
    vin: car.vin || "",
    verdict: car.verdict || "YES",
    riskScore: car.riskScore || 0
  });
  saveState();
  setBanner(
    isValidEmail(state.email)
      ? `🏆 Congrats! "${car.name}" marked as Bought — Victory summary emailed to ${state.email}!`
      : `🏆 Congrats! "${car.name}" is marked as Bought.`
  );
};

window.removeCar = function (carId) {
  state.cars = state.cars.filter((c) => c.id !== carId);
  if (state.coreCarId === carId) state.coreCarId = null;
  if (state.boughtCarId === carId) state.boughtCarId = null;
  saveState();
};

function renderGarage() {
  const container = document.getElementById("garageList");
  if (!container) return;

  if (!state.cars.length) {
    container.innerHTML = `<div class="status-banner">No cars saved yet. Run a Free AI Scan or NHTSA VIN Check above — saved cars appear here so you can narrow Top 5 → Top 3 → 1 Winner.</div>`;
    return;
  }

  container.innerHTML = state.cars
    .map((car) => {
      const isCore = state.coreCarId === car.id;
      const isBought = state.boughtCarId === car.id;
      const verdictClass =
        car.verdict === "NO" ? "verdict-no" : car.verdict === "CAUTION" ? "verdict-caution" : "verdict-yes";
      const cardGlow = isBought ? "bought-glow" : isCore ? "core-glow" : "";

      return `
      <div class="garage-card ${cardGlow}">
        <div class="garage-top">
          <div>
            <span class="verdict-pill ${verdictClass}">${escapeHtml(car.verdict)}</span>
            ${car.shortlisted ? `<span class="badge-neon" style="margin-left:5px;">★ TOP 5</span>` : ""}
            ${car.top3 ? `<span class="badge-neon badge-pink" style="margin-left:5px;">🎯 TOP 3</span>` : ""}
            ${isCore ? `<span class="tag-inline tag-core">🔬 CORE PICK</span>` : ""}
            ${isBought ? `<span class="tag-inline tag-bought">🏆 BOUGHT</span>` : ""}
            <h4 style="margin-top:6px; font-size:0.95rem;">${escapeHtml(car.name)}</h4>
            <div class="brand-sub">
              ${car.vin ? `VIN: ${escapeHtml(car.vin)} • ` : ""}${escapeHtml(car.source)} • ${escapeHtml(car.createdAt)}
              ${car.recallsCount !== null ? ` • Recalls: ${car.recallsCount}` : ""}
            </div>
          </div>
          <div class="garage-actions">
            <button type="button" class="btn btn-ghost btn-sm" onclick="toggleShortlist('${car.id}')">
              ${car.shortlisted ? "★ Top 5" : "+ Top 5"}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="toggleTop3('${car.id}')">
              ${car.top3 ? "🎯 Top 3" : "+ Top 3"}
            </button>
            <button type="button" class="btn btn-amber btn-sm" onclick="setCorePick('${car.id}')">🔬 Core</button>
            <button type="button" class="btn btn-cyan btn-sm" onclick="emailCarReport('${car.id}')">📧 Email</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="copyCarReport('${car.id}')">Copy</button>
            <button type="button" class="btn btn-install btn-sm" onclick="markCarBought('${car.id}')">🏆 Bought</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="removeCar('${car.id}')">✕</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

/* =========================================================
   COMPACT VISUAL ROADMAP LIVE UPDATER
   ========================================================= */
function setRingProgress(ringId, ratio) {
  const el = document.getElementById(ringId);
  if (!el) return;
  const clamped = Math.max(0, Math.min(1, ratio));
  el.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - clamped));
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderVisualRoadmap() {
  const remainingFree = Math.max(0, CONFIG.DAILY_FREE_AI_LIMIT - state.freeScansUsedToday);
  const scannedTotal = state.carsChecked;
  const shortlistedCount = state.cars.filter((c) => c.shortlisted).length;
  const vinCheckedCount = state.cars.filter((c) => Boolean(c.vin)).length;
  const top3Count = state.cars.filter((c) => c.top3).length;
  const coreCar = state.cars.find((c) => c.id === state.coreCarId) || null;
  const boughtCar = state.cars.find((c) => c.id === state.boughtCarId) || null;

  const freeText = document.getElementById("freeScansLeftText");
  if (freeText) {
    freeText.textContent = `${remainingFree} / ${CONFIG.DAILY_FREE_AI_LIMIT} Left`;
    freeText.style.color = remainingFree === 0 ? "var(--neon-red)" : "var(--neon-green)";
  }
  const pipsWrap = document.getElementById("batteryPips");
  if (pipsWrap) {
    pipsWrap.innerHTML = Array.from({ length: CONFIG.DAILY_FREE_AI_LIMIT }, (_, i) =>
      `<div class="pip ${i < remainingFree ? "charged" : ""}"></div>`
    ).join("");
  }

  setRingProgress("n1Ring", Math.min(1, scannedTotal / CONFIG.STAGE1_TARGET_CARS));
  setText("n1Count", `${scannedTotal}/${CONFIG.STAGE1_TARGET_CARS}`);
  setText("n1Sub", `${scannedTotal} Scanned`);

  const stage2ActiveCount = Math.max(vinCheckedCount, Math.min(5, shortlistedCount));
  setRingProgress("n2Ring", Math.min(1, stage2ActiveCount / CONFIG.STAGE2_TARGET_CARS));
  setText("n2Count", `${vinCheckedCount}/5`);
  setText("n2Credits", `${state.vinCredits} Credit${state.vinCredits === 1 ? "" : "s"}`);

  const n2Slots = document.getElementById("n2Slots");
  if (n2Slots) {
    n2Slots.innerHTML = Array.from({ length: 5 }, (_, i) => {
      if (i < vinCheckedCount) return `<span class="slot-dot filled-pink" title="VIN Checked"></span>`;
      if (i < shortlistedCount) return `<span class="slot-dot filled-cyan" title="Shortlisted"></span>`;
      return `<span class="slot-dot"></span>`;
    }).join("");
  }

  setRingProgress("n3Ring", coreCar ? 1 : Math.min(0.85, top3Count / CONFIG.STAGE3_TARGET_TOP3));
  setText("n3Count", `${top3Count}/3`);
  setText("n3CoreLabel", coreCar ? `Core: ${coreCar.name.slice(0, 15)}${coreCar.name.length > 15 ? "…" : ""}` : "Core: None");

  const n3Slots = document.getElementById("n3Slots");
  if (n3Slots) {
    n3Slots.innerHTML = Array.from({ length: 3 }, (_, i) => {
      if (i === 0 && coreCar) return `<span class="slot-dot filled-amber" title="Core Pick"></span>`;
      if (i < top3Count) return `<span class="slot-dot filled-pink" title="Top 3"></span>`;
      return `<span class="slot-dot"></span>`;
    }).join("");
  }

  setRingProgress("n4Ring", boughtCar ? 1 : 0);
  setText("n4CarName", boughtCar ? boughtCar.name.slice(0, 16) : "Waiting");

  const n1 = document.getElementById("node1");
  const n2 = document.getElementById("node2");
  const n3 = document.getElementById("node3");
  const n4 = document.getElementById("node4");
  [n1, n2, n3, n4].forEach((el) => el && el.classList.remove("node-active", "node-done"));

  const p1 = document.getElementById("pipe1");
  const p2 = document.getElementById("pipe2");
  const p3 = document.getElementById("pipe3");
  [p1, p2, p3].forEach((el) => el && el.classList.remove("lit"));

  if (scannedTotal > 0) {
    n1?.classList.add(shortlistedCount >= 1 || scannedTotal >= 3 ? "node-done" : "node-active");
    setText("n1Status", scannedTotal >= 3 ? "ACTIVE" : "FREE • 4/DAY");
    p1?.classList.add("lit");
  } else {
    n1?.classList.add("node-active");
    setText("n1Status", "FREE • 4/DAY");
  }

  if (vinCheckedCount > 0) {
    n2?.classList.add(top3Count >= 1 || vinCheckedCount >= 3 ? "node-done" : "node-active");
    setText("n2Status", `${vinCheckedCount}/5 DONE`);
    p2?.classList.add("lit");
  } else if (shortlistedCount > 0) {
    n2?.classList.add("node-active");
    setText("n2Status", "READY");
  } else {
    setText("n2Status", "$8.99 PASS");
  }

  if (coreCar) {
    n3?.classList.add("node-done");
    setText("n3Status", "CORE LOCKED");
    p3?.classList.add("lit");
  } else if (top3Count > 0) {
    n3?.classList.add("node-active");
    setText("n3Status", `${top3Count}/3 READY`);
  } else {
    setText("n3Status", "1 CORE PICK");
  }

  if (boughtCar) {
    n4?.classList.add("node-done");
    setText("n4Status", "BOUGHT!");
  } else if (coreCar) {
    n4?.classList.add("node-active");
    setText("n4Status", "FINAL STEP");
  } else {
    setText("n4Status", "GOAL");
  }

  let pct = 0;
  if (scannedTotal > 0) pct += Math.min(25, Math.round((scannedTotal / 4) * 25));
  if (shortlistedCount > 0) pct += 15;
  if (vinCheckedCount > 0) pct += Math.min(25, Math.round((vinCheckedCount / 3) * 25));
  if (top3Count > 0) pct += 10;
  if (coreCar) pct += 15;
  if (boughtCar) pct = 100;
  pct = Math.min(100, pct);
  setText("missionPctBadge", `${pct}% Done`);

  const guideText = document.getElementById("nextActionText");
  const guideBtn = document.getElementById("nextActionBtn");
  if (guideText && guideBtn) {
    if (boughtCar) {
      guideText.textContent = `🏆 Deal closed on ${boughtCar.name} after screening ${scannedTotal} car(s)!`;
      guideBtn.textContent = "Share Summary →";
      guideBtn.onclick = () => document.getElementById("copyJourneyCardBtn")?.click();
    } else if (coreCar) {
      guideText.textContent = `Core Pick locked (${coreCar.name}). Complete your mechanic check, then mark Bought.`;
      guideBtn.textContent = "Open Garage →";
      guideBtn.onclick = () => jumpToSection("garageCard");
    } else if (vinCheckedCount > 0 || top3Count > 0) {
      guideText.textContent = `${vinCheckedCount} VIN(s) checked & ${top3Count}/3 finalists. Pick your 1 Core Car in Garage.`;
      guideBtn.textContent = "Pick 1 Core Car →";
      guideBtn.onclick = () => jumpToSection("garageCard");
    } else if (shortlistedCount > 0) {
      guideText.textContent = `${shortlistedCount} car(s) shortlisted! Check their 17-digit VIN with official NHTSA data.`;
      guideBtn.textContent = "Check VIN Now →";
      guideBtn.onclick = () => jumpToSection("vinScannerCard");
    } else if (scannedTotal > 0) {
      guideText.textContent = `${scannedTotal} listing(s) scanned (${remainingFree}/4 free left today). Star good ones into Top 5.`;
      guideBtn.textContent = "Scan Next Car →";
      guideBtn.onclick = () => jumpToSection("aiScannerCard");
    } else {
      guideText.textContent = "Paste a listing below to run your first free AI red
