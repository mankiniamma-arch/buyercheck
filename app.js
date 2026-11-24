/* =========================================================
   BuyerCheck — CarDesk US | Core Engine (Part-3)
   Free NHTSA APIs + Red-Flag Scanner + Journey + Funnel Sync
   ========================================================= */

const CONFIG = {
  APP_VERSION: "1.3.0",
  DAILY_FREE_AI_LIMIT: 4,
  PASS_CREDITS_AMOUNT: 5,
  // Part-4 में Google Apps Script Web App URL यहाँ डालेंगे
  BACKEND_WEBHOOK_URL: "",
  // Dodo Payments ($8.99 5-Car Pass) लिंक तैयार होने पर यहाँ डालें
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
    detail: "Salvage, rebuilt, or flood history sharply reduces resale value and can raise insurance rates.",
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
    question: "Can my independent mechanic run an OBD-II scan and lift inspection before we finalize price?"
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
    pattern: /(odometer|mileage unknown|cluster replaced|tmU|not actual miles|rolled back)/i,
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

const DEFAULT_STATE = {
  email: "",
  usState: "CA",
  sellerType: "Private Seller",
  freeScansUsedToday: 0,
  lastScanDate: new Date().toISOString().slice(0, 10),
  carsChecked: 0,
  vinCredits: 1, // 1 complimentary demo credit so users/you can test live NHTSA VIN check right away
  cars: [],
  boughtCarId: null,
  funnelEvents: []
};

let state = loadState();
let deferredInstallPrompt = null;
let lastAiDraft = null;
let lastVinDraft = null;

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function setBanner(msg, type = "info") {
  const el = document.getElementById("statusBanner");
  if (!el) return;
  el.textContent = msg;
  el.dataset.type = type;
}

function trackFunnelEvent(stage, detail = {}) {
  const eventObj = {
    timestamp: new Date().toISOString(),
    stage,
    email: state.email || "guest",
    usState: state.usState,
    sellerType: state.sellerType,
    carsChecked: state.carsChecked,
    shortlistedCount: state.cars.filter((c) => c.shortlisted).length,
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventObj)
    }).catch(() => {});
  }
}

function populateStates() {
  const sel = document.getElementById("usState");
  if (!sel) return;
  sel.innerHTML = US_STATES.map(
    ([code, label]) => `<option value="${code}">${label}</option>`
  ).join("");
  sel.value = state.usState || "CA";
}

function computeVerdict(riskScore) {
  if (riskScore >= 45) return { code: "NO", label: "NO — HIGH RISK (WALK AWAY)", css: "verdict-no" };
  if (riskScore >= 18) return { code: "CAUTION", label: "CAUTION — VERIFY BEFORE BUYING", css: "verdict-caution" };
  return { code: "YES", label: "YES — LOOKS CLEAN (DO PPI & TEST DRIVE)", css: "verdict-yes" };
}

/* =========================================================
   LAYER 1: FREE AI RED-FLAG & DEAL SCANNER (4/DAY)
   ========================================================= */
