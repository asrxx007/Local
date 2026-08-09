function safeJson(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch (e) {
    return fallback;
  }
}

function makeId() {
  return Date.now().toString() + Math.random().toString(16).slice(2);
}

function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const DEFAULT_DRIVERS = [
  { name: "Ravi", note: "" },
  { name: "Sharan", note: "" },
  { name: "Tegbir", note: "" },
  { name: "Sandhu", note: "" },
  { name: "Jagdip", note: "" },
  { name: "Jashan", note: "" },
  { name: "Bobby", note: "" },
  { name: "Gurjeet", note: "" },
  { name: "Gurdip", note: "" },
  { name: "Inder", note: "" },
  { name: "Love", note: "" },
  { name: "Navkrn", note: "" },
  { name: "Jass", note: "" },
  { name: "Gagan", note: "" },
  { name: "Gurmindr", note: "" },
  { name: "Akash", note: "" },
];

let TAB_ID = sessionStorage.getItem("dispatch_tab_id");
if (!TAB_ID) {
  TAB_ID = "tab_" + makeId();
  sessionStorage.setItem("dispatch_tab_id", TAB_ID);
}
const STORE_PREFIX = "dispatch_" + TAB_ID + "_";

function tabGet(key, fallback) {
  try {
    const saved = sessionStorage.getItem(STORE_PREFIX + key);
    return saved ? JSON.parse(saved) : fallback;
  } catch (e) {
    return fallback;
  }
}
function tabSet(key, value) {
  sessionStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
}
function tabRemove(key) {
  sessionStorage.removeItem(STORE_PREFIX + key);
}

let trips = tabGet("trips", []);
let drivers = tabGet("drivers", DEFAULT_DRIVERS);
let histories = tabGet("history", []);
let undoStack = tabGet("undo", []);
let redoStack = tabGet("redo", []);
let searchQuery = "";

function normalizeDriver(d) {
  return {
    id: d.id || makeId(),
    name: typeof d === "string" ? d : (d.name || "Driver"),
    note: typeof d === "string" ? "" : (d.note || "")
  };
}

drivers = drivers.map(normalizeDriver);

trips = trips.map(t => ({
  id: t.id || makeId(),
  raw: t.raw || "",
  pickupTime: normalizeTime(t.pickupTime || "") || "ASAP",
  pickupStatus: t.pickupStatus || "UNASSIGNED",
  pickupDriver: t.pickupDriver ?? t.driver ?? "",
  returnDriver: t.returnDriver || "",
  returnTime: normalizeTime(t.returnTime || "") || "R/T",
  returnStatus: t.returnStatus || "UNASSIGNED",
  notes: t.notes || "",
  passenger: t.passenger || parsePassenger(t.raw || ""),
  service: t.service || detectService(t.raw || ""),
  editing: false
}));

function saveData() {
  tabSet("trips", trips);
  tabSet("drivers", drivers);
  tabSet("history", histories);
  tabSet("undo", undoStack.slice(-80));
  tabSet("redo", redoStack.slice(-80));
}

function snapshotState() {
  return {
    trips: JSON.parse(JSON.stringify(trips)),
    drivers: JSON.parse(JSON.stringify(drivers)),
    histories: JSON.parse(JSON.stringify(histories))
  };
}

function pushUndo() {
  undoStack.push(snapshotState());
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  saveData();
}

function restoreState(state) {
  trips = (state.trips || []).map(t => ({ ...t, editing: false }));
  drivers = (state.drivers || DEFAULT_DRIVERS).map(normalizeDriver);
  histories = state.histories || histories;
}

function undoAction() {
  const last = undoStack.pop();
  if (!last) {
    alert("No undo available.");
    return;
  }
  redoStack.push(snapshotState());
  restoreState(last);
  saveData();
  render();
}
function redoAction() {
  const next = redoStack.pop();
  if (!next) {
    alert("No redo available.");
    return;
  }
  undoStack.push(snapshotState());
  restoreState(next);
  saveData();
  render();
}

function currentLAMinutes() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(new Date());
  const h = Number(parts.find(p => p.type === "hour").value);
  const m = Number(parts.find(p => p.type === "minute").value);
  return (h % 24) * 60 + m;
}

function allTripsSortMinutes(t) {
  const val = String(t.pickupTime || "").toUpperCase();
  if (val === "ASAP") return currentLAMinutes();
  return timeToMinutes(t.pickupTime);
}

function tripSearchBlob(t) {
  return [
    t.pickupDriver, t.returnDriver, t.pickupTime, t.returnTime,
    t.pickupStatus, t.returnStatus, t.notes, t.passenger, t.raw, t.service
  ].join(" ").toLowerCase();
}

function tripMatchesSearch(t) {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;
  if (t._searchBlob == null) t._searchBlob = tripSearchBlob(t);
  return t._searchBlob.includes(q);
}

function invalidateTripSearch(t) {
  if (t) t._searchBlob = null;
}

let _searchRaf = 0;

function setQuickSearch(value) {
  searchQuery = value || "";
  const clearBtn = document.getElementById("quickSearchClear");
  if (clearBtn) clearBtn.style.display = searchQuery ? "flex" : "none";
  if (_searchRaf) cancelAnimationFrame(_searchRaf);
  _searchRaf = requestAnimationFrame(applyLiveSearch);
}

function clearQuickSearch() {
  searchQuery = "";
  const input = document.getElementById("quickSearch");
  if (input) input.value = "";
  const clearBtn = document.getElementById("quickSearchClear");
  if (clearBtn) clearBtn.style.display = "none";
  if (_searchRaf) cancelAnimationFrame(_searchRaf);
  _searchRaf = requestAnimationFrame(applyLiveSearch);
}

function applyLiveSearch() {
  _searchRaf = 0;
  const list = document.getElementById("allTripsList");
  let rows = list ? list.querySelectorAll("tr[data-trip-id]") : [];
  const visibleCount = trips.filter(t => !t.hidden).length;

  if (!list || rows.length !== visibleCount) {
    renderAllTrips();
    renderDrivers();
    return;
  }

  const byId = new Map(trips.map(t => [t.id, t]));
  rows.forEach(tr => {
    const t = byId.get(tr.dataset.tripId);
    tr.style.display = (t && !t.hidden && tripMatchesSearch(t)) ? "" : "none";
  });
  renderDrivers();
}

function normalizeTime(t) {
  if (!t) return "";
  const special = String(t).trim().toUpperCase();
  if (["ASAP", "R/T", "RT", "YES", "NO"].includes(special)) {
    if (special === "RT" || special === "YES") return "R/T";
    return special;
  }

  let s = String(t).toLowerCase().replace(/\s+/g, "").trim().replace(".", ":");
  let match = s.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)$/i);
  if (!match) return t;

  let h = parseInt(match[1], 10);
  let m = match[2] || "00";
  let ap = match[3].toUpperCase();

  if (h > 12 && !s.includes(":")) {
    const digits = s.replace(/am|pm/i, "");
    if (digits.length === 3) {
      h = parseInt(digits.slice(0, 1), 10);
      m = digits.slice(1);
    } else if (digits.length === 4) {
      h = parseInt(digits.slice(0, 2), 10);
      m = digits.slice(2);
    }
  }

  if (h < 1 || h > 12 || parseInt(m, 10) > 59) return t;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

