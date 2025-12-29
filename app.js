/*
  Panel de Fichaje — Smouj013
  - Vista general (lista de empleados)
  - Horario semanal por empleado (auto-detecta turno según día)
  - Botón por empleado: fichar entrada / fichar salida (cierra turno)
  - Export CSV día / semana
  - PWA offline (SW)
*/
(() => {
  "use strict";

  const STORAGE_KEY = "smouj013_fichaje_v2";

  const $ = (id) => document.getElementById(id);

  const el = {
    companyName: $("companyName"),
    subTitle: $("subTitle"),

    datePicker: $("datePicker"),
    btnPrevDay: $("btnPrevDay"),
    btnNextDay: $("btnNextDay"),
    btnToday: $("btnToday"),
    dateHint: $("dateHint"),

    searchInput: $("searchInput"),
    employeeList: $("employeeList"),
    listSub: $("listSub"),

    events: $("events"),

    btnExportDay: $("btnExportDay"),
    btnExportWeek: $("btnExportWeek"),
    btnClearDay: $("btnClearDay"),

    btnSettings: $("btnSettings"),
    settingsBackdrop: $("settingsBackdrop"),
    settingsModal: $("settingsModal"),
    btnCloseSettings: $("btnCloseSettings"),
    btnCancelSettings: $("btnCancelSettings"),
    btnSaveSettings: $("btnSaveSettings"),
    inpCompany: $("inpCompany"),
    chkPin: $("chkPin"),
    inpPin: $("inpPin"),

    inpNewEmployee: $("inpNewEmployee"),
    inpNewColor: $("inpNewColor"),
    btnAddEmployee: $("btnAddEmployee"),
    empAdminList: $("empAdminList"),

    editBackdrop: $("editBackdrop"),
    editModal: $("editModal"),
    editTitle: $("editTitle"),
    editSub: $("editSub"),
    btnCloseEdit: $("btnCloseEdit"),
    btnCancelEdit: $("btnCancelEdit"),
    btnSaveEdit: $("btnSaveEdit"),
    btnTemplateWeek: $("btnTemplateWeek"),
    btnClearSchedule: $("btnClearSchedule"),
    scheduleGrid: $("scheduleGrid"),
    inpEmpNote: $("inpEmpNote"),

    btnInstall: $("btnInstall"),
  };

  // Helpers
  const pad2 = (n) => String(n).padStart(2, "0");
  const nowMs = () => Date.now();

  function makeId() {
    return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }

  function toDateInputValue(d) {
    const year = d.getFullYear();
    const month = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    return `${year}-${month}-${day}`;
  }

  function parseDateInputValue(v) {
    // v = YYYY-MM-DD, interpret as local date
    const [y, m, d] = (v || "").split("-").map(x => parseInt(x, 10));
    if (!y || !m || !d) return new Date();
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }

  function fmtTime(ms) {
    if (!ms) return "—";
    const d = new Date(ms);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function fmtFull(ms) {
    const d = new Date(ms);
    return `${toDateInputValue(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  function weekdayIndex(dateObj) {
    // JS: 0=Dom..6=Sáb
    return dateObj.getDay();
  }

  const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  function clampDay(dateObj, deltaDays) {
    const d = new Date(dateObj);
    d.setDate(d.getDate() + deltaDays);
    return d;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // State
  function defaultState() {
    return {
      settings: {
        company: "Panel de Fichaje",
        requirePin: false,
        pinSalt: "",
        pinHash: "",
      },
      employees: [
        // demo suave (puedes borrar en ajustes)
        createEmployee("Ana", "#6ee7ff"),
        createEmployee("Carlos", "#ffd166"),
        createEmployee("Marta", "#70ffb4"),
      ],
      // records por fecha y empleado: { "YYYY-MM-DD": { [empId]: { inTs, outTs } } }
      records: {},
      // eventos append-only
      events: []
    };
  }

  function createEmployee(name, color) {
    const emp = {
      id: makeId(),
      name: String(name || "Empleado").slice(0, 40),
      color: color || "#6ee7ff",
      note: "",
      // weekly schedule: keys 0..6 (Dom..Sáb) => { start:"09:00", end:"17:00" } o null
      weekly: {
        0: null,
        1: { start: "09:00", end: "17:00" },
        2: { start: "09:00", end: "17:00" },
        3: { start: "09:00", end: "17:00" },
        4: { start: "09:00", end: "17:00" },
        5: { start: "09:00", end: "17:00" },
        6: null
      }
    };
    return emp;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);

      const st = defaultState();
      st.settings = Object.assign(st.settings, parsed.settings || {});
      st.employees = Array.isArray(parsed.employees) ? parsed.employees : st.employees;
      st.records = (parsed.records && typeof parsed.records === "object") ? parsed.records : {};
      st.events = Array.isArray(parsed.events) ? parsed.events : [];
      return st;
    } catch {
      return defaultState();
    }
  }

  const state = loadState();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }

  // PIN
  function randomSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function hexToBytes(hex) {
    const clean = (hex || "").trim();
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  }

  async function pbkdf2Hex(pin, saltHex) {
    if (!crypto?.subtle) return "";
    const salt = hexToBytes(saltHex);
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: 120000
    }, keyMaterial, 256);
    return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function ensurePinAllowed() {
    if (!state.settings.requirePin) return true;
    const pin = prompt("Introduce el PIN para continuar:");
    if (pin == null) return false;
    const p = pin.trim();
    if (p.length < 4) return false;

    const salt = state.settings.pinSalt || "";
    const target = state.settings.pinHash || "";
    if (!salt || !target) return false;

    const hash = await pbkdf2Hex(p, salt);
    return hash && hash === target;
  }

  // Current view date
  let viewDate = parseDateInputValue(el.datePicker?.value || toDateInputValue(new Date()));
  let searchQuery = "";

  function getDateKey(d) {
    return toDateInputValue(d);
  }

  function ensureDayRecord(dateKey) {
    if (!state.records[dateKey]) state.records[dateKey] = {};
    return state.records[dateKey];
  }

  function getEmpRecord(dateKey, empId) {
    const day = ensureDayRecord(dateKey);
    if (!day[empId]) day[empId] = { inTs: 0, outTs: 0 };
    return day[empId];
  }

  // Schedule
  function getShiftForEmployeeOnDate(emp, dateObj) {
    const idx = weekdayIndex(dateObj); // 0..6
    const s = emp.weekly?.[idx] || null;
    if (!s || !s.start || !s.end) return null;
    return { start: s.start, end: s.end };
  }

  function isWithinShiftNow(shift, dateObjNow) {
    if (!shift) return false;

    const d = new Date(dateObjNow);
    const [sh, sm] = shift.start.split(":").map(n => parseInt(n, 10));
    const [eh, em] = shift.end.split(":").map(n => parseInt(n, 10));

    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh || 0, sm || 0, 0, 0).getTime();
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh || 0, em || 0, 0, 0).getTime();

    const t = d.getTime();
    // Si el turno acaba “antes” del inicio, se entiende que cruza medianoche (no lo implementamos a fondo, pero lo soporta mínimo)
    if (end < start) {
      // turno nocturno: [start..fin día] U [inicio día..end]
      const endPlus = end + 24 * 60 * 60 * 1000;
      const t2 = t < start ? t + 24 * 60 * 60 * 1000 : t;
      return (t2 >= start && t2 <= endPlus);
    }

    return (t >= start && t <= end);
  }

  // Events
  function addEvent(type, emp, dateKey, payload = {}) {
    state.events.push({
      id: makeId(),
      ts: nowMs(),
      type,
      empId: emp?.id || "",
      empName: emp?.name || "",
      dateKey,
      payload
    });
    saveState();
  }

  function getEventsForDay(dateKey) {
    return state.events.filter(e => e.dateKey === dateKey);
  }

  // UI: render list
  function renderHeader() {
    el.companyName.textContent = state.settings.company || "Panel de Fichaje";
    el.subTitle.textContent = "Vista general";
  }

  function renderDateControls() {
    const key = getDateKey(viewDate);
    el.datePicker.value = key;

    const idx = weekdayIndex(viewDate);
    el.dateHint.textContent = `Día: ${DAY_NAMES[idx]} · ${key}`;
  }

  function renderList() {
    const key = getDateKey(viewDate);
    const dayRec = ensureDayRecord(key);

    const filtered = state.employees
      .filter(e => e && e.name)
      .filter(e => e.name.toLowerCase().includes(searchQuery));

    el.listSub.textContent = `${filtered.length} empleado(s) · Fecha: ${key}`;

    if (!filtered.length) {
      el.employeeList.innerHTML = `
        <div class="row">
          <div class="empCell">
            <div class="avatar">?</div>
            <div>
              <div class="empName">Sin resultados</div>
              <div class="empMeta">Prueba a borrar el filtro.</div>
            </div>
          </div>
          <div class="shiftCell"><div class="shiftMain">—</div></div>
          <div class="timeCell muted">—</div>
          <div class="timeCell muted">—</div>
          <div class="actionCell"></div>
        </div>
      `;
      return;
    }

    const now = new Date();
    const isToday = (getDateKey(now) === key);

    el.employeeList.innerHTML = filtered.map(emp => {
      const rec = getEmpRecord(key, emp.id);
      const shift = getShiftForEmployeeOnDate(emp, viewDate);

      const inTxt = rec.inTs ? fmtTime(rec.inTs) : "—";
      const outTxt = rec.outTs ? fmtTime(rec.outTs) : "—";

      const inside = !!rec.inTs && !rec.outTs;
      const shiftTxt = shift ? `${shift.start}–${shift.end}` : "Sin turno";

      const showTurnoBadge = shift && isToday && isWithinShiftNow(shift, now) && !inside && !rec.outTs;
      const badge = inside
        ? `<span class="chip chip-ok">● Dentro</span>`
        : showTurnoBadge
          ? `<span class="chip chip-warn">● En turno</span>`
          : shift
            ? ``
            : `<span class="chip chip-muted">● Sin turno</span>`;

      const initial = emp.name.trim().slice(0, 1).toUpperCase();
      const btnLabel = inside ? "Cerrar" : "Fichar";
      const btnClass = inside ? "out" : "in";

      return `
        <div class="row" data-emp="${emp.id}">
          <div class="empCell">
            <div class="avatar" style="background:${escapeHtml(emp.color)}22;border-color:${escapeHtml(emp.color)}33;">
              ${escapeHtml(initial)}
            </div>
            <div style="min-width:0;">
              <div class="empName">${escapeHtml(emp.name)}</div>
              <div class="empMeta">${escapeHtml(emp.note || "")}</div>
            </div>
          </div>

          <div class="shiftCell">
            <div class="shiftMain">${escapeHtml(shiftTxt)}</div>
            <div class="badges">${badge}</div>
          </div>

          <div class="timeCell ${rec.inTs ? "" : "muted"}">${escapeHtml(inTxt)}</div>
          <div class="timeCell ${rec.outTs ? "" : "muted"}">${escapeHtml(outTxt)}</div>

          <div class="actionCell">
            <button class="btn actionBtn ${btnClass}" type="button" data-action="punch" data-emp="${emp.id}">
              ${escapeHtml(btnLabel)}
            </button>
          </div>
        </div>
      `;
    }).join("");

    // Bind clicks (delegación)
    el.employeeList.querySelectorAll('button[data-action="punch"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const empId = btn.getAttribute("data-emp");
        const emp = state.employees.find(e => e.id === empId);
        if (!emp) return;
        handlePunch(emp);
      });
    });
  }

  function renderSummary() {
    const key = getDateKey(viewDate);
    const now = new Date();
    const isToday = (getDateKey(now) === key);

    let inside = 0;
    let onShift = 0;
    let noShift = 0;
    let completed = 0;
    let totalHoursMs = 0;

    state.employees.forEach(emp => {
      const rec = getEmpRecord(key, emp.id);
      const shift = getShiftForEmployeeOnDate(emp, viewDate);

      if (!shift) noShift += 1;

      const isInside = !!rec.inTs && !rec.outTs;
      const isCompleted = !!rec.inTs && !!rec.outTs;

      if (isInside) inside += 1;
      if (isCompleted) {
        completed += 1;
        totalHoursMs += Math.max(0, rec.outTs - rec.inTs);
      }

      if (shift && isToday && !rec.inTs && !rec.outTs && isWithinShiftNow(shift, now)) {
        onShift += 1;
      }
    });

    const total = state.employees.length;
    const updateTime = fmtTime(now.getTime());

    el.summarySub.textContent = `Fecha: ${key} · Actualizado ${updateTime}`;
    el.summaryTotal.textContent = String(total);
    el.summaryInside.textContent = String(inside);
    el.summaryOnShift.textContent = String(onShift);
    el.summaryNoShift.textContent = String(noShift);
    el.summaryCompleted.textContent = String(completed);
    el.summaryHours.textContent = fmtDuration(totalHoursMs);
  }

  function renderEvents() {
    const key = getDateKey(viewDate);
    const evs = getEventsForDay(key).slice().reverse();

    if (!evs.length) {
      el.events.innerHTML = `
        <div class="event">
          <div class="eventLeft">
            <div class="eventType">Sin eventos</div>
            <div class="eventMeta">Aún no hay fichajes registrados para este día.</div>
          </div>
        </div>
      `;
      return;
    }

    el.events.innerHTML = evs.map(ev => {
      const typeTxt =
        ev.type === "IN" ? "✅ Entrada" :
        ev.type === "OUT" ? "⛔ Salida" :
        ev.type === "RESET" ? "🧹 Reset" :
        "• Evento";

      const meta = `${fmtFull(ev.ts)} · ${escapeHtml(ev.empName || "")}`;
      const note = ev.payload?.note ? `<div class="eventNote">${escapeHtml(ev.payload.note)}</div>` : "";
      return `
        <div class="event">
          <div class="eventLeft">
            <div class="eventType">${typeTxt}</div>
            <div class="eventMeta">${meta}</div>
            ${note}
          </div>
        </div>
      `;
    }).join("");
  }

  async function handlePunch(emp) {
    const key = getDateKey(viewDate);
    const rec = getEmpRecord(key, emp.id);

    // Si ya tiene entrada y salida, pedimos reset (o ignoramos)
    if (rec.inTs && rec.outTs) {
      const ok = confirm(`${emp.name} ya tiene entrada y salida en ${key}.\n\n¿Quieres reiniciar el fichaje de ese día para este empleado?`);
      if (!ok) return;
      rec.inTs = 0;
      rec.outTs = 0;
      addEvent("RESET", emp, key, {});
      saveState();
      renderAll();
      return;
    }

    // Fichar entrada o salida
    if (!rec.inTs) {
      rec.inTs = nowMs();
      addEvent("IN", emp, key, {});
    } else if (!rec.outTs) {
      rec.outTs = nowMs();
      addEvent("OUT", emp, key, {});
    }

    saveState();
    renderAll();
  }

  // Export CSV
  function csvEscape(v) {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  }

  function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function exportDayCSV() {
    if (!(await ensurePinAllowed())) return;

    const key = getDateKey(viewDate);
    const header = ["fecha", "empleado", "turno", "entrada", "salida"].join(",");
    const rows = [header];

    for (const emp of state.employees) {
      const shift = getShiftForEmployeeOnDate(emp, viewDate);
      const shiftTxt = shift ? `${shift.start}-${shift.end}` : "";
      const rec = getEmpRecord(key, emp.id);

      rows.push([
        key,
        emp.name,
        shiftTxt,
        rec.inTs ? fmtTime(rec.inTs) : "",
        rec.outTs ? fmtTime(rec.outTs) : ""
      ].map(csvEscape).join(","));
    }

    const company = (state.settings.company || "empresa").replaceAll(" ", "_");
    downloadText(`${company}_fichaje_${key}.csv`, rows.join("\n"), "text/csv;charset=utf-8");
  }

  async function exportWeekCSV() {
    if (!(await ensurePinAllowed())) return;

    const base = new Date(viewDate);
    // Semana “visual”: lunes a domingo
    const idx = weekdayIndex(base); // 0..6 (Dom..Sáb)
    // Convertir a lunes: si idx=0 (Dom) retrocede 6, si idx=1 (Lun) 0, etc.
    const backToMonday = (idx === 0) ? -6 : (1 - idx);
    const monday = clampDay(base, backToMonday);

    const header = ["fecha", "dia", "empleado", "turno", "entrada", "salida"].join(",");
    const rows = [header];

    for (let i = 0; i < 7; i++) {
      const d = clampDay(monday, i);
      const key = getDateKey(d);
      const dayName = DAY_NAMES[weekdayIndex(d)];

      for (const emp of state.employees) {
        const shift = getShiftForEmployeeOnDate(emp, d);
        const shiftTxt = shift ? `${shift.start}-${shift.end}` : "";
        const rec = getEmpRecord(key, emp.id);

        rows.push([
          key,
          dayName,
          emp.name,
          shiftTxt,
          rec.inTs ? fmtTime(rec.inTs) : "",
          rec.outTs ? fmtTime(rec.outTs) : ""
        ].map(csvEscape).join(","));
      }
    }

    const company = (state.settings.company || "empresa").replaceAll(" ", "_");
    downloadText(`${company}_fichaje_semana_${getDateKey(monday)}.csv`, rows.join("\n"), "text/csv;charset=utf-8");
  }

  // Settings modal
  function openSettings() {
    el.inpCompany.value = state.settings.company || "";
    el.chkPin.checked = !!state.settings.requirePin;
    el.inpPin.value = "";

    el.settingsBackdrop.hidden = false;
    el.settingsModal.hidden = false;

    renderEmpAdmin();
  }

  function closeSettings() {
    el.settingsBackdrop.hidden = true;
    el.settingsModal.hidden = true;
  }

  async function saveSettings() {
    state.settings.company = (el.inpCompany.value.trim().slice(0, 40) || "Panel de Fichaje");
    const requirePin = !!el.chkPin.checked;
    state.settings.requirePin = requirePin;

    const newPin = el.inpPin.value.trim();
    if (requirePin) {
      if (newPin.length >= 4 && newPin.length <= 10 && /^\d+$/.test(newPin)) {
        const salt = randomSalt();
        const hash = await pbkdf2Hex(newPin, salt);
        state.settings.pinSalt = salt;
        state.settings.pinHash = hash;
      } else if (!state.settings.pinHash) {
        alert("Activas PIN, pero no has puesto un PIN válido (4–10 dígitos).");
        return;
      }
    } else {
      state.settings.pinSalt = "";
      state.settings.pinHash = "";
    }

    saveState();
    closeSettings();
    renderAll();
  }

  // Employee admin
  function renderEmpAdmin() {
    if (!el.empAdminList) return;

    el.empAdminList.innerHTML = state.employees.map(emp => {
      const initial = emp.name.trim().slice(0, 1).toUpperCase();
      return `
        <div class="empAdminItem">
          <div class="empAdminLeft">
            <div class="avatar" style="background:${escapeHtml(emp.color)}22;border-color:${escapeHtml(emp.color)}33;">
              ${escapeHtml(initial)}
            </div>
            <div style="min-width:0;">
              <div class="empAdminName">${escapeHtml(emp.name)}</div>
              <div class="empMeta">${escapeHtml(emp.note || "")}</div>
            </div>
          </div>
          <div class="empAdminBtns">
            <button class="btn" type="button" data-action="edit" data-emp="${emp.id}">Horario</button>
            <button class="btn ghost" type="button" data-action="rename" data-emp="${emp.id}">Renombrar</button>
            <button class="btn ghost" type="button" data-action="remove" data-emp="${emp.id}">Eliminar</button>
          </div>
        </div>
      `;
    }).join("");

    el.empAdminList.querySelectorAll("button[data-action]").forEach(b => {
      b.addEventListener("click", () => {
        const action = b.getAttribute("data-action");
        const empId = b.getAttribute("data-emp");
        const emp = state.employees.find(e => e.id === empId);
        if (!emp) return;

        if (action === "edit") openEditEmployee(emp);
        if (action === "rename") renameEmployee(emp);
        if (action === "remove") removeEmployee(emp);
      });
    });
  }

  function addEmployee() {
    const name = el.inpNewEmployee.value.trim();
    if (!name) return;

    const color = el.inpNewColor.value || "#6ee7ff";
    state.employees.push(createEmployee(name, color));

    el.inpNewEmployee.value = "";
    saveState();
    renderEmpAdmin();
    renderAll();
  }

  function renameEmployee(emp) {
    const v = prompt("Nuevo nombre:", emp.name);
    if (v == null) return;
    const n = v.trim().slice(0, 40);
    if (!n) return;
    emp.name = n;
    saveState();
    renderEmpAdmin();
    renderAll();
  }

  function removeEmployee(emp) {
    const ok = confirm(`¿Eliminar a ${emp.name}?`);
    if (!ok) return;

    state.employees = state.employees.filter(e => e.id !== emp.id);

    // No borramos records por seguridad; quedan “huérfanos”
    saveState();
    renderEmpAdmin();
    renderAll();
  }

  // Edit schedule modal
  let editingEmp = null;

  function openEditEmployee(emp) {
    editingEmp = emp;
    el.editTitle.textContent = "Editar horario";
    el.editSub.textContent = emp.name;

    el.inpEmpNote.value = emp.note || "";
    renderScheduleGrid(emp);

    el.editBackdrop.hidden = false;
    el.editModal.hidden = false;
  }

  function closeEditEmployee() {
    el.editBackdrop.hidden = true;
    el.editModal.hidden = true;
    editingEmp = null;
  }

  function renderScheduleGrid(emp) {
    const html = [];
    for (let i = 0; i < 7; i++) {
      const d = DAY_NAMES[i];
      const s = emp.weekly?.[i] || null;
      const start = s?.start || "";
      const end = s?.end || "";

      html.push(`
        <div class="dayCard" data-day="${i}">
          <div class="dayTitle">${d}</div>
          <div class="dayRow">
            <input class="input" type="time" data-k="start" value="${escapeHtml(start)}" />
            <input class="input" type="time" data-k="end" value="${escapeHtml(end)}" />
          </div>
          <div class="hint">Vacío = sin turno</div>
        </div>
      `);
    }
    el.scheduleGrid.innerHTML = html.join("");
  }

  function applyTemplateWeek() {
    if (!editingEmp) return;
    // L-V 09-17
    for (let i = 0; i < 7; i++) {
      if (i >= 1 && i <= 5) editingEmp.weekly[i] = { start: "09:00", end: "17:00" };
      else editingEmp.weekly[i] = null;
    }
    renderScheduleGrid(editingEmp);
  }

  function clearSchedule() {
    if (!editingEmp) return;
    for (let i = 0; i < 7; i++) editingEmp.weekly[i] = null;
    renderScheduleGrid(editingEmp);
  }

  function saveEditEmployee() {
    if (!editingEmp) return;

    editingEmp.note = el.inpEmpNote.value.trim().slice(0, 80);

    // Leer inputs
    el.scheduleGrid.querySelectorAll(".dayCard").forEach(card => {
      const day = parseInt(card.getAttribute("data-day"), 10);
      const start = card.querySelector('input[data-k="start"]').value;
      const end = card.querySelector('input[data-k="end"]').value;

      if (start && end) {
        editingEmp.weekly[day] = { start, end };
      } else {
        editingEmp.weekly[day] = null;
      }
    });

    saveState();
    closeEditEmployee();
    renderEmpAdmin();
    renderAll();
  }

  // Clear day records
  async function clearDayRecords() {
    if (!(await ensurePinAllowed())) return;
    const key = getDateKey(viewDate);
    const ok = confirm(`¿Borrar fichajes del día ${key} para TODOS los empleados?`);
    if (!ok) return;

    state.records[key] = {};
    addEvent("RESET", { id: "", name: "Sistema" }, key, { note: "Borrado día completo" });
    saveState();
    renderAll();
  }

  // PWA install prompt + SW
  let deferredInstallPrompt = null;

  function setupPWA() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      el.btnInstall.hidden = false;
    });

    el.btnInstall.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      try { await deferredInstallPrompt.userChoice; } catch {}
      deferredInstallPrompt = null;
      el.btnInstall.hidden = true;
    });
  }

  // Render all
  function renderAll() {
    renderHeader();
    renderDateControls();
    renderList();
    renderEvents();
  }

  // Bind UI
  function bindUI() {
    // Date
    el.datePicker.addEventListener("change", () => {
      viewDate = parseDateInputValue(el.datePicker.value);
      renderAll();
    });

    el.btnPrevDay.addEventListener("click", () => {
      viewDate = clampDay(viewDate, -1);
      renderAll();
    });

    el.btnNextDay.addEventListener("click", () => {
      viewDate = clampDay(viewDate, 1);
      renderAll();
    });

    el.btnToday.addEventListener("click", () => {
      viewDate = new Date();
      renderAll();
    });

    // Search
    el.searchInput.addEventListener("input", () => {
      searchQuery = el.searchInput.value.trim().toLowerCase();
      renderList();
    });

    // Exports
    el.btnExportDay.addEventListener("click", exportDayCSV);
    el.btnExportWeek.addEventListener("click", exportWeekCSV);

    // Clear day
    el.btnClearDay.addEventListener("click", clearDayRecords);

    // Settings
    el.btnSettings.addEventListener("click", openSettings);
    el.btnCloseSettings.addEventListener("click", closeSettings);
    el.btnCancelSettings.addEventListener("click", closeSettings);
    el.settingsBackdrop.addEventListener("click", closeSettings);
    el.btnSaveSettings.addEventListener("click", saveSettings);

    // Add employee
    el.btnAddEmployee.addEventListener("click", addEmployee);
    el.inpNewEmployee.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addEmployee();
    });

    // Edit modal
    el.btnCloseEdit.addEventListener("click", closeEditEmployee);
    el.btnCancelEdit.addEventListener("click", closeEditEmployee);
    el.editBackdrop.addEventListener("click", closeEditEmployee);
    el.btnSaveEdit.addEventListener("click", saveEditEmployee);

    el.btnTemplateWeek.addEventListener("click", applyTemplateWeek);
    el.btnClearSchedule.addEventListener("click", clearSchedule);

    // Esc
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeEditEmployee();
        closeSettings();
      }
    });
  }

  // Boot
  function boot() {
    // Fecha inicial = hoy
    viewDate = new Date();
    el.datePicker.value = toDateInputValue(viewDate);

    bindUI();
    setupPWA();
    renderAll();

    // refresco suave del estado "En turno" (solo UI)
    setInterval(() => {
      renderList();
    }, 15000);

    console.log("[Smouj013] Panel de fichaje listo.");
  }

  boot();

})();