function runAiListingScan() {
  const carName = document.getElementById("carNameInput").value.trim() || "Unnamed Vehicle";
  const price = document.getElementById("carPriceInput").value.trim();
  const listingText = document.getElementById("listingTextInput").value.trim();

  if (!listingText) {
    setBanner("Please paste the seller's listing description or chat message first.", "warn");
    return;
  }

  if (state.freeScansUsedToday >= CONFIG.DAILY_FREE_AI_LIMIT) {
    setBanner("Daily limit reached (4/4 free AI scans used today). Unlock the $8.99 5-Car Pass to continue checking shortlisted VINs.", "warn");
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
      detail: "Sellers who hide mileage, service history, or VIN often expect buyers to miss defects.",
      question: "Can you share the 17-digit VIN, exact mileage, and any recent repair receipts?"
    });
    riskScore += 12;
  }

  riskScore = Math.min(100, riskScore);
  const verdict = computeVerdict(riskScore);

  const questions = hits.length
    ? hits.map((h) => h.question)
    : [
        "Can you send the 17-digit VIN so I can run an NHTSA safety & recall check?",
        "Has the car had any paintwork, accidents, or dashboard warning lights in the last 12 months?",
        "Are you open to an independent mechanic Pre-Purchase Inspection (PPI)?"
      ];

  const walkAwayScript =
    verdict.code === "NO"
      ? "Thanks for your time, but the risk signals on this car don't fit my checklist. I'm going to pass and look at other options."
      : verdict.code === "CAUTION"
      ? "I'm interested, but I'll need the 17-digit VIN, title verification in your name, and a mechanic check before we agree on a price."
      : "The listing looks reasonable so far. If the VIN check and test drive check out clean, I'm ready to discuss a fair offer.";

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
    createdAt: new Date().toLocaleDateString("en-US")
  };

  renderAiResult(lastAiDraft, hits, verdict);
  trackFunnelEvent("stage_1_free_ai_scan", { carName, verdict: verdict.code, riskScore });
  saveState();
  setBanner(`AI Scan complete for "${carName}" — Verdict: ${verdict.code}. (${CONFIG.DAILY_FREE_AI_LIMIT - state.freeScansUsedToday} free scans left today)`);
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
    : `<div class="flag-row"><span class="sev-badge sev-low">CLEAN</span><div><strong>No obvious scam/defect triggers in text</strong><div class="brand-sub">Still verify the 17-digit VIN and inspect in person.</div></div></div>`;

  const questionsHtml = draft.questions
    .map((q) => `<li>${escapeHtml(q)}</li>`)
    .join("");

  box.innerHTML = `
    <div class="result-panel">
      <div class="result-head">
        <div>
          <div class="verdict-pill ${verdict.css}">${verdict.label}</div>
          <h3 style="margin-top:8px;">${escapeHtml(draft.name)} ${draft.price !== "N/A" ? `• $${escapeHtml(draft.price)}` : ""}</h3>
        </div>
        <div class="risk-meter">Risk Score: <strong>${draft.riskScore}/100</strong></div>
      </div>

      <div class="result-section">
        <div class="mini-label">Detected Red Flags</div>
        ${flagsHtml}
      </div>

      <div class="result-section">
        <div class="mini-label">Ask the Seller Right Now</div>
        <ul class="clean-list">${questionsHtml}</ul>
      </div>

      <div class="result-section">
        <div class="mini-label">Negotiation / Walk-Away Script</div>
        <div class="script-box">"${escapeHtml(draft.walkAwayScript)}"</div>
      </div>

      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
        <button type="button" class="btn btn-cyan" onclick="saveCurrentAiToGarage(true)">★ Shortlist Car into Journey</button>
        <button type="button" class="btn btn-ghost" onclick="saveCurrentAiToGarage(false)">Save to History Only</button>
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
      ? `"${lastAiDraft.name}" added to your Shortlist! Now run its 17-digit VIN in Stage 2.`
      : `"${lastAiDraft.name}" saved to your checked cars history.`
  );
};

/* =========================================================
   LAYER 2: FREE US GOVT NHTSA APIs (VIN + RECALLS + COMPLAINTS)
   ========================================================= */
async function runVinNhtsaCheck() {
  const vinRaw = document.getElementById("vinInput").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (vinRaw.length !== 17) {
    setBanner("Please enter a valid 17-character VIN (letters & numbers, no spaces).", "warn");
    return;
  }

  if (state.vinCredits <= 0) {
    setBanner("You have 0 VIN Pass credits left. Unlock the $8.99 5-Car VIN & Safety Pass below to continue.", "warn");
    document.getElementById("pricingSection")?.scrollIntoView({ behavior: "smooth" });
    return;
  }

  const box = document.getElementById("vinResultBox");
  box.innerHTML = `<div class="status-banner">Connecting to official U.S. NHTSA databases (VIN Decoder + Recalls + Owner Complaints)...</div>`;

  try {
    // 1. Decode VIN (Free NHTSA vPIC API)
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
    const engine = [info.EngineCylinders ? `${info.EngineCylinders} Cyl` : "", info.DisplacementL ? `${info.DisplacementL}L` : "", info.FuelTypePrimary || ""]
      .filter(Boolean)
      .join(" • ") || "N/A";
    const plant = [info.PlantCity, info.PlantCountry].filter(Boolean).join(", ") || "N/A";

    if (!year || !make || !model) {
      box.innerHTML = `<div class="status-banner">NHTSA could not decode full Make/Model/Year for VIN <strong>${escapeHtml(vinRaw)}</strong>. Double-check the 17 characters (I, O, Q are never used in VINs).</div>`;
      return;
    }

    // 2. Fetch Recalls & Complaints in parallel (Free NHTSA APIs)
    const [recallsRes, complaintsRes] = await Promise.all([
      fetch(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`).catch(() => null),
      fetch(`https://api.nhtsa.gov/complaints/complaintsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`).catch(() => null)
    ]);

    const recallsData = recallsRes && recallsRes.ok ? await recallsRes.json() : { results: [] };
    const complaintsData = complaintsRes && complaintsRes.ok ? await complaintsRes.json() : { results: [] };

    const recalls = Array.isArray(recallsData.results) ? recallsData.results : [];
    const complaints = Array.isArray(complaintsData.results) ? complaintsData.results : [];

    // Deduct 1 credit
    state.vinCredits = Math.max(0, state.vinCredits - 1);

    // Risk computation based on open model recalls + heavy complaints
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
      source: "NHTSA VIN & Safety Check",
      verdict: verdict.code,
      riskScore,
      recallsCount: recalls.length,
      complaintsCount: complaints.length,
      specs: { trim, body, engine, plant },
      flags: recalls.slice(0, 3).map((r) => `Recall: ${r.Component || "Safety Component"}`),
      questions: [
        recalls.length > 0
          ? `NHTSA lists ${recalls.length} safety recall(s) for this model year — have all recalls been completed at an authorized dealer?`
          : "No model-year recalls listed right now — can I still verify maintenance records?",
        "Does the VIN on the dashboard match the driver-side door jamb sticker and title?"
      ],
      walkAwayScript:
        recalls.length > 0
          ? "I checked the NHTSA safety database and saw recalls on this model year. I'll need dealer proof they were fixed or a price adjustment."
          : "The NHTSA baseline looks solid. Let's verify title ownership and take a test drive.",
      shortlisted: true,
      createdAt: new Date().toLocaleDateString("en-US")
    };

    // Save automatically into Garage / Shortlist
    state.cars.unshift(lastVinDraft);
    trackFunnelEvent("stage_2_vin_nhtsa_check", {
      vin: vinRaw,
      carName: fullName,
      recallsCount: recalls.length,
      complaintsCount: complaints.length,
      verdict: verdict.code
    });
    saveState();

    const recallCards = recalls.length
      ? recalls
          .slice(0, 4)
          .map(
            (r) => `
          <div class="flag-row">
            <span class="sev-badge sev-medium">RECALL</span>
            <div>
              <strong>${escapeHtml(r.Component || "Safety Recall")}</strong>
              <div class="brand-sub">${escapeHtml((r.Summary || "").slice(0, 170))}${(r.Summary || "").length > 170 ? "..." : ""}</div>
            </div>
          </div>`
          )
          .join("")
      : `<div class="flag-row"><span class="sev-badge sev-low">0 RECALLS</span><div><strong>No model-year safety recalls returned by NHTSA</strong></div></div>`;

    box.innerHTML = `
      <div class="result-panel">
        <div class="result-head">
          <div>
            <div class="verdict-pill ${verdict.css}">${verdict.label}</div>
            <h3 style="margin-top:8px;">${escapeHtml(fullName)} (${escapeHtml(trim)})</h3>
            <div class="brand-sub">VIN: <strong>${escapeHtml(vinRaw)}</strong></div>
          </div>
          <div class="risk-meter">Recalls: <strong>${recalls.length}</strong> • Complaints: <strong>${complaints.length}</strong></div>
        </div>

        <div class="specs-grid">
          <div class="spec-chip"><span>Body</span><strong>${escapeHtml(body)}</strong></div>
          <div class="spec-chip"><span>Engine / Fuel</span><strong>${escapeHtml(engine)}</strong></div>
          <div class="spec-chip"><span>Assembly Plant</span><strong>${escapeHtml(plant)}</strong></div>
        </div>

        <div class="result-section">
          <div class="mini-label">Official U.S. NHTSA Safety Recalls (${recalls.length})</div>
          ${recallCards}
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
          <button type="button" class="btn btn-cyan" onclick="copyCarReport('${lastVinDraft.id}')">Copy World-Class Email / Share Report</button>
          <button type="button" class="btn btn-install" onclick="markCarBought('${lastVinDraft.id}')">🏆 Mark This Car as Bought</button>
        </div>
      </div>
    `;

    setBanner(`NHTSA VIN Check saved for ${fullName}! Remaining VIN Pass credits: ${state.vinCredits}.`);
  } catch (err) {
    box.innerHTML = `<div class="status-banner">Could not reach NHTSA right now. Please check your internet connection and try again.</div>`;
  }
}

