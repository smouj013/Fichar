/* app.js — ClockIn v2.0.1 */
(() => {
  "use strict";

  const VERSION = String((typeof window !== "undefined" && window.APP_VERSION) || "2.0.1");
  const STORAGE_KEY = "clockin_state_v2";

  const DOW_KEYS = ["sun","mon","tue","wed","thu","fri","sat"];
  const DOW_LABEL = { mon:"Lun", tue:"Mar", wed:"Mié", thu:"Jue", fri:"Vie", sat:"Sáb", sun:"Dom" };

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // ───────────────────────── State ─────────────────────────
  const now = () => Date.now();

  function uid() {
    try { return crypto.randomUUID(); } catch (_) {}
    return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return makeDefaultState();
      const parsed = JSON.parse(raw);
      return normalizeState(parsed);
    } catch (_) {
      return makeDefaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function makeDefaultSchedule() {
    const base = { off:false, start:"09:00", end:"17:00" };
    return {
      mon:{...base}, tue:{...base}, wed:{...base}, thu:{...base}, fri:{...base},
      sat:{off:true, start:"", end:""},
      sun:{off:true, start:"", end:""}
    };
  }

  function initialsFromName(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "??";
    const a = parts[0][0] || "?";
    const b = parts.length > 1 ? (parts[parts.length-1][0] || "") : (parts[0][1] || "");
    return (a + b).toUpperCase();
  }

  function makeDefaultState() {
    const a = { id: uid(), name: "Empleado 1", schedule: makeDefaultSchedule(), createdAt: now() };
    const b = { id: uid(), name: "Empleado 2", schedule: makeDefaultSchedule(), createdAt: now() };
    return {
      version: VERSION,
      settings: { geoEnabled: false },
      security: { pin: null }, // {saltB64, iter, hashB64}
      employees: [a, b],
      events: [] // {id, empId, type, ts, note, loc, hash}
    };
  }

  function normalizeState(s) {
    const st = s && typeof s === "object" ? s : makeDefaultState();
    st.version = VERSION;

    if (!st.settings || typeof st.settings !== "object") st.settings = { geoEnabled:false };
    if (typeof st.settings.geoEnabled !== "boolean") st.settings.geoEnabled = false;

    if (!st.security || typeof st.security !== "object") st.security = { pin:null };
    if (st.security.pin && (!st.security.pin.saltB64 || !st.security.pin.hashB64)) st.security.pin = null;

    if (!Array.isArray(st.employees)) st.employees = [];
    st.employees = st.employees
      .filter(e => e && e.id && e.name)
      .map(e => ({
        id: String(e.id),
        name: String(e.name),
        schedule: normalizeSchedule(e.schedule),
        createdAt: Number(e.createdAt || now())
      }));

    if (!Array.isArray(st.events)) st.events = [];
    st.events = st.events
      .filter(ev => ev && ev.id && ev.empId && ev.type && ev.ts)
      .map(ev => ({
        id: String(ev.id),
        empId: String(ev.empId),
        type: String(ev.type),
        ts: Number(ev.ts),
        note: ev.note ? String(ev.note) : "",
        loc: ev.loc && typeof ev.loc === "object" ? { lat: Number(ev.loc.lat), lon: Number(ev.loc.lon) } : null,
        hash: ev.hash ? String(ev.hash) : ""
      }));

    if (!st.employees.length) st.employees = makeDefaultState().employees;
    return st;
  }

  function normalizeSchedule(sch) {
    const def = makeDefaultSchedule();
    const out = {};
    for (const k of Object.keys(def)) {
      const v = sch && sch[k] ? sch[k] : def[k];
      out[k] = {
        off: !!v.off,
        start: v.start ? String(v.start) : "",
        end: v.end ? String(v.end) : ""
      };
    }
    return out;
  }

  let state = loadState();

  // ───────────────────────── Date helpers ─────────────────────────
  function pad2(n){ return String(n).padStart(2,"0"); }

  function dateKeyLocal(msOrDate) {
    const d = (msOrDate instanceof Date) ? msOrDate : new Date(msOrDate);
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  }

  function timeHHMM(ms) {
    const d = new Date(ms);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function prettyDateLong(ms) {
    try {
      return new Intl.DateTimeFormat("es-ES", { weekday:"long", year:"numeric", month:"long", day:"numeric" }).format(new Date(ms));
    } catch(_) {
      return dateKeyLocal(ms);
    }
  }

  function fmtDuration(ms) {
    ms = Math.max(0, ms|0);
    const m = Math.floor(ms / 60000);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h <= 0) return `${mm} min`;
    return `${h} h ${mm} min`;
  }

  function todayDowKey() {
    const d = new Date();
    return DOW_KEYS[d.getDay()];
  }

  // ───────────────────────── Crypto (PIN + Hash) ─────────────────────────
  function b64FromBuf(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function bufFromB64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function hexFromBuf(buf) {
    const b = new Uint8Array(buf);
    let out = "";
    for (let i=0;i<b.length;i++) out += b[i].toString(16).padStart(2,"0");
    return out;
  }
  function constEq(a,b){
    a = String(a); b = String(b);
    if (a.length !== b.length) return false;
    let ok = 0;
    for (let i=0;i<a.length;i++) ok |= (a.charCodeAt(i) ^ b.charCodeAt(i));
    return ok === 0;
  }

  async function sha256Hex(str) {
    const enc = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest("SHA-256", enc);
    return hexFromBuf(hash);
  }

  async function pbkdf2HashB64(password, saltB64, iter) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name:"PBKDF2", hash:"SHA-256", salt: bufFromB64(saltB64), iterations: iter },
      keyMaterial,
      256
    );
    return b64FromBuf(bits);
  }

  async function makeEventHash(ev, prevHash) {
    const payload = JSON.stringify({
      prev: prevHash || "GENESIS",
      id: ev.id, empId: ev.empId, type: ev.type, ts: ev.ts,
      note: ev.note || "",
      loc: ev.loc ? { lat: ev.loc.lat, lon: ev.loc.lon } : null
    });
    return sha256Hex(payload);
  }

  function lastHash() {
    if (!state.events.length) return "GENESIS";
    return state.events[state.events.length - 1].hash || "GENESIS";
  }

  // ───────────────────────── UI: modal + toast ─────────────────────────
  const modalBackdrop = $("#modalBackdrop");
  const modalTitle = $("#modalTitle");
  const modalBody = $("#modalBody");
  const modalActions = $("#modalActions");
  const modalClose = $("#modalClose");

  const toasts = $("#toasts");

  function toast(icon, msg, sub) {
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `
      <div class="ticon">${icon || "ℹ️"}</div>
      <div>
        <div class="tmsg">${escapeHtml(msg)}</div>
        ${sub ? `<div class="tsub">${escapeHtml(sub)}</div>` : ""}
      </div>
    `;
    toasts.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(6px)"; }, 2400);
    setTimeout(() => el.remove(), 2900);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function openModal(title, bodyNode, actions = []) {
    modalTitle.textContent = title || "—";
    modalBody.innerHTML = "";
    modalBody.appendChild(bodyNode);
    modalActions.innerHTML = "";
    for (const a of actions) modalActions.appendChild(a);
    modalBackdrop.hidden = false;
  }
  function closeModal() { modalBackdrop.hidden = true; }
  modalClose.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });

  function mkBtn(label, cls, onClick) {
    const b = document.createElement("button");
    b.className = cls || "btn";
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  // ───────────────────────── Core logic ─────────────────────────
  function getEmployee(empId) {
    return state.employees.find(e => e.id === empId) || null;
  }

  function eventsForEmpDay(empId, dayKey) {
    return state.events
      .filter(ev => ev.empId === empId && dateKeyLocal(ev.ts) === dayKey)
      .sort((a,b) => a.ts - b.ts);
  }

  function computeDay(empId, dayKey) {
    const evs = eventsForEmpDay(empId, dayKey);

    let firstIn = null;
    let lastOut = null;

    let workMs = 0;
    let breakMs = 0;

    let workStart = null;     // si está trabajando
    let breakStart = null;    // si está en pausa

    for (const ev of evs) {
      if (ev.type === "IN") {
        if (!firstIn) firstIn = ev.ts;
        // reinicia si estaba en estados raros
        workStart = ev.ts;
        breakStart = null;
      }
      else if (ev.type === "BREAK_START") {
        if (workStart != null) {
          workMs += Math.max(0, ev.ts - workStart);
          workStart = null;
        }
        if (breakStart == null) breakStart = ev.ts;
      }
      else if (ev.type === "BREAK_END") {
        if (breakStart != null) {
          breakMs += Math.max(0, ev.ts - breakStart);
          breakStart = null;
        }
        // vuelve a trabajar
        if (workStart == null) workStart = ev.ts;
      }
      else if (ev.type === "OUT") {
        // si estaba en break, cerramos break aquí (por seguridad)
        if (breakStart != null) {
          breakMs += Math.max(0, ev.ts - breakStart);
          breakStart = null;
        }
        if (workStart != null) {
          workMs += Math.max(0, ev.ts - workStart);
          workStart = null;
        }
        lastOut = ev.ts;
      }
    }

    const n = now();
    const isToday = (dayKey === dateKeyLocal(n));
    if (isToday) {
      if (breakStart != null) breakMs += Math.max(0, n - breakStart);
      if (workStart != null) workMs += Math.max(0, n - workStart);
    }

    let status = "No fichado";
    let phase = "OUT"; // OUT | IN | BREAK | DONE
    if (firstIn && !lastOut) {
      if (breakStart != null) { status = "En pausa"; phase = "BREAK"; }
      else { status = "Trabajando"; phase = "IN"; }
    } else if (firstIn && lastOut) {
      status = "Finalizado"; phase = "DONE";
    }

    return { firstIn, lastOut, workMs, breakMs, status, phase, evs };
  }

  function scheduleStr(emp, dowKey) {
    const slot = emp.schedule && emp.schedule[dowKey];
    if (!slot || slot.off) return "Libre";
    const s = (slot.start || "").trim();
    const e = (slot.end || "").trim();
    if (!s || !e) return "—";
    return `${s}–${e}`;
  }

  async function getGeoIfEnabled() {
    if (!state.settings.geoEnabled) return null;
    if (!("geolocation" in navigator)) return null;

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = Math.round(pos.coords.latitude * 1000) / 1000;
          const lon = Math.round(pos.coords.longitude * 1000) / 1000;
          resolve({ lat, lon });
        },
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 }
      );
    });
  }

  function eventTypeLabel(t) {
    if (t === "IN") return "Entrada";
    if (t === "OUT") return "Salida";
    if (t === "BREAK_START") return "Pausa inicio";
    if (t === "BREAK_END") return "Pausa fin";
    return t;
  }

  async function addEvent(empId, type, note) {
    const emp = getEmployee(empId);
    if (!emp) return;

    const ev = {
      id: uid(),
      empId,
      type,
      ts: now(),
      note: note ? String(note) : "",
      loc: await getGeoIfEnabled(),
      hash: ""
    };
    ev.hash = await makeEventHash(ev, lastHash());

    state.events.push(ev);
    saveState();

    toast("✅", `${eventTypeLabel(type)} — ${emp.name}`, ev.note ? ev.note : "");
    renderAll();
  }

  function askNoteModal(title, onOk) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.innerHTML = `
      <span>Nota (opcional)</span>
      <textarea id="mNote" placeholder="Ej: médico, reunión, incidencia..."></textarea>
      <div class="small muted">Se guarda junto al evento.</div>
    `;
    const ta = $("#mNote", wrap);

    const bCancel = mkBtn("Cancelar", "btn btn-ghost", () => { closeModal(); });
    const bNo = mkBtn("Guardar sin nota", "btn btn-ghost", () => { closeModal(); onOk(""); });
    const bOk = mkBtn("Guardar", "btn btn-primary", () => { closeModal(); onOk(ta.value || ""); });

    openModal(title, wrap, [bCancel, bNo, bOk]);
    setTimeout(() => ta.focus(), 0);
  }

  // ───────────────────────── PIN flow ─────────────────────────
  async function requirePinIfSet(reasonText) {
    if (!state.security.pin) return true;

    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "field";
      wrap.innerHTML = `
        <span>Introduce el PIN</span>
        <input id="mPin" type="password" inputmode="numeric" placeholder="PIN" />
        <div class="small muted">${escapeHtml(reasonText || "Acción protegida")}</div>
      `;
      const pin = $("#mPin", wrap);

      const bCancel = mkBtn("Cancelar", "btn btn-ghost", () => { closeModal(); resolve(false); });
      const bOk = mkBtn("Verificar", "btn btn-primary", async () => {
        const ok = await verifyPin(pin.value || "");
        if (!ok) {
          toast("⛔", "PIN incorrecto");
          return;
        }
        closeModal();
        resolve(true);
      });

      openModal("Seguridad", wrap, [bCancel, bOk]);
      setTimeout(() => pin.focus(), 0);
    });
  }

  async function verifyPin(pin) {
    const p = state.security.pin;
    if (!p) return true;
    try {
      const hash = await pbkdf2HashB64(pin, p.saltB64, p.iter);
      return constEq(hash, p.hashB64);
    } catch (_) { return false; }
  }

  async function setPinFlow() {
    const wrap = document.createElement("div");
    wrap.className = "grid";
    wrap.style.display = "grid";
    wrap.style.gap = "12px";
    wrap.innerHTML = `
      <label class="field">
        <span>Nuevo PIN</span>
        <input id="p1" type="password" inputmode="numeric" placeholder="PIN (mín. 4)" />
      </label>
      <label class="field">
        <span>Repetir PIN</span>
        <input id="p2" type="password" inputmode="numeric" placeholder="Repite PIN" />
      </label>
      <div class="small muted">Se cifra con PBKDF2 (SHA-256) y se guarda localmente.</div>
    `;
    const p1 = $("#p1", wrap);
    const p2 = $("#p2", wrap);

    const bCancel = mkBtn("Cancelar", "btn btn-ghost", () => closeModal());
    const bOk = mkBtn("Guardar PIN", "btn btn-primary", async () => {
      const a = (p1.value || "").trim();
      const b = (p2.value || "").trim();
      if (a.length < 4) { toast("⚠️", "PIN demasiado corto", "Mínimo 4 dígitos"); return; }
      if (a !== b) { toast("⚠️", "No coincide el PIN"); return; }

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const saltB64 = b64FromBuf(salt.buffer);
      const iter = 120000;

      const hashB64 = await pbkdf2HashB64(a, saltB64, iter);
      state.security.pin = { saltB64, iter, hashB64 };
      saveState();
      closeModal();
      toast("🔐", "PIN guardado");
      renderAll();
    });

    openModal("Configurar PIN", wrap, [bCancel, bOk]);
    setTimeout(() => p1.focus(), 0);
  }

  async function clearPinFlow() {
    const ok = await requirePinIfSet("Para quitar el PIN, confírmalo.");
    if (!ok) return;
    state.security.pin = null;
    saveState();
    toast("✅", "PIN eliminado");
    renderAll();
  }

  // ───────────────────────── Employees (CRUD) ─────────────────────────
  function scheduleEditorNode(schedule) {
    const sch = normalizeSchedule(schedule);
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.style.marginTop = "10px";
    wrap.innerHTML = `<div class="card-title">Horario semanal</div>`;

    const table = document.createElement("div");
    table.className = "grid";
    table.style.display = "grid";
    table.style.gridTemplateColumns = "1fr 1fr 1fr auto";
    table.style.gap = "10px";
    table.style.alignItems = "center";

    for (const k of ["mon","tue","wed","thu","fri","sat","sun"]) {
      const day = document.createElement("div");
      day.className = "small muted";
      day.textContent = DOW_LABEL[k];

      const start = document.createElement("input");
      start.type = "time";
      start.value = sch[k].start || "";

      const end = document.createElement("input");
      end.type = "time";
      end.value = sch[k].end || "";

      const offWrap = document.createElement("label");
      offWrap.className = "toggle";
      offWrap.innerHTML = `<input type="checkbox"><span class="slider"></span>`;
      const off = $("input", offWrap);
      off.checked = !!sch[k].off;

      const applyOff = () => {
        const isOff = off.checked;
        start.disabled = isOff;
        end.disabled = isOff;
        if (isOff) { start.value = ""; end.value = ""; }
        else {
          if (!start.value) start.value = "09:00";
          if (!end.value) end.value = "17:00";
        }
      };
      off.addEventListener("change", applyOff);
      applyOff();

      table.appendChild(day);
      table.appendChild(start);
      table.appendChild(end);
      table.appendChild(offWrap);

      sch[k]._startEl = start;
      sch[k]._endEl = end;
      sch[k]._offEl = off;
    }

    wrap.appendChild(table);

    wrap.getSchedule = () => {
      const out = {};
      for (const k of ["mon","tue","wed","thu","fri","sat","sun"]) {
        out[k] = {
          off: !!sch[k]._offEl.checked,
          start: sch[k]._startEl.value || "",
          end: sch[k]._endEl.value || ""
        };
      }
      return out;
    };

    return wrap;
  }

  function addOrEditEmployeeFlow(empId) {
    const isEdit = !!empId;
    const emp = isEdit ? getEmployee(empId) : null;

    const wrap = document.createElement("div");

    const nameField = document.createElement("label");
    nameField.className = "field";
    nameField.innerHTML = `<span>Nombre</span><input id="eName" type="text" placeholder="Nombre del empleado" />`;
    const nameInput = $("#eName", nameField);
    nameInput.value = emp ? emp.name : "";

    const schNode = scheduleEditorNode(emp ? emp.schedule : makeDefaultSchedule());

    wrap.appendChild(nameField);
    wrap.appendChild(schNode);

    const bCancel = mkBtn("Cancelar", "btn btn-ghost", () => closeModal());
    const bSave = mkBtn(isEdit ? "Guardar cambios" : "Crear empleado", "btn btn-primary", () => {
      const name = (nameInput.value || "").trim();
      if (name.length < 2) { toast("⚠️", "Nombre demasiado corto"); return; }

      const schedule = schNode.getSchedule();

      if (isEdit) {
        emp.name = name;
        emp.schedule = schedule;
      } else {
        state.employees.push({
          id: uid(),
          name,
          schedule,
          createdAt: now()
        });
      }
      saveState();
      closeModal();
      toast("✅", isEdit ? "Empleado actualizado" : "Empleado creado", name);
      renderAll();
    });

    openModal(isEdit ? "Editar empleado" : "Añadir empleado", wrap, [bCancel, bSave]);
    setTimeout(() => nameInput.focus(), 0);
  }

  async function deleteEmployeeFlow(empId) {
    const emp = getEmployee(empId);
    if (!emp) return;

    const ok = await requirePinIfSet("Borrar empleado y sus eventos requiere PIN (si está activo).");
    if (!ok) return;

    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="muted">Se borrará <b>${escapeHtml(emp.name)}</b> y todos sus eventos.</div>`;
    const bCancel = mkBtn("Cancelar", "btn btn-ghost", () => closeModal());
    const bDel = mkBtn("Borrar", "btn btn-danger", () => {
      state.employees = state.employees.filter(e => e.id !== empId);
      state.events = state.events.filter(ev => ev.empId !== empId);
      saveState();
      closeModal();
      toast("🗑️", "Empleado borrado", emp.name);
      renderAll();
    });

    openModal("Confirmar borrado", wrap, [bCancel, bDel]);
  }

  // ───────────────────────── Export / Backup / Restore / Wipe ─────────────────────────
  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 800);
  }

  function csvEscape(v) {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  }

  async function exportResumenCSV() {
    const ok = await requirePinIfSet("Exportar CSV está protegido por PIN (si está activo).");
    if (!ok) return;

    const dayKey = dateKeyLocal(now());
    const dowKey = todayDowKey();

    let csv = "Empleado,Horario,Entrada,Salida,Pausa,Trabajado,Estado\n";
    for (const emp of state.employees) {
      const d = computeDay(emp.id, dayKey);
      csv += [
        csvEscape(emp.name),
        csvEscape(scheduleStr(emp, dowKey)),
        csvEscape(d.firstIn ? timeHHMM(d.firstIn) : ""),
        csvEscape(d.lastOut ? timeHHMM(d.lastOut) : ""),
        csvEscape(fmtDuration(d.breakMs)),
        csvEscape(fmtDuration(d.workMs)),
        csvEscape(d.status)
      ].join(",") + "\n";
    }
    downloadText(`clockin_resumen_${dayKey}.csv`, csv, "text/csv;charset=utf-8");
    toast("⬇️", "Resumen CSV exportado");
  }

  async function exportEventosCSV(filteredEvents) {
    const ok = await requirePinIfSet("Exportar CSV está protegido por PIN (si está activo).");
    if (!ok) return;

    const rows = filteredEvents || state.events.slice().sort((a,b) => a.ts - b.ts);
    let csv = "Fecha,Hora,Empleado,Tipo,Nota,Ubicacion,Hash\n";
    for (const ev of rows) {
      const emp = getEmployee(ev.empId);
      const loc = ev.loc ? `${ev.loc.lat},${ev.loc.lon}` : "";
      csv += [
        csvEscape(dateKeyLocal(ev.ts)),
        csvEscape(timeHHMM(ev.ts)),
        csvEscape(emp ? emp.name : ev.empId),
        csvEscape(eventTypeLabel(ev.type)),
        csvEscape(ev.note || ""),
        csvEscape(loc),
        csvEscape(ev.hash || "")
      ].join(",") + "\n";
    }
    downloadText(`clockin_eventos_${dateKeyLocal(now())}.csv`, csv, "text/csv;charset=utf-8");
    toast("⬇️", "Eventos CSV exportados");
  }

  async function backupJSON() {
    const ok = await requirePinIfSet("Exportar copia JSON está protegido por PIN (si está activo).");
    if (!ok) return;

    const payload = JSON.stringify(state, null, 2);
    downloadText(`clockin_backup_${dateKeyLocal(now())}.json`, payload, "application/json;charset=utf-8");
    toast("⬇️", "Copia JSON exportada");
  }

  async function restoreJSON(file) {
    const ok = await requirePinIfSet("Importar copia JSON está protegido por PIN (si está activo).");
    if (!ok) return;

    const text = await file.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { toast("⛔","JSON inválido"); return; }

    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="muted">Vas a reemplazar los datos actuales por la copia importada.</div>`;
    const bCancel = mkBtn("Cancelar", "btn btn-ghost", () => closeModal());
    const bOk = mkBtn("Importar", "btn btn-primary", () => {
      state = normalizeState(parsed);
      saveState();
      closeModal();
      toast("✅", "Copia importada");
      renderAll();
    });

    openModal("Confirmar importación", wrap, [bCancel, bOk]);
  }

  async function wipeAll() {
    const ok = await requirePinIfSet("Borrar todo está protegido por PIN (si está activo).");
    if (!ok) return;

    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="muted">Esto borrará empleados, horarios y eventos (solo en este dispositivo).</div>`;
    const bCancel = mkBtn("Cancelar", "btn btn-ghost", () => closeModal());
    const bOk = mkBtn("Borrar todo", "btn btn-danger", () => {
      localStorage.removeItem(STORAGE_KEY);
      closeModal();
      location.reload();
    });
    openModal("Confirmar borrado total", wrap, [bCancel, bOk]);
  }

  // ───────────────────────── Routing + Rendering ─────────────────────────
  const uiDate = $("#uiDate");
  const uiCounts = $("#uiCounts");
  const uiOffline = $("#uiOffline");
  const uiVer = $("#uiVer");

  const employeeList = $("#employeeList");
  const employeeAdminList = $("#employeeAdminList");

  const summaryTableBody = $("#summaryTable tbody");
  const eventsTableBody = $("#eventsTable tbody");

  const fEmp = $("#fEmp");
  const fFrom = $("#fFrom");
  const fTo = $("#fTo");

  function setRoute(route) {
    $$(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.route === route));
    $$(".view").forEach(v => {
      const is = v.dataset.route === route;
      v.hidden = !is;
    });
    // re-render vista
    renderAll();
  }

  $$(".tab").forEach(btn => {
    btn.addEventListener("click", () => setRoute(btn.dataset.route));
  });

  function renderPanel() {
    employeeList.innerHTML = "";

    const dayKey = dateKeyLocal(now());
    const dowKey = todayDowKey();

    uiCounts.textContent = `${state.employees.length} empleado(s)`;

    for (const emp of state.employees) {
      const d = computeDay(emp.id, dayKey);
      const initials = initialsFromName(emp.name);

      const el = document.createElement("div");
      el.className = "emp";

      const pills = [];
      pills.push(`<span class="pill ${d.phase === "IN" ? "ok" : d.phase === "BREAK" ? "warn" : d.phase === "DONE" ? "off" : ""}">${escapeHtml(d.status)}</span>`);
      pills.push(`<span class="pill">${escapeHtml(scheduleStr(emp, dowKey))}</span>`);
      pills.push(`<span class="pill">Pausa: ${escapeHtml(fmtDuration(d.breakMs))}</span>`);
      pills.push(`<span class="pill">Trab.: ${escapeHtml(fmtDuration(d.workMs))}</span>`);

      el.innerHTML = `
        <div class="emp-left">
          <div class="avatar">${escapeHtml(initials)}</div>
          <div class="emp-meta">
            <div class="emp-name">${escapeHtml(emp.name)}</div>
            <div class="emp-sub">${pills.join("")}</div>
          </div>
        </div>
        <div class="emp-right"></div>
      `;

      const right = $(".emp-right", el);

      const btnClock = document.createElement("button");
      btnClock.className = "btn btn-primary";
      btnClock.textContent = (d.phase === "OUT") ? "Entrada" : (d.phase === "DONE") ? "Entrada" : "Salida";

      btnClock.addEventListener("click", async () => {
        const cur = computeDay(emp.id, dayKey);
        if (cur.phase === "BREAK") {
          toast("⚠️", "Termina la pausa antes de salir");
          return;
        }
        const type = (cur.phase === "OUT" || cur.phase === "DONE") ? "IN" : "OUT";
        askNoteModal(`${eventTypeLabel(type)} — ${emp.name}`, (note) => addEvent(emp.id, type, note));
      });

      const btnBreak = document.createElement("button");
      btnBreak.className = "btn";
      btnBreak.textContent = (d.phase === "BREAK") ? "Fin pausa" : "Pausa";
      btnBreak.disabled = (d.phase === "OUT" || d.phase === "DONE");
      btnBreak.addEventListener("click", async () => {
        const cur = computeDay(emp.id, dayKey);
        if (cur.phase === "OUT" || cur.phase === "DONE") return;
        const type = (cur.phase === "BREAK") ? "BREAK_END" : "BREAK_START";
        askNoteModal(`${eventTypeLabel(type)} — ${emp.name}`, (note) => addEvent(emp.id, type, note));
      });

      right.appendChild(btnClock);
      right.appendChild(btnBreak);

      employeeList.appendChild(el);
    }
  }

  function renderResumen() {
    summaryTableBody.innerHTML = "";
    const dayKey = dateKeyLocal(now());
    const dowKey = todayDowKey();

    for (const emp of state.employees) {
      const d = computeDay(emp.id, dayKey);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(emp.name)}</td>
        <td>${escapeHtml(scheduleStr(emp, dowKey))}</td>
        <td>${d.firstIn ? escapeHtml(timeHHMM(d.firstIn)) : ""}</td>
        <td>${d.lastOut ? escapeHtml(timeHHMM(d.lastOut)) : ""}</td>
        <td>${escapeHtml(fmtDuration(d.breakMs))}</td>
        <td>${escapeHtml(fmtDuration(d.workMs))}</td>
        <td>${escapeHtml(d.status)}</td>
      `;
      summaryTableBody.appendChild(tr);
    }
  }

  function fillEmpFilter() {
    const cur = fEmp.value;
    fEmp.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "Todos";
    fEmp.appendChild(optAll);

    for (const emp of state.employees) {
      const opt = document.createElement("option");
      opt.value = emp.id;
      opt.textContent = emp.name;
      fEmp.appendChild(opt);
    }
    if ([...fEmp.options].some(o => o.value === cur)) fEmp.value = cur;
  }

  function filterEvents() {
    const empId = fEmp.value || "";
    const from = fFrom.value || "";
    const to = fTo.value || "";

    const fromTs = from ? new Date(from + "T00:00:00").getTime() : null;
    const toTs = to ? new Date(to + "T23:59:59").getTime() : null;

    return state.events
      .slice()
      .sort((a,b) => b.ts - a.ts)
      .filter(ev => {
        if (empId && ev.empId !== empId) return false;
        if (fromTs != null && ev.ts < fromTs) return false;
        if (toTs != null && ev.ts > toTs) return false;
        return true;
      });
  }

  function renderHistorial() {
    fillEmpFilter();

    const rows = filterEvents();
    eventsTableBody.innerHTML = "";

    for (const ev of rows) {
      const emp = getEmployee(ev.empId);
      const loc = ev.loc ? `${ev.loc.lat}, ${ev.loc.lon}` : "";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(dateKeyLocal(ev.ts))}</td>
        <td>${escapeHtml(timeHHMM(ev.ts))}</td>
        <td>${escapeHtml(emp ? emp.name : ev.empId)}</td>
        <td>${escapeHtml(eventTypeLabel(ev.type))}</td>
        <td>${escapeHtml(ev.note || "")}</td>
        <td class="mono">${escapeHtml(loc)}</td>
        <td class="mono">${escapeHtml((ev.hash || "").slice(0, 16))}…</td>
      `;
      eventsTableBody.appendChild(tr);
    }

    // guardamos para export
    renderHistorial._lastRows = rows;
  }

  function renderAjustes() {
    uiVer.textContent = VERSION;
    $("#tglGeo").checked = !!state.settings.geoEnabled;

    employeeAdminList.innerHTML = "";
    for (const emp of state.employees) {
      const d = document.createElement("div");
      d.className = "emp";
      d.innerHTML = `
        <div class="emp-left">
          <div class="avatar">${escapeHtml(initialsFromName(emp.name))}</div>
          <div class="emp-meta">
            <div class="emp-name">${escapeHtml(emp.name)}</div>
            <div class="emp-sub">
              <span class="pill">${escapeHtml(scheduleStr(emp, todayDowKey()))}</span>
              <span class="pill off">ID: <span class="mono">${escapeHtml(emp.id.slice(0,8))}</span></span>
            </div>
          </div>
        </div>
        <div class="emp-right"></div>
      `;
      const right = $(".emp-right", d);
      right.appendChild(mkBtn("Editar", "btn", () => addOrEditEmployeeFlow(emp.id)));
      right.appendChild(mkBtn("Borrar", "btn btn-danger", () => deleteEmployeeFlow(emp.id)));
      employeeAdminList.appendChild(d);
    }
  }

  function renderAll() {
    uiDate.textContent = prettyDateLong(now());
    uiOffline.hidden = navigator.onLine;

    const activeRoute = ($$(".tab").find(t => t.classList.contains("is-active"))?.dataset.route) || "panel";
    if (activeRoute === "panel") renderPanel();
    if (activeRoute === "resumen") renderResumen();
    if (activeRoute === "historial") renderHistorial();
    if (activeRoute === "ajustes") renderAjustes();
  }

  // ───────────────────────── Events wiring ─────────────────────────
  $("#btnQuickAdd").addEventListener("click", () => addOrEditEmployeeFlow(null));
  $("#btnAddEmp").addEventListener("click", () => addOrEditEmployeeFlow(null));

  $("#btnExportResumen").addEventListener("click", exportResumenCSV);
  $("#btnExportEventos").addEventListener("click", () => exportEventosCSV(renderHistorial._lastRows || null));

  $("#btnBackup").addEventListener("click", backupJSON);

  const filePicker = $("#filePicker");
  $("#btnRestore").addEventListener("click", async () => {
    const ok = await requirePinIfSet("Importar copia JSON está protegido por PIN (si está activo).");
    if (!ok) return;
    filePicker.value = "";
    filePicker.click();
  });
  filePicker.addEventListener("change", async () => {
    const file = filePicker.files && filePicker.files[0];
    if (!file) return;
    restoreJSON(file);
  });

  $("#btnWipe").addEventListener("click", wipeAll);

  $("#btnSetPin").addEventListener("click", setPinFlow);
  $("#btnClearPin").addEventListener("click", clearPinFlow);

  $("#tglGeo").addEventListener("change", () => {
    state.settings.geoEnabled = $("#tglGeo").checked;
    saveState();
    toast("📍", state.settings.geoEnabled ? "Geolocalización activada" : "Geolocalización desactivada");
  });

  $("#btnApplyFilters").addEventListener("click", renderHistorial);

  window.addEventListener("online", () => { uiOffline.hidden = true; });
  window.addEventListener("offline", () => { uiOffline.hidden = false; });

  // ───────────────────────── Service Worker updates ─────────────────────────
  const btnUpdate = $("#btnUpdate");
  let swReg = null;
  let reloaded = false;

  async function initSW() {
    if (!("serviceWorker" in navigator)) return;

    try {
      swReg = await navigator.serviceWorker.register("./sw.js");
      // update pill
      if (swReg.waiting) btnUpdate.hidden = false;

      swReg.addEventListener("updatefound", () => {
        const inst = swReg.installing;
        if (!inst) return;
        inst.addEventListener("statechange", () => {
          if (inst.state === "installed" && navigator.serviceWorker.controller) {
            btnUpdate.hidden = false;
          }
        });
      });

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloaded) return;
        reloaded = true;
        location.reload();
      });
    } catch (_) {}
  }

  btnUpdate.addEventListener("click", async () => {
    try {
      if (!swReg) return;
      btnUpdate.disabled = true;
      const w = swReg.waiting;
      if (w) w.postMessage({ type: "SKIP_WAITING" });
    } catch (_) {
      btnUpdate.disabled = false;
    }
  });

  // ───────────────────────── Boot ─────────────────────────
  renderAll();
  initSW();

  // refresco suave para que “trabajado/pausa” se actualice solo
  setInterval(() => renderAll(), 15000);

})();