function timeToMinutes(t) {
  const val = String(t || "").toUpperCase();
  if (!t || ["ASAP", "R/T", "NO"].includes(val)) return 99999;

  let m = String(t).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return 99999;

  let h = +m[1];
  let min = +m[2];
  let ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function minutesToTime(total) {
  let h24 = Math.floor(total / 60) % 24;
  let m = total % 60;
  let ap = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

let _timeOptsPickupBase = null;
let _timeOptsReturnBase = null;

function buildTimeOptionsBase(type) {
  const special = type === "return" ? ["R/T", "NO", "ASAP"] : ["ASAP", "R/T", "NO"];
  let html = special.map(v => `<option value="${v}">${v}</option>`).join("");
  for (let mins = 12 * 60; mins < 36 * 60; mins += 5) {
    const t = minutesToTime(mins % 1440);
    html += `<option value="${t}">${t}</option>`;
  }
  return html;
}

function timeOptions(selected, type = "pickup") {
  selected = normalizeTime(selected);
  if (type === "return") {
    if (!_timeOptsReturnBase) _timeOptsReturnBase = buildTimeOptionsBase("return");
    if (!selected) return _timeOptsReturnBase;
    return _timeOptsReturnBase.replace(
      `value="${selected}"`,
      `value="${selected}" selected`
    );
  }
  if (!_timeOptsPickupBase) _timeOptsPickupBase = buildTimeOptionsBase("pickup");
  if (!selected) return _timeOptsPickupBase;
  return _timeOptsPickupBase.replace(
    `value="${selected}"`,
    `value="${selected}" selected`
  );
}

function detectService(text) {
  let t = String(text || "").toLowerCase();
  if (t.includes("wheelchair") || t.includes("w/c") || /\bwc\b/.test(t)) return "WC";
  if (t.includes("gurney") || /\bgur\b/.test(t)) return "GUR";
  if (t.includes("bariatric") || /\bbar\b/.test(t)) return "BAR";
  return "AMB";
}

function parsePassenger(raw) {
  let text = String(raw || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  let m = text.match(/---\s*[A-Z0-9]+\s*--\s*(.*?)\s*--/i)
    || text.match(/\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*(.*?)\s+(R\/T|WC|W\/C|AMB|GUR|BAR|PU)/i)
    || text.match(/^([A-Za-z,.'\-\s]+?)\s+(BMH|Mercy|TRCB|CCRH|room|Room|at)/i);
  return m ? m[1].trim().toUpperCase() : "";
}

function parseNotes(raw) {
  let t = String(raw || "");
  let m = t.match(/-Notes:\s*(.*?)(?:\s+-Return@|$)/i) || t.match(/\bNotes?:\s*(.*)$/i);
  return m ? m[1].trim() : "";
}

function parseTrip(raw, pickupDriver = "", returnDriver = "", pickupTime = "", returnTime = "") {
  let text = String(raw || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();

  if (!pickupTime) {
    let m = text.match(/Pickup\s+(\d{1,2}(?::|\.)?\d{0,2}\s*[AP]M)/i)
      || text.match(/\bPU\s*(\d{1,2}(?::|\.)?\d{0,2}\s*(?:am|pm))/i)
      || text.match(/\bat\s*(\d{1,2}(?::|\.)?\d{0,2}\s*(?:am|pm))/i)
      || text.match(/\b(\d{1,2}(?::|\.)\d{2}\s*[AP]M)\b/i);
    pickupTime = m ? normalizeTime(m[1]) : "ASAP";
  }

  if (!returnTime) {
    let m = text.match(/Return@?\s*(\d{1,2}(?::|\.)?\d{0,2}\s*(?:am|pm))/i);
    returnTime = m ? normalizeTime(m[1]) : "R/T";
  }

  return {
    id: makeId(),
    raw,
    pickupDriver,
    returnDriver,
    pickupTime: normalizeTime(pickupTime) || "ASAP",
    pickupStatus: "UNASSIGNED",
    returnTime: normalizeTime(returnTime) || "R/T",
    returnStatus: "UNASSIGNED",
    notes: parseNotes(raw),
    passenger: parsePassenger(raw),
    service: detectService(" " + text + " "),
    hidden: false,
    editing: false
  };
}


function titleCaseCity(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function extractCityBeforeStateZip(part) {
  let t = String(part || "").replace(/\s+/g, " ").trim();
  const m = t.match(/(.+?)\s+CA\s+\d{5}(?:-\d{4})?\b/i);
  if (!m) return "";
  const before = m[1].trim();
  const cityList = ["BAKERSFIELD","FRESNO","DELANO","WASCO","SHAFTER","MCFARLAND","TAFT","RIDGECREST","LAKE ISABELLA","CALIFORNIA CITY","PALMDALE","LANCASTER","ARVIN","LAMONT","MADERA","PASADENA","LOS ANGELES","VISALIA","TULARE","PORTERVILLE","MOJAVE","TEHACHAPI","BUTTONWILLOW","KERNVILLE","WOFFORD HEIGHTS"];
  for (const city of cityList) {
    if (new RegExp("\\b" + city.replace(/ /g, "\\s+") + "$", "i").test(before)) return titleCaseCity(city);
  }
  const words = before.split(/\s+/);
  return titleCaseCity(words.slice(-1).join(" "));
}

function getTripCities(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  const m = text.match(/\bFROM\b\s+(.+?)\s+\bTO\b\s+(.+?)(?:\s+PAX:|\s+BILL TO|\s+-Notes:|\s+-Return@|$)/i);
  let pu = "", du = "";
  if (m) {
    pu = extractCityBeforeStateZip(m[1]);
    du = extractCityBeforeStateZip(m[2]);
  }
  if (!pu) {
    const fm = text.match(/\bFROM\b\s+(.+?)\s+\bTO\b/i);
    pu = extractCityBeforeStateZip(fm ? fm[1] : "");
  }
  if (!du) {
    const tm = text.match(/\bTO\b\s+(.+?)(?:\s+PAX:|\s+BILL TO|\s+-Notes:|\s+-Return@|$)/i);
    du = extractCityBeforeStateZip(tm ? tm[1] : "");
  }
  return { pickupCity: pu, dropCity: du };
}

function detectTripRoute(raw) {
  const { pickupCity, dropCity } = getTripCities(raw);
  if (pickupCity && dropCity) {
    return pickupCity.toLowerCase() === dropCity.toLowerCase() ? `${pickupCity} local` : `${pickupCity} to ${dropCity}`;
  }
  return pickupCity || dropCity || "";
}

function detectTripRouteByLeg(raw, leg) {
  const { pickupCity, dropCity } = getTripCities(raw);
  if (pickupCity && dropCity) {
    if (pickupCity.toLowerCase() === dropCity.toLowerCase()) return `${pickupCity} local`;
    return leg === "return" ? `${dropCity} --- ${pickupCity}` : `${pickupCity} --- ${dropCity}`;
  }
  return pickupCity || dropCity || "";
}

function addRouteToDriverNote(driverName, raw) {
  // Disabled: assigning trips should not auto-write pickup/drop city into Driver Notes.
  return;
}

function assignTripToDriver(driverName, tripId, leg) {
  const t = trips.find(x => x.id === tripId);
  if (!t) return;
  pushUndo();
  if (leg === "return") {
    t.returnDriver = driverName;
    if (!t.returnStatus) t.returnStatus = "UNASSIGNED";
  } else {
    t.pickupDriver = driverName;
    if (!t.pickupStatus) t.pickupStatus = "UNASSIGNED";
  }
  invalidateTripSearch(t);
  saveData();
  closeModal("assignDriverModal");
  render();
}

function openAssignTripModal(driverName) {
  let modal = document.getElementById("assignDriverModal");
  
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "assignDriverModal";
    modal.className = "modal";
    document.body.appendChild(modal);
  }

   const allAvailableTrips = sortedTrips(trips.filter(t => !t.hidden && tripMatchesSearch(t)), "all");

  // Initial render
  modal.innerHTML = `
    <div class="modalBox bigModal">
      <div class="modalHead">
        <b>Assign trip to ${escapeHtml(driverName)}</b>
        <button class="xBtn" onclick="closeModal('assignDriverModal')">×</button>
      </div>
      
      <div class="modalHint">Click Pick Time or Return Time to assign directly.</div>
      
      <!-- Search Box -->
      <div class="assignTripSearch">
        <input type="text" id="patientSearchInput" 
               placeholder="Search patient by name..." 
               autocomplete="off">
      </div>

      <div class="assignTripList">
        <table class="assignTripTable" id="assignTripTable">
          <colgroup>
            <col style="width: 18%;">
            <col style="width: 18%;">
            <col>
          </colgroup>
          <thead>
            <tr>
              <th>Pick Time</th>
              <th>Return Time</th>
              <th>Patient Name</th>
            </tr>
          </thead>
          <tbody id="assignTripTableBody"></tbody>
        </table>
      </div>
    </div>
  `;

  const searchInput = modal.querySelector("#patientSearchInput");
  const tbody = modal.querySelector("#assignTripTableBody");

  // Function to render filtered trips
  function renderTrips(filterText = "") {
    const filtered = allAvailableTrips.filter(trip => {
      if (!filterText) return true;
      return (trip.passenger || "")
        .toLowerCase()
        .includes(filterText.toLowerCase());
    });

    const rowsHTML = filtered.length 
      ? filtered.map(t => `
          <tr class="assignTripTableRow">
            <td class="assignTripPick" title="Click to assign pickup"
                onclick="assignTripToDriver('${escapeHtml(driverName)}','${t.id}','pickup')">
              ${escapeHtml(t.pickupTime || "ASAP")}
            </td>
            <td class="assignTripReturn" title="Click to assign return"
                onclick="assignTripToDriver('${escapeHtml(driverName)}','${t.id}','return')">
              ${escapeHtml(t.returnTime || "R/T")}
            </td>
            <td class="assignTripPatient">
              <b>${escapeHtml(t.passenger || "No patient name")}</b>
            </td>
          </tr>`).join("")
      : `<tr><td colspan="3" class="emptyText">No matching trips found.</td></tr>`;

    tbody.innerHTML = rowsHTML;
  }

  // Initial render
  renderTrips();

  // Live search
  searchInput.addEventListener("input", () => {
    renderTrips(searchInput.value.trim());
  });

  // Auto-focus the search box
  setTimeout(() => searchInput.focus(), 100);

  modal.style.display = "flex";
}

function setDriverTripStatus(id, leg, status) {
  const t = trips.find(x => x.id === id);
  if (!t) return;
  const field = leg === "return" ? "returnStatus" : "pickupStatus";
  pushUndo();
  t[field] = status;
  invalidateTripSearch(t);
  saveData();
  closeModal("driverStatusModal");
  render();
}

function changeDriverTripStatus(id, leg) {
  const t = trips.find(x => x.id === id);
  if (!t) return;
  const current = leg === "return" ? t.returnStatus : t.pickupStatus;
  let modal = document.getElementById("driverStatusModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "driverStatusModal";
    modal.className = "modal";
    document.body.appendChild(modal);
  }
  const opts = [
    ["ASSIGNED", "Assigned"],
    ["LOADED", "Loaded"],
    ["DONE", "Done"],
    ["CANCELLED", "Cancel"],
    ["UNASSIGNED", "Unassigned"]
  ];
  const buttons = opts.map(([val, label]) => `
    <button class="statusChoiceBtn ${statusClass(val)} ${val === current ? 'selectedStatusChoice' : ''}"
      onclick="setDriverTripStatus('${id}','${leg}','${val}')">${label}</button>`).join("");
  const route = detectTripRouteByLeg(t.raw, leg);
  modal.innerHTML = `
    <div class="modalBox statusModalBox">
      <div class="modalHead"><b>${escapeHtml(t.passenger || "Trip status")}</b><button class="xBtn" onclick="closeModal('driverStatusModal')">×</button></div>
      <div class="driverStatusRoute">${escapeHtml(route || "")}</div>
      <div class="modalHint">Click a status to change directly.</div>
      <div class="statusChoiceGrid">${buttons}</div>
    </div>`;
  modal.style.display = "flex";
}

function getSavedTripRowHeights() { return tabGet("trip_row_heights", {}); }
function saveTripRowHeight(id, h) {
  const heights = getSavedTripRowHeights();
  heights[id] = Math.round(h);
  tabSet("trip_row_heights", heights);
}
function getSavedDriverRowHeight() { return tabGet("driver_row_height", 120); }
function saveDriverRowHeight(h) { tabSet("driver_row_height", Math.round(h)); }

function statusOptions(selected) {
    const opts = [
      ["ASSIGNED", "Assigned"],
      ["DONE", "Done"],
      ["LOADED", "Loaded"],
      ["CANCELLED", "Cancelled"],
      ["UNASSIGNED", "Unassigned"]

    ];
    
    return opts.map(o => `<option value="${o[0]}" ${selected === o[0] ? "selected" : ""}>${o[1]}</option>`).join("");
}

function driverOptions(selected) {
  let html = `<option value=""></option>`;
  drivers.forEach(d => {
    html += `<option value="${escapeHtml(d.name)}" ${selected === d.name ? "selected" : ""}>${escapeHtml(d.name)}</option>`;
  });
  return html;
}

function statusClass(status) {
  if (status === "UNASSIGNED") return "statusUnassigned";
  if (status === "ASSIGNED") return "statusAssigned";
  if (status === "LOADED") return "statusLoaded";
  if (status === "DONE") return "statusDone";
  if (status === "CANCELLED") return "statusCancelled";
  return "";
}

function serviceClass(service) {
  if (service === "WC") return "wc";
  if (service === "GUR") return "gur";
  if (service === "BAR") return "bar";
  return "amb";
}

function sortedTrips(list = trips, mode = "normal") {
  return [...list].sort((a, b) => {
    const av = mode === "all" ? allTripsSortMinutes(a) : timeToMinutes(a.pickupTime);
    const bv = mode === "all" ? allTripsSortMinutes(b) : timeToMinutes(b.pickupTime);
    return av - bv;
  });
}

function addTripFromModal() {
  const rawEl = document.getElementById("modalTripRaw");
  const raw = rawEl ? rawEl.value.trim() : "";
  if (!raw) return;

  const selectedPickupTime = document.getElementById("modalPickupTime").value;
  const selectedReturnTime = document.getElementById("modalReturnTime").value;

  const trip = parseTrip(
    raw,
    document.getElementById("modalPickupDriver").value,
    document.getElementById("modalReturnDriver").value,
    selectedPickupTime === "ASAP" ? "" : selectedPickupTime,
    selectedReturnTime === "R/T" ? "" : selectedReturnTime
  );

  trip.pickupStatus = document.getElementById("modalPickupStatus").value || "UNASSIGNED";
  trip.returnStatus = document.getElementById("modalReturnStatus").value || "UNASSIGNED";
  trip.notes = document.getElementById("modalNotes").value || trip.notes;
  trip.passenger = document.getElementById("modalPassenger").value || trip.passenger;

  pushUndo();
  trips.push(trip);
  saveData();
  closeModal("addTripModal");
  render();
}

function addTripFromNewRow() { addTripFromModal(); }

function addTripOnEnter(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    addTripFromModal();
  }
}

function closeAddTripByOutside() {
  const rawEl = document.getElementById("modalTripRaw");
  const raw = rawEl ? rawEl.value.trim() : "";
  if (raw) {
    addTripFromModal();
  } else {
    closeModal("addTripModal");
  }
}

function openAddTripModal() {
  document.getElementById("addTripModal").style.display = "flex";
  fillAddTripModal();
  setTimeout(() => {
    const raw = document.getElementById("modalTripRaw");
    if (raw) raw.focus();
  }, 50);
}

function openImportTripModal(){
  document.getElementById("importTripModal").style.display = "flex";
}

function fillAddTripModal() {
  document.getElementById("addTripFields").innerHTML = `
    <div class="addTripGrid">
      <label>Assigned Driver<select id="modalPickupDriver" class="driverSelect">${driverOptions("")}</select></label>
      <label>Pick Time<select id="modalPickupTime" class="timeSelect">${timeOptions("ASAP", "pickup")}</select></label>
      <label>Pick Status<select id="modalPickupStatus" class="statusSelect statusUnassigned" onchange="this.className='statusSelect '+statusClass(this.value)">${statusOptions("UNASSIGNED")}</select></label>
      <label>Return Driver<select id="modalReturnDriver" class="driverSelect">${driverOptions("")}</select></label>
      <label>Return Time<select id="modalReturnTime" class="timeSelect">${timeOptions("R/T", "return")}</select></label>
      <label>Return Status<select id="modalReturnStatus" class="statusSelect statusUnassigned" onchange="this.className='statusSelect '+statusClass(this.value)">${statusOptions("UNASSIGNED")}</select></label>
      <label>Notes<input id="modalNotes" class="smallTextInput" placeholder="Notes"></label>
      <label>Patient Name<input id="modalPassenger" class="smallTextInput" placeholder="Patient name"></label>
      <label class="fullAddTrip">Trip Details<textarea id="modalTripRaw" class="tripDetailsInput bigTripBox" placeholder="Paste trip details here, then press Enter" onkeydown="addTripOnEnter(event)"></textarea></label>
    </div>`;
}

function updateTripField(id, field, value, renderNow = true) {
  const t = trips.find(x => x.id === id);
  if (!t) return;
  if (field === "pickupTime" || field === "returnTime") value = normalizeTime(value);
  pushUndo();
  t[field] = value;
  invalidateTripSearch(t);
  saveData();
  if (renderNow) render();
}

function updatePickupDriver(id, value) {
  const t = trips.find(x => x.id === id);
  if (!t) return;
  pushUndo();
  t.pickupDriver = value;
  // Assigning a driver should NOT auto-change status. Keep/default UNASSIGNED.
  if (!t.pickupStatus) t.pickupStatus = "UNASSIGNED";
  invalidateTripSearch(t);
  saveData();
  render();
}

function updateReturnDriver(id, value) {
  const t = trips.find(x => x.id === id);
  if (!t) return;
  pushUndo();
  t.returnDriver = value;
  // Assigning a driver should NOT auto-change status. Keep/default UNASSIGNED.
  if (!t.returnStatus) t.returnStatus = "UNASSIGNED";
  invalidateTripSearch(t);
  saveData();
  render();
}

function toggleEditTrip(id) {
  const t = trips.find(x => x.id === id);
  if (!t) return;

  if (t.editing) {
    const box = document.getElementById(`editRaw_${id}`);
    if (box) {
      t.raw = box.value.trim();
      let p = parseTrip(t.raw, t.pickupDriver, t.returnDriver, t.pickupTime, t.returnTime);
      t.passenger = t.passenger || p.passenger;
      t.notes = t.notes || p.notes;
      t.service = p.service;
    }
  }

  pushUndo();
  t.editing = !t.editing;
  saveData();
  render();
}

function saveEditOnEnter(e, id) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    toggleEditTrip(id);
  }
}

function updateTripRaw(id, value) {
  const t = trips.find(x => x.id === id);
  if (!t) return;
  pushUndo();
  t.raw = value;
  const parsed = parseTrip(value, t.pickupDriver, t.returnDriver, t.pickupTime, t.returnTime);
  t.service = parsed.service;
  t.passenger = t.passenger || parsed.passenger;
  t.notes = t.notes || parsed.notes;
  invalidateTripSearch(t);
  saveData();
  render();
}

function hideTrip(id) {
  const t = trips.find(x => x.id === id);
  if (!t) return;
  pushUndo();
  t.hidden = true;
  invalidateTripSearch(t);
  saveData();
  render();
}

function createTimeSelect(id, selected, type, onchange) {
  return `<select id="${id || ""}" class="timeSelect" onchange="${onchange}">${timeOptions(selected, type)}</select>`;
}

function createAddTripButtonRow() { return null; }
function createNewTripRow() { return null; }

function createAllTripRow(trip) {
  const tr = document.createElement("tr");
  tr.className = serviceClass(trip.service);
  tr.dataset.tripId = trip.id;

  const detailHtml = `<textarea class="tripDetailsInput editableTripDetails" rows="1" onchange="updateTripRaw('${trip.id}',this.value)">${escapeHtml(trip.raw)}</textarea>`;

  // New computed Notes: Service + Route
  const service = trip.service || detectService(trip.raw || "");
  const route = detectTripRoute(trip.raw || "") || "Local";
  const displayNotes = `${service} :  ${route}`;

  const notesHtml = `<div class="computedNotes" title="${escapeHtml(trip.notes || 'No notes')}">${escapeHtml(displayNotes)}</div>`;

  const driverHtml = `
    <div class="driverAssignCell compactDriverAssign">
      <select class="driverSelect" title="Pickup Driver" onchange="updatePickupDriver('${trip.id}',this.value)">${driverOptions(trip.pickupDriver)}</select>
    </div>`;

  tr.innerHTML = `
    <td>${driverHtml}</td>
    <td><select class="statusSelect ${statusClass(trip.pickupStatus)}" title="Pick status" onchange="updateTripField('${trip.id}','pickupStatus',this.value)">${statusOptions(trip.pickupStatus)}</select></td>
    <td><select class="timeSelect" title="Pick time" onchange="updateTripField('${trip.id}','pickupTime',this.value)">${timeOptions(trip.pickupTime, "pickup")}</select></td>
    <td>${notesHtml}</td>
    <td><textarea class="patientInput patientTextArea" rows="1" onchange="updateTripField('${trip.id}','passenger',this.value)">${escapeHtml(trip.passenger)}</textarea></td>
    <td><div class="tripDetailCell">${detailHtml}<button class="hideBtn tripHideBtn" title="Hide trip from All Added Trips" onclick="hideTrip('${trip.id}')">Hide</button></div></td>`;

  return tr;
}

function driverStatusRank(status) {
  if (status === "NOLOAD" || status === "CANCELLED" || status === "NORETURN") return 1;
  if (status === "DONE") return 2;
  if (status === "LOADED") return 3;
  if (status === "ASSIGNED") return 4;
  return 5;
}

function driverAssignedTrips(driverName) {
  let rows = [];
  trips.filter(tripMatchesSearch).forEach(t => {
    if (t.pickupDriver === driverName) rows.push({ trip: t, kind: "pickup", time: t.pickupTime, status: t.pickupStatus });
    if (t.returnDriver === driverName) rows.push({ trip: t, kind: "return", time: t.returnTime, status: t.returnStatus });
  });
  return rows.sort((a, b) => {
    const statusDiff = driverStatusRank(a.status) - driverStatusRank(b.status);
    if (statusDiff) return statusDiff;
    return timeToMinutes(a.time) - timeToMinutes(b.time);
  });
}

function createDriverTable() {
  const wrap = document.createElement("div");
  wrap.className = "driverTableWrap";
  const table = document.createElement("table");
  table.className = "driverTable";
  table.id = "driverTable";

  const colgroup = document.createElement("colgroup");
  drivers.forEach((d, i) => {
    const col = document.createElement("col");
    col.style.width = getSavedDriverColWidth(i) || "150px";
    colgroup.appendChild(col);
  });

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  drivers.forEach((driver, i) => {
    const th = document.createElement("th");
    th.innerHTML = `
      <div class="driverHeaderCell">
        <button class="driverNameBtn" title="Click to assign trip" onclick="openAssignTripModal('${escapeHtml(driver.name)}')">${escapeHtml(driver.name)}</button>
        <textarea class="driverNoteInput popupInput" placeholder="notes"
          oninput="updateDriverNote('${driver.id}',this.value)">${escapeHtml(driver.note || "")}</textarea>
      </div>`;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  const row = document.createElement("tr");
  const savedH = getSavedDriverRowHeight();
  row.style.height = savedH + "px";
  drivers.forEach(driver => {
    const td = document.createElement("td");
    td.style.height = savedH + "px";
    const rows = driverAssignedTrips(driver.name).map(r => `
      <div class="driverTripRow ${statusClass(r.status)}" title="Click patient name to change status">
        <select class="driverTimeInput" onchange="updateTripField('${r.trip.id}','${r.kind === "pickup" ? "pickupTime" : "returnTime"}',this.value)">${timeOptions(r.time, r.kind === "pickup" ? "pickup" : "return")}</select>
        <button class="driverPatientInput popupInput" onclick="changeDriverTripStatus('${r.trip.id}','${r.kind}')">${escapeHtml(r.trip.passenger || "No name")}</button>
      </div>`).join("");
    td.innerHTML = `<div class="driverTrips">${rows || `<span class="emptyDriver">No trips</span>`}</div>`;
    row.appendChild(td);
  });
  tbody.appendChild(row);

  table.appendChild(colgroup);
  table.appendChild(thead);
  table.appendChild(tbody);
  wrap.appendChild(table);
  const rowHandle = document.createElement("span");
  rowHandle.className = "driverRowResizer";
  wrap.appendChild(rowHandle);
  setupDriverRowResizer(wrap, rowHandle);
  return wrap;
}
function getSavedDriverColWidth(i) {
  const widths = tabGet("driver_col_widths", []);
  return widths[i] ? widths[i] + "px" : "";
}
function setDriverTablePixelWidth(table, cols) {
  const total = [...cols].reduce((sum, col) => {
    const w = parseFloat(col.style.width) || col.getBoundingClientRect().width || 210;
    return sum + w;
  }, 0);
  table.style.width = Math.max(1, Math.round(total)) + "px";
}
function setupResizableDriverTable() {
  const table = document.getElementById("driverTable");
  if (!table) return;
  const ths = table.querySelectorAll("thead th");
  const cols = table.querySelectorAll("colgroup col");
  setDriverTablePixelWidth(table, cols);
  ths.forEach((th, i) => {
    if (th.querySelector(".driverColResizer")) return;
    const handle = document.createElement("span");
    handle.className = "driverColResizer";
    th.appendChild(handle);
    let startX = 0, startW = 0;
    handle.addEventListener("mousedown", e => {
      e.preventDefault();
      startX = e.clientX;
      startW = cols[i].getBoundingClientRect().width;
      document.body.classList.add("resizingCol");
      function onMove(ev) {
        const width = Math.max(1, startW + ev.clientX - startX);
        cols[i].style.width = width + "px";
        setDriverTablePixelWidth(table, cols);
      }
      function onUp() {
        const widths = [...cols].map(c => Math.round(parseFloat(c.style.width) || c.getBoundingClientRect().width));
        tabSet("driver_col_widths", widths);
        setDriverTablePixelWidth(table, cols);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.classList.remove("resizingCol");
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

function setupOneRowResizer(tr, handle, tripId) {
  let startY = 0, startH = 0;
  handle.addEventListener("mousedown", e => {
    e.preventDefault();
    startY = e.clientY;
    startH = tr.getBoundingClientRect().height;
    document.body.classList.add("resizingRow");
    function onMove(ev) {
      const h = Math.max(18, startH + ev.clientY - startY);
      tr.style.height = h + "px";
    }
    function onUp() {
      saveTripRowHeight(tripId, tr.getBoundingClientRect().height);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("resizingRow");
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

function setupDriverRowResizer(wrap, handle) {
  let startY = 0, startH = 0;
  handle.addEventListener("mousedown", e => {
    e.preventDefault();
    const row = wrap.querySelector("tbody tr");
    startY = e.clientY;
    startH = row ? row.getBoundingClientRect().height : getSavedDriverRowHeight();
    document.body.classList.add("resizingRow");
    function onMove(ev) {
      const h = Math.max(20, startH + ev.clientY - startY);
      wrap.querySelectorAll("tbody tr, tbody td, .driverTrips").forEach(el => { el.style.height = h + "px"; el.style.maxHeight = h + "px"; });
    }
    function onUp() {
      const row = wrap.querySelector("tbody tr");
      saveDriverRowHeight(row ? row.getBoundingClientRect().height : startH);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("resizingRow");
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

function renderAllTrips() {
  const list = document.getElementById("allTripsList");
  const frag = document.createDocumentFragment();
  const q = searchQuery.trim();
  sortedTrips(trips.filter(t => !t.hidden), "all").forEach(t => {
    const tr = createAllTripRow(t);
    if (q && !tripMatchesSearch(t)) tr.style.display = "none";
    frag.appendChild(tr);
  });
  list.innerHTML = "";
  list.appendChild(frag);
  setupResizableTable();
}


function scrollDriverTripsToBottom() {
  document.querySelectorAll(".driverTrips").forEach(box => {
    box.scrollTop = box.scrollHeight;
  });
}
function renderDrivers() {
  const board = document.getElementById("driversBoard");
  board.innerHTML = "";
  if (!drivers.length) {
    board.innerHTML = `<div class="emptyText">No drivers added.</div>`;
    return;
  }
  board.appendChild(createDriverTable());
  setupResizableDriverTable();
  scrollDriverTripsToBottom();
}

function render() {
  const visibleTrips = trips.filter(t => !t.hidden);
  document.getElementById("totalTrips").textContent = visibleTrips.length;
  document.getElementById("unassignedCount").textContent = visibleTrips.filter(t => !t.pickupDriver && !t.returnDriver).length;
  document.getElementById("assignedCount").textContent = visibleTrips.filter(t => t.pickupDriver || t.returnDriver).length;
  document.getElementById("loadedCount").textContent = visibleTrips.filter(t => t.pickupStatus === "LOADED" || t.returnStatus === "LOADED").length;
  document.getElementById("doneCount").textContent = visibleTrips.filter(t => t.pickupStatus === "DONE" || t.returnStatus === "DONE").length;
  document.getElementById("cancelledCount").textContent = visibleTrips.filter(t => t.pickupStatus === "CANCELLED" || t.returnStatus === "CANCELLED").length;
  renderDrivers();
  renderAllTrips();
}

/* Google-Sheets style cell preview disabled because cells now scroll directly */
function ensureCellPopup() { return null; }
function showCellPopup() { return; }
function refreshCellPopup() { return; }
function hideCellPopupSoon() { return; }

/* Excel-like table column resizing */
function applySavedTripColWidths() {
  const table = document.getElementById("tripTable");
  if (!table) return;
  const widths = tabGet("trip_col_widths", []);
  const cols = table.querySelectorAll("colgroup col");
  cols.forEach((col, i) => { if (widths[i]) col.style.width = widths[i] + "px"; });
}
function setupResizableTable() {
  const table = document.getElementById("tripTable");
  if (!table) return;
  applySavedTripColWidths();
  const ths = table.querySelectorAll("thead th");
  const cols = table.querySelectorAll("colgroup col");

  ths.forEach((th, i) => {
    if (th.querySelector(".colResizer")) return;
    const handle = document.createElement("span");
    handle.className = "colResizer";
    th.appendChild(handle);

    let startX = 0;
    let startW = 0;

    handle.addEventListener("mousedown", e => {
      e.preventDefault();
      startX = e.clientX;
      startW = cols[i].getBoundingClientRect().width;
      document.body.classList.add("resizingCol");

      function onMove(ev) {
        const width = Math.max(1, startW + ev.clientX - startX);
        cols[i].style.width = width + "px";
      }

      function onUp() {
        const widths = [...cols].map(c => Math.round(c.getBoundingClientRect().width));
        tabSet("trip_col_widths", widths);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.classList.remove("resizingCol");
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

/* Top menus */
function toggleMenu(id) {
  document.querySelectorAll(".dropMenu").forEach(m => {
    if (m.id !== id) m.style.display = "none";
  });
  const el = document.getElementById(id);
  el.style.display = el.style.display === "block" ? "none" : "block";
}
document.addEventListener("click", e => {
  if (!e.target.closest(".menuWrap")) document.querySelectorAll(".dropMenu").forEach(m => m.style.display = "none");
});

document.addEventListener("mousedown", e => {
  if (e.target.id === "addTripModal") closeAddTripByOutside();
  if (e.target.id === "driversModal") closeModal("driversModal");
  if (e.target.id === "historyModal") closeModal("historyModal");
  if (e.target.id === "importTripModal") closeModal("importTripModal");
  if (e.target.id === "assignDriverModal") closeModal("assignDriverModal");
  if (e.target.id === "driverStatusModal") closeModal("driverStatusModal");
});

/* Edit menu */
function clearAllTrips() { clearAllData(); }

function clearAllTripsData() {
  if (!confirm("Clear all added trips? Drivers will stay.")) return;
  pushUndo();
  trips = [];
  saveData();
  render();
  document.querySelectorAll(".dropMenu").forEach(m => m.style.display = "none");
}

function clearAllDriversData() {
  if (!confirm("Clear all drivers? Assigned driver names on trips will become blank.")) return;
  pushUndo();
  trips.forEach(t => { t.pickupDriver = ""; t.returnDriver = ""; });
  drivers = [];
  saveData();
  render();
  document.querySelectorAll(".dropMenu").forEach(m => m.style.display = "none");
}

function clearAllData() {
  if (!confirm("Clear all data and reset this tab to a fresh home page?")) return;
  trips = [];
  drivers = DEFAULT_DRIVERS.map(normalizeDriver);
  histories = [];
  undoStack = [];
  redoStack = [];
  ["trips", "drivers", "history", "undo", "redo", "trip_col_widths", "driver_col_widths", "trip_row_heights", "driver_row_height"].forEach(tabRemove);
  saveData();
  render();
}
/* Drivers modal */
function openDriversModal() {
  renderDriversManager();
  document.getElementById("driversModal").style.display = "flex";
}
function closeModal(id) {
  document.getElementById(id).style.display = "none";
}
function nextDriverName() {
  let n = 1;
  const names = new Set(drivers.map(d => d.name.toLowerCase()));
  while (names.has(`driver ${n}`)) n++;
  return `Driver ${n}`;
}
function addDriverFromModal() {
  const input = document.getElementById("newDriverName");
  const name = input.value.trim() || nextDriverName();
  pushUndo();
  drivers.push({ id: makeId(), name, note: "" });
  input.value = "";
  saveData();
  renderDriversManager();
  render();
}
function addDriver() { openDriversModal(); }
function renameDriver(id) {
  const d = drivers.find(x => x.id === id);
  if (!d) return;
  const old = d.name;
  const name = prompt("New driver name?", old);
  if (!name) return;
  pushUndo();
  d.name = name.trim();
  trips.forEach(t => {
    if (t.pickupDriver === old) t.pickupDriver = d.name;
    if (t.returnDriver === old) t.returnDriver = d.name;
  });
  saveData();
  renderDriversManager();
  render();
}
function deleteDriver(id) {
  const d = drivers.find(x => x.id === id);
  if (!d) return;
  if (!confirm(`Delete ${d.name}? Assigned trips will become blank.`)) return;
  pushUndo();
  trips.forEach(t => {
    if (t.pickupDriver === d.name) t.pickupDriver = "";
    if (t.returnDriver === d.name) t.returnDriver = "";
  });
  drivers = drivers.filter(x => x.id !== id);
  saveData();
  renderDriversManager();
  render();
}
function clearAllDrivers() {
  if (!confirm("Clear all drivers? Trips will stay, driver names will become blank.")) return;
  pushUndo();
  trips.forEach(t => { t.pickupDriver = ""; t.returnDriver = ""; });
  drivers = [];
  saveData();
  renderDriversManager();
  render();
}
function moveDriver(id, dir) {
  const i = drivers.findIndex(d => d.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= drivers.length) return;
  pushUndo();
  [drivers[i], drivers[j]] = [drivers[j], drivers[i]];
  saveData();
  renderDriversManager();
  render();
}
function updateDriverNote(id, value) {
  const d = drivers.find(x => x.id === id);
  if (d) { d.note = value; saveData(); }
}
function renderDriversManager() {
  const box = document.getElementById("driversManager");
  box.innerHTML = drivers.map((d, i) => `
    <div class="driverManageRow">
      <span class="driverOrder">${i + 1}</span>
      <b>${escapeHtml(d.name)}</b>
      <button onclick="moveDriver('${d.id}',-1)">↑</button>
      <button onclick="moveDriver('${d.id}',1)">↓</button>
      <button class="editBtn" onclick="renameDriver('${d.id}')">Edit</button>
      <button class="deleteBtn" onclick="deleteDriver('${d.id}')">Delete</button>
    </div>`).join("") || `<div class="emptyText">No drivers added.</div>`;
}

/* History */
function saveHistory() {
  const stamp = new Date().toLocaleString("en-IN", { hour12: true });
  const item = {
    id: makeId(),
    savedAt: stamp,
    trips: JSON.parse(JSON.stringify(trips)),
    drivers: JSON.parse(JSON.stringify(drivers))
  };
  pushUndo();
  histories.unshift(item);
  saveData();

  const blob = new Blob([JSON.stringify(item, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `dispatch_history_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  alert("History saved in browser storage. A JSON backup was also downloaded.");
}

function importHistoryJson(){
  document.getElementById("historyImportFile").click();
}

async function handleHistoryImport(event){
  const file = event.target.files[0];
  if(!file) return;

  try{
    const text = await file.text();
    const imported = JSON.parse(text);

    const historyItem = {
      id: imported.id || makeId(),
      savedAt: imported.savedAt || new Date().toLocaleString(),
      trips: imported.trips || [],
      drivers: imported.drivers || []
    };

    pushUndo();

    histories.unshift(historyItem);

    saveData();

    if(confirm("History imported successfully.\n\nLoad it now?")){
      trips = JSON.parse(JSON.stringify(historyItem.trips));
      drivers = JSON.parse(JSON.stringify(historyItem.drivers))
        .map(normalizeDriver);

      saveData();
      render();
    }

    renderHistoryList();

  }catch(err){
    console.error(err);
    alert("Invalid history JSON file.");
  }

  event.target.value = "";
}

function openHistoryModal() {
  renderHistoryList();
  document.getElementById("historyModal").style.display = "flex";
}
function renderHistoryList() {
  const box = document.getElementById("historyList");
  box.innerHTML = histories.map(h => `
    <div class="historyRow">
      <div><b>${escapeHtml(h.savedAt)}</b><br><small>${h.trips.length} trips, ${h.drivers.length} drivers</small></div>
      <button onclick="loadHistory('${h.id}')">View/Load</button>
      <button class="deleteBtn" onclick="deleteHistory('${h.id}')">Delete</button>
    </div>`).join("") || `<div class="emptyText">No saved history.</div>`;
}
function loadHistory(id) {
  const h = histories.find(x => x.id === id);
  if (!h) return;
  if (confirm(`Load saved history from ${h.savedAt}? Current board will be replaced.`)) {
    pushUndo();
    trips = JSON.parse(JSON.stringify(h.trips));
    drivers = JSON.parse(JSON.stringify(h.drivers)).map(normalizeDriver);
    saveData();
    closeModal("historyModal");
    render();
  }
}
function deleteHistory(id) {
  pushUndo();
  histories = histories.filter(h => h.id !== id);
  saveData();
  renderHistoryList();
}

/* Clocks */
/* Clocks */
function updateClocks() {
  const now = new Date();
  document.getElementById("indiaTime").textContent = now.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", hour12: true, hour: "numeric", minute: "2-digit", second: "2-digit"
  });
  document.getElementById("laTime").textContent = now.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles", hour12: true, hour: "numeric", minute: "2-digit", second: "2-digit"
  });
}

/* ==================== CSV IMPORT SECTION ==================== */
/**
 * CSV / PapaParse import logic.
 * Depends on: utils.js, storage.js, trips.js
 *
 * Features (v2):
 * - Skip header row
 * - Compare with previous upload → New / Removed
 * - Clickable count filters (Single / Round / Multi / New / Removed)
 * - ADD to board (single + all displayed)
 */

let importedRows = [];
let importedFormattedTrips = [];
let importedCurrentTrips = [];
let importedDisplayTrips = [];
let importedPatientCount = {};
let importedCurrentFilter = "all";

let importedPreviousTrips = [];
let importedNewTrips = [];
let importedRemovedTrips = [];

function importKeepText(v) {
  return String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function isPickupTimeText(v) {
  v = importKeepText(v);
  // Old: 6/30 11:47 PM  |  New: 6/30/2026  8:30:00 AM
  return /\d{1,2}\/\d{1,2}(\/\d{4})?\s+\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)/i.test(v) ||
         /\d{1,2}:\d{2}\s*(AM|PM)/i.test(v);
}

function getPickupTime(str) {
  str = importKeepText(str);
  let match = str.match(/(\d{1,2}:\d{2}(:\d{2})?)\s*(AM|PM)/i);
  if (match) {
    let time = match[1].split(":").slice(0, 2).join(":");
    return time + " " + match[3].toUpperCase();
  }
  let d = new Date(str);
  if (!isNaN(d)) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return str || "ASAP";
}

function setImportStatus(text, cls = "") {
  const el = document.getElementById("importStatus");
  if (!el) return;
  el.className = "importStatus " + cls;
  el.textContent = text;
}

function compareImportedWithPrevious() {
  importedNewTrips = [];
  importedRemovedTrips = [];
  if (!importedPreviousTrips.length || !importedFormattedTrips.length) return;

  const prevSet = new Set(importedPreviousTrips.map(t => `${t.passengerKey}|${t.pickupTime}`));
  const currentSet = new Set(importedFormattedTrips.map(t => `${t.passengerKey}|${t.pickupTime}`));

  importedNewTrips = importedFormattedTrips.filter(t => !prevSet.has(`${t.passengerKey}|${t.pickupTime}`));
  importedRemovedTrips = importedPreviousTrips.filter(t => !currentSet.has(`${t.passengerKey}|${t.pickupTime}`));
}

async function readImportedCSV() {
  try {
    const file = document.getElementById("importCsvFile").files[0];
    if (!file) {
      alert("Select CSV file");
      return;
    }

    setImportStatus("Reading CSV...", "loading");
    const text = await file.text();

    let data;
    if (window.Papa) {
      const result = Papa.parse(text, {
        header: false,
        skipEmptyLines: true,
        quoteChar: '"',
        escapeChar: '"',
        dynamicTyping: false
      });
      data = result.data || [];
    } else {
      data = text.split(/\r?\n/).filter(Boolean).map(line => line.split(","));
    }

    if (!data.length) {
      setImportStatus("No rows found", "error");
      return;
    }

    // Keep previous formatted set for New/Removed comparison
    if (importedFormattedTrips.length > 0) {
      importedPreviousTrips = importedFormattedTrips.map(t => ({ ...t }));
    }

    // Skip header row
    importedRows = data.slice(1);
    importedFormattedTrips = [];
    importedCurrentTrips = [];
    importedDisplayTrips = [];
    importedPatientCount = {};
    importedCurrentFilter = "all";
    importedNewTrips = [];
    importedRemovedTrips = [];

    document.getElementById("importSearchInput").value = "";
    document.getElementById("importTripList").innerHTML = "";
    updateImportCounts();
    setImportStatus(importedRows.length + " CSV rows loaded. Click FORMAT.", "done");
  } catch (err) {
    console.error(err);
    setImportStatus("Error: " + err.message, "error");
  }
}

function formatImportedTrips() {
  if (!importedRows.length) {
    alert("Upload CSV first");
    return;
  }

  let tempTrips = [];
  let nameCount = {};

  importedRows.forEach(r => {
    // Fix shifted columns when notes contain commas
    while (r.length > 21) {
      if (!isPickupTimeText(r[8]) && isPickupTimeText(r[9])) {
        r[7] = importKeepText(r[7] + ", " + r[8]).replace(/^"+|"+$/g, "");
        r.splice(8, 1);
      } else break;
    }

    if (r.length < 21) return;

    const tripId = importKeepText(r[0]);
    const passenger = importKeepText(r[17]);
    if (!tripId || !passenger) return;

    const key = passenger.toLowerCase();

    const trip = {
      tripId,
      passenger,
      passengerKey: key,
      passengerPhone: importKeepText(r[20]),
      pickupTime: getPickupTime(importKeepText(r[8])),
      pickupFull: importKeepText([r[3], r[4], r[5], r[6]].join(" ")),
      dropFull: importKeepText([r[9], r[10], r[11], r[12]].join(" ")),
      service: importedService(r[13]),
      pax: importKeepText(r[18]) || "1",
      notes: importKeepText(r[7]),
      added: false,
      line: ""
    };

    tempTrips.push(trip);
    nameCount[key] = (nameCount[key] || 0) + 1;
  });

  importedFormattedTrips = tempTrips.map(t => {
    const rtText = nameCount[t.passengerKey] > 1 ? " R/T" : "";
    const phoneText = t.passengerPhone ? " -- " + t.passengerPhone : "";
    t.line = `PU ${t.pickupTime} --- ${t.tripId} -- ${t.passenger}${phoneText}  ${t.service}${rtText} FROM ${t.pickupFull} TO ${t.dropFull} PAX:${t.pax} BILL TO KERN`;
    if (t.notes) t.line += "  -Notes: " + t.notes;
    return t;
  });

  importedFormattedTrips.sort((a, b) => timeToMinutes(a.pickupTime) - timeToMinutes(b.pickupTime));
  importedPatientCount = nameCount;
  importedCurrentTrips = importedFormattedTrips.slice();
  importedCurrentFilter = "all";

  compareImportedWithPrevious();
  searchImportedTrips();
  setImportStatus(importedFormattedTrips.length + " trips formatted", "done");
}

function importedService(serviceRaw) {
  let s = importKeepText(serviceRaw).toLowerCase();
  if (s.includes("curb") || s.includes("c2c") || s.includes("door") || s.includes("d2d")) return "AMB";
  if (s.includes("wheelchair") || s.includes("wheel chair") || s === "wc") return "WC";
  if (s.includes("gurney") || s === "gur") return "GUR";
  if (s.includes("bariatric") || s === "bar") return "BAR";
  return importKeepText(serviceRaw) || "AMB";
}

function applyImportedFilter(filterType) {
  importedCurrentFilter = filterType;
  if (filterType === "all") {
    importedCurrentTrips = importedFormattedTrips.slice();
  } else if (filterType === "single") {
    importedCurrentTrips = importedFormattedTrips.filter(t => importedPatientCount[t.passengerKey] === 1);
  } else if (filterType === "round") {
    importedCurrentTrips = importedFormattedTrips.filter(t => importedPatientCount[t.passengerKey] === 2);
  } else if (filterType === "multiple") {
    importedCurrentTrips = importedFormattedTrips.filter(t => importedPatientCount[t.passengerKey] >= 3);
  } else if (filterType === "new") {
    if (!importedNewTrips.length) {
      alert("No new trips");
      return;
    }
    importedCurrentTrips = importedNewTrips.slice();
  } else if (filterType === "removed") {
    if (!importedRemovedTrips.length) {
      alert("No removed trips");
      return;
    }
    importedCurrentTrips = importedRemovedTrips.map(t => ({
      ...t,
      line: "(REMOVED) " + t.line,
      added: true // cannot add removed trips
    }));
  }
  searchImportedTrips();
}

function sortImportedTrips() {
  if (!importedCurrentTrips.length) {
    alert("Format CSV first");
    return;
  }
  importedCurrentTrips.sort((a, b) => a.passenger.localeCompare(b.passenger));
  searchImportedTrips();
  setImportStatus("Sorted by patient name", "done");
}

function filterImportedEarlyTripsOnly() {
  if (!importedFormattedTrips.length) {
    alert("Format CSV first");
    return;
  }
  const groups = {};
  importedFormattedTrips.forEach(t => {
    if (!groups[t.passengerKey]) groups[t.passengerKey] = [];
    groups[t.passengerKey].push(t);
  });
  importedCurrentTrips = Object.keys(groups).map(key => {
    return groups[key].slice().sort((a, b) => timeToMinutes(a.pickupTime) - timeToMinutes(b.pickupTime))[0];
  });
  importedCurrentTrips.sort((a, b) => timeToMinutes(a.pickupTime) - timeToMinutes(b.pickupTime));
  importedCurrentFilter = "early";
  searchImportedTrips();
  setImportStatus("Showing earliest trip only for each patient", "done");
}

function detectImportedReturns() {
  if (!importedFormattedTrips.length) {
    alert("Format CSV first");
    return;
  }
  const groups = {};
  importedFormattedTrips.forEach(t => {
    if (!groups[t.passengerKey]) groups[t.passengerKey] = [];
    groups[t.passengerKey].push(t);
  });

  Object.keys(groups).forEach(key => {
    const arr = groups[key].slice().sort((a, b) => timeToMinutes(a.pickupTime) - timeToMinutes(b.pickupTime));
    if (arr.length < 2) return;
    const firstTrip = arr[0];
    const returnTimes = arr.slice(1).map(t => t.pickupTime).filter(time => time && time !== "11:47 PM");
    if (!returnTimes.length) return;

    firstTrip.line = firstTrip.line.replace(/\s+Return@[^\n]+/g, "");
    returnTimes.forEach(time => {
      if (!firstTrip.line.includes("Return@" + time)) firstTrip.line += " Return@" + time;
    });
  });

  searchImportedTrips();
  setImportStatus("Returns detected and added as Return@time", "done");
}

function searchImportedTrips() {
  const q = importKeepText(document.getElementById("importSearchInput").value).toLowerCase();
  importedDisplayTrips = q
    ? importedCurrentTrips.filter(t => t.line.toLowerCase().includes(q))
    : importedCurrentTrips.slice();
  renderImportedTrips();
  updateImportCounts();
}

function isImportedNewTrip(t) {
  return importedNewTrips.some(nt => nt.passengerKey === t.passengerKey && nt.pickupTime === t.pickupTime);
}

function addImportedTripToBoard(importTrip) {
  if (String(importTrip.line || "").startsWith("(REMOVED)")) {
    alert("Removed trips cannot be added");
    return;
  }
  pushUndo();
  const parsed = parseTrip(importTrip.line, "", "", importTrip.pickupTime, "");
  parsed.raw = importTrip.line;
  parsed.pickupTime = normalizeTime(importTrip.pickupTime) || "ASAP";
  parsed.returnTime = normalizeTime((importTrip.line.match(/Return@\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i) || [])[1] || "") || "R/T";
  parsed.passenger = importTrip.passenger || parsed.passenger;
  parsed.notes = importTrip.notes || parsed.notes;
  parsed.service = importTrip.service || parsed.service;
  parsed.pickupStatus = "UNASSIGNED";
  parsed.returnStatus = "UNASSIGNED";
  trips.push(parsed);
  importTrip.added = true;
  saveData();
  render();
  renderImportedTrips();
  setImportStatus("Trip added to All Added Trips", "done");
}

function addAllDisplayedTrips() {
  if (!importedDisplayTrips || !importedDisplayTrips.length) {
    alert("No trips to add");
    return;
  }
  const toAdd = importedDisplayTrips.filter(t => !t.added && !String(t.line || "").startsWith("(REMOVED)"));
  if (!toAdd.length) {
    alert("All displayed trips are already added (or are removed)");
    return;
  }

  pushUndo();
  toAdd.forEach(importTrip => {
    const parsed = parseTrip(importTrip.line, "", "", importTrip.pickupTime, "");
    parsed.raw = importTrip.line;
    parsed.pickupTime = normalizeTime(importTrip.pickupTime) || "ASAP";
    parsed.returnTime = normalizeTime((importTrip.line.match(/Return@\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i) || [])[1] || "") || "R/T";
    parsed.passenger = importTrip.passenger || parsed.passenger;
    parsed.notes = importTrip.notes || parsed.notes;
    parsed.service = importTrip.service || parsed.service;
    parsed.pickupStatus = "UNASSIGNED";
    parsed.returnStatus = "UNASSIGNED";
    trips.push(parsed);
    importTrip.added = true;
  });

  saveData();
  render();
  renderImportedTrips();
  setImportStatus(`Successfully added ${toAdd.length} trips to the board`, "done");
}

function renderImportedTrips() {
  const wrap = document.getElementById("importTripList");
  if (!wrap) return;
  wrap.innerHTML = "";

  if (importedDisplayTrips.length > 0) {
    const addAllContainer = document.createElement("div");
    addAllContainer.style.marginBottom = "12px";
    const addAllBtn = document.createElement("button");
    addAllBtn.className = "smallBtn greenBtn";
    addAllBtn.style.fontSize = "13px";
    addAllBtn.style.padding = "8px 16px";
    const pending = importedDisplayTrips.filter(t => !t.added && !String(t.line || "").startsWith("(REMOVED)")).length;
    addAllBtn.textContent = `ADD ALL DISPLAYED (${pending})`;
    addAllBtn.onclick = addAllDisplayedTrips;
    addAllContainer.appendChild(addAllBtn);
    wrap.appendChild(addAllContainer);
  }

  importedDisplayTrips.forEach((t, i) => {
    const row = document.createElement("div");
    row.className = "importTripRow" + (isImportedNewTrip(t) ? " importNewTrip" : "");

    const btn = document.createElement("button");
    btn.className = "importAddBtn" + (t.added ? " added" : "");
    btn.textContent = t.added ? "ADDED" : "ADD";
    btn.onclick = () => addImportedTripToBoard(t);

    const text = document.createElement("div");
    text.className = "importTripText";
    text.textContent = (i + 1) + ". " + t.line;

    row.appendChild(btn);
    row.appendChild(text);
    wrap.appendChild(row);
  });
}

function updateImportCounts() {
  const row = document.getElementById("importCountRow");
  if (!row) return;
  if (!importedFormattedTrips.length) {
    row.style.display = "none";
    row.innerHTML = "";
    return;
  }

  const names = Object.keys(importedPatientCount);
  const single = names.filter(n => importedPatientCount[n] === 1).length;
  const round = names.filter(n => importedPatientCount[n] === 2).length;
  const multiple = names.filter(n => importedPatientCount[n] >= 3).length;

  const active = (f) => importedCurrentFilter === f ? ' class="importCountActive"' : "";
  const hasPrev = importedPreviousTrips.length > 0;

  const newCls = "importCountNew" + (importedCurrentFilter === "new" ? " importCountActive" : "");
  const remCls = "importCountRemoved" + (importedCurrentFilter === "removed" ? " importCountActive" : "");
  const newSpan = hasPrev
    ? ` | <span class="${newCls}" onclick="applyImportedFilter('new')">New: ${importedNewTrips.length}</span>`
    : "";
  const removedSpan = hasPrev
    ? ` | <span class="${remCls}" onclick="applyImportedFilter('removed')">Removed: ${importedRemovedTrips.length}</span>`
    : "";

  row.style.display = "block";
  row.innerHTML =
    `Total trips: ${importedFormattedTrips.length} | Total patients: ${names.length} | ` +
    `<span onclick="applyImportedFilter('all')"${active("all")}>All</span> | ` +
    `<span onclick="applyImportedFilter('single')"${active("single")}>Single: ${single}</span> | ` +
    `<span onclick="applyImportedFilter('round')"${active("round")}>Round: ${round}</span> | ` +
    `<span onclick="applyImportedFilter('multiple')"${active("multiple")}>Multi: ${multiple}</span>` +
    newSpan + removedSpan +
    ` | Showing: ${importedDisplayTrips.length}`;
}

function openImportTripModal() {
  document.getElementById("importTripModal").style.display = "flex";
}

// Final initialization
saveData();
render();
updateClocks();
setInterval(updateClocks, 1000);