/* =========================================================
   GARAGE / SHORTLIST BOARD + WORLD-CLASS EMAIL & STATUS SHARE
   ========================================================= */
function buildWorldClassReportText(car) {
  const lines = [
    "==========================================",
    "CARDesk US — BUYERCHECK PRE-BUY REPORT",
    "==========================================",
    `Buyer Profile : ${state.email || "Guest Buyer"} (${state.usState})`,
    `Vehicle       : ${car.name}`,
    `VIN           : ${car.vin || "Not entered yet"}`,
    `Check Type    : ${car.source}`,
    `Verdict       : ${car.verdict} (Risk Score: ${car.riskScore}/100)`,
    car.recallsCount !== null ? `NHTSA Recalls : ${car.recallsCount} | Owner Complaints: ${car.complaintsCount}` : "",
    "",
    "TOP FINDINGS:",
    ...(car.flags && car.flags.length ? car.flags.map((f) => `• ${f}`) : ["• No major text/recall triggers flagged"]),
    "",
    "QUESTIONS TO ASK THE SELLER:",
    ...(car.questions || []).map((q, i) => `${i + 1}. ${q}`),
    "",
    "WALK-AWAY / NEGOTIATION SCRIPT:",
    `"${car.walkAwayScript || ""}"`,
    "",
    "Verified on buyercheck.cardeskus.com — Free AI + U.S. NHTSA Buyer Funnel",
    "Disclaimer: Self-help informational checklist, not legal advice or certified inspection."
  ];
  return lines.filter((l) => l !== "").join("\n");
}

window.copyCarReport = async function (carId) {
  const car = state.cars.find((c) => c.id === carId);
  if (!car) return;
  const text = buildWorldClassReportText(car);
  try {
    await navigator.clipboard.writeText(text);
    setBanner(`World-class report copied for "${car.name}"! Paste into Gmail, WhatsApp, or Notes.`);
  } catch {
    setBanner("Report ready — please copy manually if clipboard permission is blocked.");
  }
};

window.toggleShortlist = function (carId) {
  const car = state.cars.find((c) => c.id === carId);
  if (!car) return;
  car.shortlisted = !car.shortlisted;
  saveState();
};

window.markCarBought = function (carId) {
  state.boughtCarId = carId;
  const car = state.cars.find((c) => c.id === carId);
  trackFunnelEvent("stage_4_car_bought", { carName: car ? car.name : "Final Car", vin: car ? car.vin : "" });
  saveState();
  setBanner(`MISSION COMPLETE! "${car ? car.name : "Your car"}" is marked as BOUGHT! Copy your shareable status card below.`);
};

window.removeCar = function (carId) {
  state.cars = state.cars.filter((c) => c.id !== carId);
  if (state.boughtCarId === carId) state.boughtCarId = null;
  saveState();
};

function renderGarage() {
  const container = document.getElementById("garageList");
  if (!container) return;

  if (!state.cars.length) {
    container.innerHTML = `<div class="status-banner">No cars logged yet. Run a Free AI Listing Scan or a 17-digit NHTSA VIN Check above to start building your visual shortlist!</div>`;
    return;
  }

  container.innerHTML = state.cars
    .map((car) => {
      const isBought = state.boughtCarId === car.id;
      const verdictClass =
        car.verdict === "NO" ? "verdict-no" : car.verdict === "CAUTION" ? "verdict-caution" : "verdict-yes";
      return `
      <div class="garage-card ${isBought ? "bought-glow" : ""}">
        <div class="garage-top">
          <div>
            <span class="verdict-pill ${verdictClass}">${escapeHtml(car.verdict)}</span>
            ${car.shortlisted ? `<span class="badge-neon" style="margin-left:6px;">★ SHORTLISTED</span>` : ""}
            ${isBought ? `<span class="popular-inline">🏆 CAR BOUGHT</span>` : ""}
            <h4 style="margin-top:8px;">${escapeHtml(car.name)}</h4>
            <div class="brand-sub">
              ${car.vin ? `VIN: ${escapeHtml(car.vin)} • ` : ""}${escapeHtml(car.source)} • ${escapeHtml(car.createdAt)}
              ${car.recallsCount !== null ? ` • Recalls: ${car.recallsCount}` : ""}
            </div>
          </div>
          <div class="garage-actions">
            <button type="button" class="btn btn-ghost btn-sm" onclick="toggleShortlist('${car.id}')">
              ${car.shortlisted ? "Unstar" : "★ Shortlist"}
            </button>
            <button type="button" class="btn btn-cyan btn-sm" onclick="copyCarReport('${car.id}')">Copy Report</button>
            <button type="button" class="btn btn-install btn-sm" onclick="markCarBought('${car.id}')">🏆 Bought</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="removeCar('${car.id}')">✕</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

/* =========================================================
   UI RENDERER & JOURNEY VISUALIZATION
   ========================================================= */
function renderAll() {
  const emailEl = document.getElementById("buyerEmail");
  if (emailEl && document.activeElement !== emailEl) emailEl.value = state.email;

  const stateEl = document.getElementById("usState");
  if (stateEl) stateEl.value = state.usState;

  const sellerEl = document.getElementById("sellerType");
  if (sellerEl) sellerEl.value = state.sellerType;

  const remaining = Math.max(0, CONFIG.DAILY_FREE_AI_LIMIT - state.freeScansUsedToday);
  const shortlistedCount = state.cars.filter((c) => c.shortlisted).length;
  const vinCheckedCount = state.cars.filter((c) => Boolean(c.vin)).length;

  document.getElementById("freeScansLeft").textContent = `${remaining} / ${CONFIG.DAILY_FREE_AI_LIMIT}`;
  document.getElementById("carsCheckedCount").textContent = String(state.carsChecked);
  document.getElementById("shortlistedCount").textContent = String(shortlistedCount);
  document.getElementById("vinCreditsCount").textContent = String(state.vinCredits);

  const badge = document.getElementById("profileBadge");
  if (badge) badge.textContent = state.email ? `Auto-Saved: ${state.email}` : "Guest Session";

  let pct = 25;
  const s1 = document.getElementById("stage1Card");
  const s2 = document.getElementById("stage2Card");
  const s3 = document.getElementById("stage3Card");
  const s4 = document.getElementById("stage4Card");

  [s1, s2, s3, s4].forEach((el) => el && el.classList.remove("active", "completed"));

  if (state.carsChecked > 0 || state.cars.length > 0) {
    s1.classList.add("completed");
    document.getElementById("stage1Pill").textContent = `${state.carsChecked} Scanned`;
    pct = 45;
  } else {
    s1.classList.add("active");
    document.getElementById("stage1Pill").textContent = "Active";
  }

  if (vinCheckedCount > 0) {
    s2.classList.add("completed");
    document.getElementById("stage2Pill").textContent = `${vinCheckedCount} VIN Checked`;
    pct = 70;
  } else if (shortlistedCount > 0 || state.vinCredits > 0) {
    s2.classList.add("active");
    document.getElementById("stage2Pill").textContent = `${state.vinCredits} Credit(s)`;
    pct = Math.max(pct, 55);
  } else {
    document.getElementById("stage2Pill").textContent = "Locked";
  }

  if (shortlistedCount >= 2 || vinCheckedCount >= 2) {
    s3.classList.add("active");
    document.getElementById("stage3Pill").textContent = "Finalists Ready";
    pct = Math.max(pct, 85);
  } else {
    document.getElementById("stage3Pill").textContent = "Phase 2";
  }

  const victoryBox = document.getElementById("victoryBanner");
  if (state.boughtCarId) {
    const boughtCar = state.cars.find((c) => c.id === state.boughtCarId);
    s4.classList.add("completed");
    document.getElementById("stage4Pill").textContent = "Bought!";
    pct = 100;
    if (victoryBox && boughtCar) {
      victoryBox.style.display = "block";
      victoryBox.innerHTML = `
        <strong>🏆 MISSION ACCOMPLISHED!</strong> You screened <strong>${state.carsChecked}</strong> listing(s),
        shortlisted <strong>${shortlistedCount}</strong>, ran <strong>${vinCheckedCount}</strong> NHTSA VIN check(s),
        and closed on <strong>${escapeHtml(boughtCar.name)}</strong>!
      `;
    }
  } else {
    document.getElementById("stage4Pill").textContent = "Goal";
    if (victoryBox) victoryBox.style.display = "none";
  }

  document.getElementById("journeyProgressBar").style.width = `${pct}%`;
  document.getElementById("journeyPercentLabel").textContent = `${pct}% Mission`;

  renderGarage();
}

/* =========================================================
   BOOT & EVENT LISTENERS
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  populateStates();
  renderAll();
  trackFunnelEvent("stage_0_visit");

  document.getElementById("saveProfileBtn")?.addEventListener("click", () => {
    const emailInput = document.getElementById("buyerEmail").value.trim();
    state.email = emailInput;
    state.usState = document.getElementById("usState").value;
    state.sellerType = document.getElementById("sellerType").value;
    trackFunnelEvent("stage_0_profile_saved");
    saveState();
    setBanner(
      emailInput
        ? `Auto-login profile saved for ${emailInput} (${state.usState}). Your car journey is synced on this device.`
        : `State updated to ${state.usState}. Enter your Gmail/Email to save your buyer profile.`
    );
  });

  document.getElementById("clearProfileBtn")?.addEventListener("click", () => {
    state.email = "";
    saveState();
    setBanner("Signed out of saved email profile on this device.");
  });

  document.getElementById("runAiScanBtn")?.addEventListener("click", runAiListingScan);

  document.getElementById("loadSampleListingBtn")?.addEventListener("click", () => {
    document.getElementById("carNameInput").value = "2018 Honda Accord Sport";
    document.getElementById("carPriceInput").value = "13500";
    document.getElementById("listingTextInput").value =
      "Selling for a friend. Runs great! Check engine light is on, probably just an easy fix O2 sensor. Lost title in move so bill of sale only. Cash today only, must sell today, no test drive without cash in hand.";
    setBanner("Sample risky listing loaded! Click 'Run Free AI Red-Flag Scan' to see the verdict.");
  });

  document.getElementById("runVinCheckBtn")?.addEventListener("click", runVinNhtsaCheck);

  document.getElementById("loadSampleVinBtn")?.addEventListener("click", () => {
    document.getElementById("vinInput").value = "1HGCV1F30JA000001";
    setBanner("Sample 17-digit Honda VIN loaded! Click 'Run Official NHTSA VIN Check' to pull live U.S. govt data.");
  });

  document.getElementById("unlockPassBtn")?.addEventListener("click", () => {
    trackFunnelEvent("stage_2_checkout_clicked", { plan: "5_car_pass_8_99" });
    if (CONFIG.DODO_CHECKOUT_URL) {
      window.open(CONFIG.DODO_CHECKOUT_URL, "_blank");
    } else {
      state.vinCredits += CONFIG.PASS_CREDITS_AMOUNT;
      saveState();
      setBanner("Demo Mode: +5 VIN & NHTSA Pass credits added! Connect your Dodo Payments $8.99 URL in CONFIG.DODO_CHECKOUT_URL when ready.");
    }
  });

  document.getElementById("deepHistoryBtn")?.addEventListener("click", () => {
    trackFunnelEvent("stage_3_waitlist_clicked", { plan: "deep_history_13_99" });
    setBanner("Layer 3 Deep VIN History ($13.99 — Title/Salvage/Odometer API) is scheduled for Phase 2 after launch! Your interest has been logged.");
  });

  document.getElementById("copyJourneyCardBtn")?.addEventListener("click", async () => {
    const boughtCar = state.cars.find((c) => c.id === state.boughtCarId);
    const shortlistedCount = state.cars.filter((c) => c.shortlisted).length;
    const shareText = `🚗 My Car-Buying Mission on BuyerCheck (CarDesk US):\n• Listings Screened: ${state.carsChecked}\n• Shortlisted Contenders: ${shortlistedCount}\n• Final Decision: ${boughtCar ? `BOUGHT ${boughtCar.name} 🏆` : "In Progress"}\nCheck used cars before you buy 👉 https://buyercheck.cardeskus.com`;
    try {
      await navigator.clipboard.writeText(shareText);
      setBanner("Shareable Status / Word-of-Mouth Card copied! Paste it on WhatsApp, Instagram, or X.");
    } catch {
      setBanner(shareText);
    }
  });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  document.getElementById("installBtn")?.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
    } else {
      setBanner("To install BuyerCheck as an app: tap your browser menu and select 'Add to Home Screen' or 'Install App'.");
    }
  });
});
