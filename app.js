(() => {
  "use strict";

  const APP_VERSION = String(window.APP_VERSION || "2.0.0");
  const STORAGE_KEY = "clockin_v2";

  const DAYS = [
    { i: 1, key: "mon", label: "Lunes" },
    { i: 2, key: "tue", label: "Martes" },
    { i: 3, key: "wed", label: "Miércoles" },
    { i: 4, key: "thu", label: "Jueves" },
    { i: 5, key: "fri", label: "Viernes" },
    { i: 6, key: "sat", label: "Sábado" },
    { i: 0, key: "sun", label: "Domingo" },
  ];

  // ────────────────────────────────────────────────────────────────────────────
  // DOM helpers
  // ────────────────────────────────────────────────────────────────────────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const pad2 = (n) => String(n).padStart(2, "0");

  function dateKeyLocal(d) {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const da = pad2(d.getDate());
    return `${y}-${m}-${da}`;
  }

  function fmtDateHuman(d) {
    return d.toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }

  function fmtTime(ts) {
    if (!Number.isFinite(ts)) return "—";
    return new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  }

  function fmtHMFromMinutes(min) {
    if (!Number.isFinite(min)) return "—";
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${h}h ${pad2(m)}m`;
  }

  function minutesFromMs(ms) {
    return Math.max(0, Math.round(ms / 60000));
  }

  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // State
  // ────────────────────────────────────────────────────────────────────────────
  function defaultSchedule() {
    // L-V 09:00-17:00 con 30m de pausa. S-D off.
    const sch = {};
    for (const d of DAYS) {
      if (d.key === "sat" || d.key === "sun") {
        sch[d.key] = { enabled: false, start: "09:00", end: "17:00", breakMin: 30 };
      } else {
        sch[d.key] = { enabled: true, start: "09:00", end: "17:00", breakMin: 30 };
      }
    }
    return sch;
  }

  function defaultState() {
    return {
      v: 2,
      settings: {
        pinSaltB64: "",
        pinHashB64: "",
        geoEnabled: false,
      },
      employees: [
        { id: "emp_ana", name: "Ana", color: "#7c5cff", active: true, schedule: defaultSchedule() },
        { id: "emp_dani", name: "Dani", color: "#22d3ee", active: true, schedule: defaultSchedule() },
      ],
      events: [],
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const s = JSON.parse(raw);

      if (!s || typeof s !== "object") return defaultState();
      if (!Array.isArray(s.employees)) s.employees = [];
      if (!Array.isArray(s.events)) s.events = [];
      if (!s.settings || typeof s.settings !== "object") s.settings = {};

      // Normaliza
      s.v = 2;
      s.settings.geoEnabled = !!s.settings.geoEnabled;
      s.settings.pinSaltB64 = String(s.settings.pinSaltB64 || "");
      s.settings.pinHashB64 = String(s.settings.pinHashB64 || "");

      // Asegura schedule
      for (const e of s.employees) {
        if (!e.schedule || typeof e.schedule !== "object") e.schedule = defaultSchedule();
        for (const d of DAYS) {
          if (!e.schedule[d.key]) e.schedule[d.key] = { enabled: d.key !== "sat" && d.key !== "sun", start: "09:00", end: "17:00", breakMin: 30 };
          e.schedule[d.key].enabled = !!e.schedule[d.key].enabled;
          e.schedule[d.key].start = String(e.schedule[d.key].start || "09:00");
          e.schedule[d.key].end = String(e.schedule[d.key].end || "17:00");
          e.schedule[d.key].breakMin = clampInt(e.schedule[d.key].breakMin, 0, 240);
        }
        e.active = (e.active !== false);
        e.color = String(e.color || "#7c5cff");
        e.name = String(e.name || "Empleado");
        e.id = String(e.id || uid("emp"));
      }

      return s;
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function clampInt(v, a, b) {
    const n = Number.isFinite(+v) ? (+v | 0) : a;
    return Math.max(a, Math.min(b, n));
  }

  let state = loadState();

  // ────────────────────────────────────────────────────────────────────────────
  // Crypto: SHA-256 + PBKDF2 (PIN)
  // ────────────────────────────────────────────────────────────────────────────
  function bytesToB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    const bin = atob(String(b64 || ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function fnv1aHex(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("00000000" + h.toString(16)).slice(-8).padStart(64, "0");
  }

  async function sha256Hex(str) {
    try {
      if (!crypto?.subtle) return fnv1aHex(str);
      const data = new TextEncoder().encode(str);
      const digest = await crypto.subtle.digest("SHA-256", data);
      const bytes = new Uint8Array(digest);
      let hex = "";
      for (const b of bytes) hex += b.toString(16).padStart(2, "0");
      return hex;
    } catch {
      return fnv1aHex(str);
    }
  }

  async function pbkdf2HashB64(pin, saltBytes, iterations = 150000) {
    if (!crypto?.subtle) throw new Error("WebCrypto no disponible");
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(pin),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
      keyMaterial,
      256
    );

    return bytesToB64(new Uint8Array(bits));
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Modal + Toast
  // ────────────────────────────────────────────────────────────────────────────
  const modalBackdrop = $("#modalBackdrop");
  const modalTitle = $("#modalTitle");
  const modalBody = $("#modalBody");
  const modalActions = $("#modalActions");
  const modalClose = $("#modalClose");

  let modalResolve = null;

  function closeModal(result = null) {
    if (!modalBackdrop) return;
    modalBackdrop.hidden = true;
    modalBody.innerHTML = "";
    modalActions.innerHTML = "";
    const r = modalResolve;
    modalResolve = null;
    if (typeof r === "function") r(result);
  }

  function openModal({ title, bodyHtml, actions }) {
    modalTitle.textContent = title || "—";
    modalBody.innerHTML = bodyHtml || "";
    modalActions.innerHTML = "";

    for (const a of (actions || [])) {
      const btn = document.createElement("button");
      btn.className = a.className || "btn";
      btn.textContent = a.label || "OK";
      btn.addEventListener("click", async () => {
        if (a.onClick) {
          const res = await a.onClick();
          if (res !== "__KEEP_OPEN__") closeModal(res);
        } else {
          closeModal(true);
        }
      });
      modalActions.appendChild(btn);
    }

    modalBackdrop.hidden = false;

    return new Promise((resolve) => {
      modalResolve = resolve;
    });
  }

  modalClose?.addEventListener("click", () => closeModal(null));
  modalBackdrop?.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeModal(null);
  });

  const toastZone = $("#toasts");
  function toast(kind, msg, sub = "") {
    const t = document.createElement("div");
    t.className = "toast";
    const icon = kind === "ok" ? "✅" : kind === "warn" ? "⚠️" : kind === "bad" ? "⛔" : "ℹ️";
    t.innerHTML = `
      <div class="ticon" aria-hidden="true">${icon}</div>
      <div>
        <div class="tmsg">${esc(msg)}</div>
        ${sub ? `<div class="tsub">${esc(sub)}</div>` : ""}
      </div>
    `;
    toastZone.appendChild(t);
    setTimeout(() => {
      t.style.opacity = "0";
      t.style.transform = "translateY(6px)";
      t.style.transition = "opacity .18s ease, transform .18s ease";
      setTimeout(() => t.remove(), 220);
    }, 3400);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Geolocation (optional)
  // ────────────────────────────────────────────────────────────────────────────
  async function getRoundedLocation() {
    if (!state.settings.geoEnabled) return null;
    if (!navigator.geolocation) return null;

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = +pos.coords.latitude.toFixed(3);
          const lng = +pos.coords.longitude.toFixed(3);
          resolve({ lat, lng });
        },
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 120000 }
      );
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Events + day stats
  // ────────────────────────────────────────────────────────────────────────────
  function getEmpById(id) {
    return state.employees.find(e => e.id === id) || null;
  }

  function dayKeyFromTS(ts) {
    return dateKeyLocal(new Date(ts));
  }

  function getEventsForEmpOnDate(empId, dKey) {
    return state.events
      .filter(ev => ev.empId === empId && dayKeyFromTS(ev.ts) === dKey)
      .sort((a,b) => a.ts - b.ts);
  }

  function getLastEventForEmp(empId) {
    const evs = state.events.filter(e => e.empId === empId).sort((a,b) => a.ts - b.ts);
    return evs.length ? evs[evs.length - 1] : null;
  }

  function getLastHashForEmp(empId) {
    const last = getLastEventForEmp(empId);
    return last?.hash || "";
  }

  function typeLabel(t) {
    return t === "IN" ? "Entrada"
      : t === "OUT" ? "Salida"
      : t === "BREAK_START" ? "Pausa (inicio)"
      : t === "BREAK_END" ? "Pausa (fin)"
      : t;
  }

  function calcDay(empId, dKey, nowTs = Date.now()) {
    const evs = getEventsForEmpOnDate(empId, dKey);

    let inTs = null;
    let outTs = null;

    let mode = "out"; // out | in | break
    let cursor = null;

    let workMs = 0;
    let breakMs = 0;

    for (const ev of evs) {
      if (ev.type === "IN") {
        if (mode === "out") {
          mode = "in";
          cursor = ev.ts;
          if (inTs == null) inTs = ev.ts;
        }
      } else if (ev.type === "BREAK_START") {
        if (mode === "in" && cursor != null) {
          workMs += Math.max(0, ev.ts - cursor);
          mode = "break";
          cursor = ev.ts;
        }
      } else if (ev.type === "BREAK_END") {
        if (mode === "break" && cursor != null) {
          breakMs += Math.max(0, ev.ts - cursor);
          mode = "in";
          cursor = ev.ts;
        }
      } else if (ev.type === "OUT") {
        if (mode === "in" && cursor != null) {
          workMs += Math.max(0, ev.ts - cursor);
        } else if (mode === "break" && cursor != null) {
          breakMs += Math.max(0, ev.ts - cursor);
        }
        mode = "out";
        cursor = null;
        outTs = ev.ts;
      }
    }

    // hasta ahora
    if (mode === "in" && cursor != null) workMs += Math.max(0, nowTs - cursor);
    if (mode === "break" && cursor != null) breakMs += Math.max(0, nowTs - cursor);

    const status =
      mode === "in" ? "Trabajando" :
      mode === "break" ? "En pausa" :
      (inTs ? "Fuera" : "Sin fichar");

    return {
      evs,
      inTs,
      outTs,
      workMs,
      breakMs,
      mode,
      status,
    };
  }

  async function addEvent(empId, type, note = "") {
    const ts = Date.now();
    const loc = await getRoundedLocation();
    const prevHash = getLastHashForEmp(empId);

    const payload = [
      prevHash,
      empId,
      type,
      String(ts),
      String(note || ""),
      loc ? String(loc.lat) : "",
      loc ? String(loc.lng) : "",
    ].join("|");

    const hash = await sha256Hex(payload);

    state.events.push({
      id: uid("evt"),
      empId,
      type,
      ts,
      note: String(note || ""),
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      prevHash,
      hash,
    });

    saveState();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // PIN (optional)
  // ────────────────────────────────────────────────────────────────────────────
  function hasPin() {
    return !!(state.settings.pinSaltB64 && state.settings.pinHashB64);
  }

  async function promptPin(title = "Introduce el PIN") {
    const res = await openModal({
      title,
      bodyHtml: `
        <label class="field">
          <span>PIN</span>
          <input id="pinInput" type="password" inputmode="numeric" autocomplete="current-password" placeholder="••••" />
          <small class="muted">Se usa para proteger exportaciones y borrados.</small>
        </label>
      `,
      actions: [
        { label: "Cancelar", className: "btn btn-ghost", onClick: () => null },
        {
          label: "Aceptar",
          className: "btn btn-primary",
          onClick: () => $("#pinInput").value.trim()
        }
      ]
    });
    return (res && String(res).trim()) ? String(res).trim() : null;
  }

  async function verifyPin(pin) {
    try {
      const salt = b64ToBytes(state.settings.pinSaltB64);
      const hash = await pbkdf2HashB64(pin, salt);
      return hash === state.settings.pinHashB64;
    } catch {
      return false;
    }
  }

  async function requirePinIfSet() {
    if (!hasPin()) return true;
    const pin = await promptPin("PIN requerido");
    if (!pin) return false;
    const ok = await verifyPin(pin);
    if (!ok) toast("bad", "PIN incorrecto");
    return ok;
  }

  async function setPinFlow() {
    const p1 = await promptPin("Configurar PIN");
    if (!p1) return;
    const p2 = await promptPin("Repite el PIN");
    if (!p2) return;
    if (p1 !== p2) {
      toast("bad", "Los PIN no coinciden");
      return;
    }
    try {
      const salt = new Uint8Array(16);
      crypto.getRandomValues(salt);
      const hash = await pbkdf2HashB64(p1, salt);
      state.settings.pinSaltB64 = bytesToB64(salt);
      state.settings.pinHashB64 = hash;
      saveState();
      toast("ok", "PIN configurado");
      renderAll();
    } catch {
      toast("bad", "No se pudo configurar el PIN (WebCrypto)");
    }
  }

  async function clearPinFlow() {
    const ok = await openModal({
      title: "Quitar PIN",
      bodyHtml: `<div class="muted">¿Seguro que quieres quitar el PIN?</div>`,
      actions: [
        { label: "Cancelar", className: "btn btn-ghost", onClick: () => null },
        { label: "Quitar", className: "btn btn-danger", onClick: () => true },
      ]
    });
    if (!ok) return;

    state.settings.pinSaltB64 = "";
    state.settings.pinHashB64 = "";
    saveState();
    toast("ok", "PIN eliminado");
    renderAll();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // UI: routing
  // ────────────────────────────────────────────────────────────────────────────
  const uiDateConsider = $("#uiDate");
  const uiVer = $("#uiVer");
  const uiCounts = $("#uiCounts");
  const uiOffline = $("#uiOffline");

  const employeeList = $("#employeeList");
  const employeeAdminList = $("#employeeAdminList");

  const summaryTableBody = $("#summaryTable tbody");
  const eventsTableBody = $("#eventsTable tbody");

  const btnQuickAdd = $("#btnQuickAdd");

  function setRoute(route) {
    $$(".tab").forEach(b => b.classList.toggle("is-active", b.dataset.route === route));
    $$(".view").forEach(v => v.hidden = v.dataset.route !== route);
    history.replaceState(null, "", `#${route}`);
  }

  function getRoute() {
    const r = location.hash.replace("#", "").trim();
    return r || "panel";
  }

  $$(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      setRoute(btn.dataset.route);
      renderAll();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Render: Panel
  // ────────────────────────────────────────────────────────────────────────────
  function scheduleForToday(emp) {
    const day = DAYS.find(d => d.i === new Date().getDay());
    const slot = emp.schedule?.[day.key];
    return slot || { enabled: false, start: "09:00", end: "17:00", breakMin: 30 };
  }

  function renderPanel() {
    const todayKey = dateKeyLocal(new Date());
    const activeEmps = state.employees.filter(e => e.active);

    // Orden: primero los que tienen turno hoy, luego el resto
    const sorted = [...activeEmps].sort((a,b) => {
      const as = scheduleForToday(a).enabled ? 0 : 1;
      const bs = scheduleForToday(b).enabled ? 0 : 1;
      if (as !== bs) return as - bs;
      return a.name.localeCompare(b.name, "es");
    });

    const scheduledCount = sorted.filter(e => scheduleForToday(e).enabled).length;
    uiCounts.textContent = `${scheduledCount}/${sorted.length} en turno hoy`;

    employeeList.innerHTML = "";

    for (const emp of sorted) {
      const slot = scheduleForToday(emp);
      const day = calcDay(emp.id, todayKey);

      const horarioTxt = slot.enabled ? `${slot.start}–${slot.end} · pausa ${slot.breakMin}m` : `Fuera de turno`;

      const entradaTxt = day.inTs ? fmtTime(day.inTs) : "—";
      const salidaTxt = day.outTs ? fmtTime(day.outTs) : "—";
      const pausaTxt = fmtHMFromMinutes(minutesFromMs(day.breakMs));
      const trabajadoTxt = fmtHMFromMinutes(minutesFromMs(day.workMs));

      const statusPill =
        day.mode === "in" ? `<span class="pill ok">● Trabajando</span>` :
        day.mode === "break" ? `<span class="pill warn">● Pausa</span>` :
        (day.inTs ? `<span class="pill off">● Fuera</span>` : `<span class="pill off">● Sin fichar</span>`);

      const btnMainLabel =
        day.mode === "out" ? "Fichar entrada" : "Fichar salida";
      const btnMainClass =
        day.mode === "out" ? "btn btn-primary" : "btn btn-primary";

      const btnBreakLabel =
        day.mode === "break" ? "Volver" : "Pausa";
      const breakDisabled = (day.mode === "out");

      const row = document.createElement("div");
      row.className = "emp";
      row.innerHTML = `
        <div class="emp-left">
          <div class="avatar" style="background: linear-gradient(135deg, ${esc(emp.color)}22, rgba(255,255,255,.06)); border-color: ${esc(emp.color)}55">${esc(emp.name.slice(0,1).toUpperCase())}</div>
          <div class="emp-meta">
            <div class="emp-name">${esc(emp.name)}</div>
            <div class="emp-sub">
              ${statusPill}
              <span class="pill">${esc(horarioTxt)}</span>
              <span class="pill">Entrada: <b>${esc(entradaTxt)}</b></span>
              <span class="pill">Salida: <b>${esc(salidaTxt)}</b></span>
              <span class="pill">Pausa: <b>${esc(pausaTxt)}</b></span>
              <span class="pill">Trabajado: <b>${esc(trabajadoTxt)}</b></span>
            </div>
          </div>
        </div>
        <div class="emp-right">
          <button class="${btnMainClass}" data-act="main" data-id="${esc(emp.id)}">${esc(btnMainLabel)}</button>
          <button class="btn btn-ghost" data-act="break" data-id="${esc(emp.id)}" ${breakDisabled ? "disabled":""}>${esc(btnBreakLabel)}</button>
          <button class="iconbtn" data-act="edit" data-id="${esc(emp.id)}" title="Editar" aria-label="Editar">⚙️</button>
        </div>
      `;

      row.addEventListener("click", async (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        const act = t.getAttribute("data-act");
        const id = t.getAttribute("data-id");
        if (!act || !id) return;

        if (act === "edit") {
          await editEmployeeFlow(id);
          return;
        }

        // Nota opcional
        const note = await openModal({
          title: "Nota (opcional)",
          bodyHtml: `
            <label class="field">
              <span>Nota</span>
              <textarea id="noteInput" placeholder="Ej: médico, reunión, incidencias..."></textarea>
              <small class="muted">Puedes dejarlo vacío.</small>
            </label>
          `,
          actions: [
            { label: "Omitir", className: "btn btn-ghost", onClick: () => "" },
            { label: "Guardar", className: "btn btn-primary", onClick: () => $("#noteInput").value.trim() },
          ],
        });

        const n = (note == null) ? "" : String(note);

        if (act === "main") {
          const today = calcDay(id, todayKey);
          if (today.mode === "out") {
            await addEvent(id, "IN", n);
            toast("ok", `${getEmpById(id)?.name || "Empleado"} · Entrada registrada`);
          } else {
            await addEvent(id, "OUT", n);
            toast("ok", `${getEmpById(id)?.name || "Empleado"} · Salida registrada`);
          }
          renderAll();
        }

        if (act === "break") {
          const today = calcDay(id, todayKey);
          if (today.mode === "in") {
            await addEvent(id, "BREAK_START", n);
            toast("warn", `${getEmpById(id)?.name || "Empleado"} · Pausa iniciada`);
          } else if (today.mode === "break") {
            await addEvent(id, "BREAK_END", n);
            toast("ok", `${getEmpById(id)?.name || "Empleado"} · Pausa finalizada`);
          }
          renderAll();
        }
      });

      employeeList.appendChild(row);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Render: Resumen
  // ────────────────────────────────────────────────────────────────────────────
  function renderResumen() {
    const todayKey = dateKeyLocal(new Date());
    summaryTableBody.innerHTML = "";

    for (const emp of state.employees.filter(e => e.active).sort((a,b)=>a.name.localeCompare(b.name,"es"))) {
      const slot = scheduleForToday(emp);
      const day = calcDay(emp.id, todayKey);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><b>${esc(emp.name)}</b></td>
        <td class="small">${esc(slot.enabled ? `${slot.start}–${slot.end} (${slot.breakMin}m)` : "—")}</td>
        <td>${esc(day.inTs ? fmtTime(day.inTs) : "—")}</td>
        <td>${esc(day.outTs ? fmtTime(day.outTs) : "—")}</td>
        <td>${esc(fmtHMFromMinutes(minutesFromMs(day.breakMs)))}</td>
        <td><b>${esc(fmtHMFromMinutes(minutesFromMs(day.workMs)))}</b></td>
        <td>${esc(day.status)}</td>
      `;
      summaryTableBody.appendChild(tr);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Render: Historial
  // ────────────────────────────────────────────────────────────────────────────
  const fEmp = $("#fEmp");
  const fFrom = $("#fFrom");
  const fTo = $("#fTo");

  function renderHistoryFilters() {
    // empleado selector
    fEmp.innerHTML = `<option value="__all__">Todos</option>`;
    for (const e of state.employees.slice().sort((a,b)=>a.name.localeCompare(b.name,"es"))) {
      const opt = document.createElement("option");
      opt.value = e.id;
      opt.textContent = e.name;
      fEmp.appendChild(opt);
    }

    const today = dateKeyLocal(new Date());
    if (!fFrom.value) fFrom.value = today;
    if (!fTo.value) fTo.value = today;
  }

  function renderHistoryTable() {
    const empId = fEmp.value || "__all__";
    const from = (fFrom.value || dateKeyLocal(new Date()));
    const to = (fTo.value || dateKeyLocal(new Date()));

    const fromTs = new Date(from + "T00:00:00").getTime();
    const toTs = new Date(to + "T23:59:59").getTime();

    const rows = state.events
      .filter(ev => (empId === "__all__" || ev.empId === empId))
      .filter(ev => ev.ts >= fromTs && ev.ts <= toTs)
      .sort((a,b)=> b.ts - a.ts)
      .slice(0, 1500);

    eventsTableBody.innerHTML = "";
    for (const ev of rows) {
      const emp = getEmpById(ev.empId);
      const d = new Date(ev.ts);
      const loc = (ev.lat != null && ev.lng != null) ? `${ev.lat},${ev.lng}` : "—";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(dateKeyLocal(d))}</td>
        <td>${esc(fmtTime(ev.ts))}</td>
        <td><b>${esc(emp?.name || ev.empId)}</b></td>
        <td>${esc(typeLabel(ev.type))}</td>
        <td>${esc(ev.note || "")}</td>
        <td class="mono">${esc(loc)}</td>
        <td class="mono">${esc((ev.hash || "").slice(0, 18) + "…")}</td>
      `;
      eventsTableBody.appendChild(tr);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Render: Ajustes (empleados)
  // ────────────────────────────────────────────────────────────────────────────
  function renderEmployeeAdmin() {
    employeeAdminList.innerHTML = "";

    const list = state.employees.slice().sort((a,b)=>a.name.localeCompare(b.name,"es"));
    for (const emp of list) {
      const row = document.createElement("div");
      row.className = "emp";
      row.innerHTML = `
        <div class="emp-left">
          <div class="avatar" style="background: linear-gradient(135deg, ${esc(emp.color)}22, rgba(255,255,255,.06)); border-color: ${esc(emp.color)}55">${esc(emp.name.slice(0,1).toUpperCase())}</div>
          <div class="emp-meta">
            <div class="emp-name">${esc(emp.name)} ${emp.active ? "" : `<span class="pill off">Inactivo</span>`}</div>
            <div class="emp-sub">
              <span class="pill">ID: <span class="mono">${esc(emp.id)}</span></span>
              <span class="pill">Horario semanal editable</span>
            </div>
          </div>
        </div>
        <div class="emp-right">
          <button class="btn btn-ghost" data-act="toggle" data-id="${esc(emp.id)}">${emp.active ? "Desactivar" : "Activar"}</button>
          <button class="btn" data-act="edit" data-id="${esc(emp.id)}">Editar</button>
          <button class="btn btn-danger" data-act="del" data-id="${esc(emp.id)}">Eliminar</button>
        </div>
      `;

      row.addEventListener("click", async (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        const act = t.getAttribute("data-act");
        const id = t.getAttribute("data-id");
        if (!act || !id) return;

        if (act === "toggle") {
          const x = getEmpById(id);
          if (!x) return;
          x.active = !x.active;
          saveState();
          toast("ok", x.active ? "Empleado activado" : "Empleado desactivado");
          renderAll();
          return;
        }

        if (act === "edit") {
          await editEmployeeFlow(id);
          return;
        }

        if (act === "del") {
          const ok = await openModal({
            title: "Eliminar empleado",
            bodyHtml: `<div class="muted">Se eliminará el empleado y <b>sus eventos</b>. ¿Continuar?</div>`,
            actions: [
              { label: "Cancelar", className: "btn btn-ghost", onClick: () => null },
              { label: "Eliminar", className: "btn btn-danger", onClick: () => true },
            ],
          });
          if (!ok) return;

          state.events = state.events.filter(ev => ev.empId !== id);
          state.employees = state.employees.filter(e => e.id !== id);
          saveState();
          toast("ok", "Empleado eliminado");
          renderAll();
        }
      });

      employeeAdminList.appendChild(row);
    }
  }

  async function editEmployeeFlow(empId) {
    const emp = getEmpById(empId);
    if (!emp) return;

    const body = `
      <div class="grid" style="grid-template-columns: 1fr 1fr; gap:12px">
        <label class="field">
          <span>Nombre</span>
          <input id="empName" value="${esc(emp.name)}" />
        </label>
        <label class="field">
          <span>Color</span>
          <input id="empColor" type="color" value="${esc(emp.color)}" />
        </label>
      </div>

      <div style="height:10px"></div>

      <div class="card" style="padding:12px; background: rgba(255,255,255,.04)">
        <div class="card-title" style="margin:0 0 8px">Horario semanal</div>
        <div class="small muted">Activa/desactiva días y define horas.</div>
        <div style="height:8px"></div>

        <div class="list">
          ${DAYS.map(d => {
            const s = emp.schedule[d.key];
            return `
              <div class="card" style="padding:12px; border-radius:16px; background: rgba(255,255,255,.04)">
                <div class="row row-between">
                  <div style="font-weight:900">${esc(d.label)}</div>
                  <label class="toggle" title="En turno">
                    <input type="checkbox" data-sch="${esc(d.key)}" data-k="enabled" ${s.enabled ? "checked":""} />
                    <span class="slider"></span>
                  </label>
                </div>
                <div class="row" style="margin-top:10px">
                  <label class="field" style="flex:1; min-width:160px">
                    <span>Inicio</span>
                    <input type="time" data-sch="${esc(d.key)}" data-k="start" value="${esc(s.start)}" />
                  </label>
                  <label class="field" style="flex:1; min-width:160px">
                    <span>Fin</span>
                    <input type="time" data-sch="${esc(d.key)}" data-k="end" value="${esc(s.end)}" />
                  </label>
                  <label class="field" style="width:160px">
                    <span>Pausa (min)</span>
                    <input type="number" min="0" max="240" data-sch="${esc(d.key)}" data-k="breakMin" value="${esc(s.breakMin)}" />
                  </label>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;

    const res = await openModal({
      title: "Editar empleado",
      bodyHtml: body,
      actions: [
        { label: "Cancelar", className: "btn btn-ghost", onClick: () => null },
        {
          label: "Guardar",
          className: "btn btn-primary",
          onClick: () => {
            const name = $("#empName").value.trim() || "Empleado";
            const color = $("#empColor").value || "#7c5cff";

            emp.name = name;
            emp.color = color;

            $$("[data-sch]").forEach(inp => {
              const dayKey = inp.getAttribute("data-sch");
              const k = inp.getAttribute("data-k");
              if (!emp.schedule[dayKey]) emp.schedule[dayKey] = { enabled: false, start: "09:00", end: "17:00", breakMin: 30 };

              if (k === "enabled") emp.schedule[dayKey].enabled = !!inp.checked;
              if (k === "start") emp.schedule[dayKey].start = inp.value || "09:00";
              if (k === "end") emp.schedule[dayKey].end = inp.value || "17:00";
              if (k === "breakMin") emp.schedule[dayKey].breakMin = clampInt(inp.value, 0, 240);
            });

            saveState();
            toast("ok", "Empleado guardado");
            renderAll();
            return true;
          }
        }
      ]
    });

    return res;
  }

  async function addEmployeeFlow() {
    const temp = { id: uid("emp"), name: "Nuevo empleado", color: "#7c5cff", active: true, schedule: defaultSchedule() };
    state.employees.push(temp);
    saveState();
    await editEmployeeFlow(temp.id);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Export
  // ────────────────────────────────────────────────────────────────────────────
  function downloadFile(filename, text, mime = "text/plain") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function csvEscape(v) {
    const s = String(v ?? "");
    if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function buildResumenCSV() {
    const todayKey = dateKeyLocal(new Date());
    const header = ["fecha","empleado","horario","entrada","salida","pausa_min","trabajado_min","estado"].join(",");
    const lines = [header];

    for (const emp of state.employees.filter(e=>e.active).sort((a,b)=>a.name.localeCompare(b.name,"es"))) {
      const slot = scheduleForToday(emp);
      const day = calcDay(emp.id, todayKey);

      const horario = slot.enabled ? `${slot.start}-${slot.end} pausa ${slot.breakMin}m` : "";
      lines.push([
        todayKey,
        csvEscape(emp.name),
        csvEscape(horario),
        day.inTs ? fmtTime(day.inTs) : "",
        day.outTs ? fmtTime(day.outTs) : "",
        minutesFromMs(day.breakMs),
        minutesFromMs(day.workMs),
        csvEscape(day.status),
      ].join(","));
    }

    return lines.join("\n");
  }

  function buildEventosCSV() {
    const empId = fEmp.value || "__all__";
    const from = (fFrom.value || dateKeyLocal(new Date()));
    const to = (fTo.value || dateKeyLocal(new Date()));

    const fromTs = new Date(from + "T00:00:00").getTime();
    const toTs = new Date(to + "T23:59:59").getTime();

    const header = ["ts_iso","fecha","hora","empleado","tipo","nota","lat","lng","hash","prevHash"].join(",");
    const lines = [header];

    const rows = state.events
      .filter(ev => (empId === "__all__" || ev.empId === empId))
      .filter(ev => ev.ts >= fromTs && ev.ts <= toTs)
      .sort((a,b)=> a.ts - b.ts);

    for (const ev of rows) {
      const emp = getEmpById(ev.empId);
      const d = new Date(ev.ts);
      lines.push([
        csvEscape(d.toISOString()),
        dateKeyLocal(d),
        fmtTime(ev.ts),
        csvEscape(emp?.name || ev.empId),
        csvEscape(typeLabel(ev.type)),
        csvEscape(ev.note || ""),
        (ev.lat ?? ""),
        (ev.lng ?? ""),
        csvEscape(ev.hash || ""),
        csvEscape(ev.prevHash || ""),
      ].join(","));
    }

    return lines.join("\n");
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Backup/Restore/Wipe
  // ────────────────────────────────────────────────────────────────────────────
  const filePicker = $("#filePicker");

  function exportBackup() {
    const data = JSON.stringify(state, null, 2);
    downloadFile(`clockin_backup_${dateKeyLocal(new Date())}.json`, data, "application/json");
  }

  function importBackupFlow() {
    filePicker.value = "";
    filePicker.click();
  }

  filePicker?.addEventListener("change", async () => {
    const f = filePicker.files?.[0];
    if (!f) return;
    const text = await f.text();
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") throw new Error("Formato inválido");
      // Fusiona de forma segura
      state = parsed;
      state = loadStateFromObject(state);
      saveState();
      toast("ok", "Copia importada");
      renderAll();
    } catch {
      toast("bad", "No se pudo importar el JSON");
    }
  });

  function loadStateFromObject(obj) {
    // Reusa la normalización de loadState sin tocar localStorage
    try {
      const raw = JSON.stringify(obj);
      localStorage.setItem("__tmp__", raw);
      const old = localStorage.getItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_KEY, raw);
      const s = loadState();
      // restaura old
      if (old != null) localStorage.setItem(STORAGE_KEY, old);
      else localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("__tmp__");
      return s;
    } catch {
      return defaultState();
    }
  }

  async function wipeAllFlow() {
    const ok1 = await openModal({
      title: "Borrar todo",
      bodyHtml: `<div class="muted">Esto borrará <b>empleados y eventos</b> en este dispositivo.</div>`,
      actions: [
        { label: "Cancelar", className: "btn btn-ghost", onClick: () => null },
        { label: "Continuar", className: "btn btn-danger", onClick: () => true },
      ]
    });
    if (!ok1) return;

    const okPin = await requirePinIfSet();
    if (!okPin) return;

    state = defaultState();
    saveState();
    toast("ok", "Datos borrados");
    renderAll();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Online/Offline badge
  // ────────────────────────────────────────────────────────────────────────────
  function updateOfflineBadge() {
    const offline = !navigator.onLine;
    uiOffline.hidden = !offline;
  }
  window.addEventListener("online", updateOfflineBadge);
  window.addEventListener("offline", updateOfflineBadge);

  // ────────────────────────────────────────────────────────────────────────────
  // PWA SW update pill
  // ────────────────────────────────────────────────────────────────────────────
  const btnUpdate = $("#btnUpdate");
  let waitingWorker = null;

  async function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            waitingWorker = nw;
            btnUpdate.hidden = false;
          }
        });
      });
    } catch {
      // nada
    }
  }

  btnUpdate?.addEventListener("click", async () => {
    if (!waitingWorker) return;
    try {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
      toast("ok", "Actualizando…");
      setTimeout(() => location.reload(), 350);
    } catch {
      location.reload();
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Bind buttons
  // ────────────────────────────────────────────────────────────────────────────
  $("#btnSetPin")?.addEventListener("click", setPinFlow);
  $("#btnClearPin")?.addEventListener("click", clearPinFlow);

  $("#tglGeo")?.addEventListener("change", (e) => {
    state.settings.geoEnabled = !!e.target.checked;
    saveState();
    toast("ok", state.settings.geoEnabled ? "Geolocalización activada" : "Geolocalización desactivada");
  });

  $("#btnAddEmp")?.addEventListener("click", addEmployeeFlow);
  btnQuickAdd?.addEventListener("click", addEmployeeFlow);

  $("#btnExportResumen")?.addEventListener("click", async () => {
    const ok = await requirePinIfSet();
    if (!ok) return;
    const csv = buildResumenCSV();
    downloadFile(`clockin_resumen_${dateKeyLocal(new Date())}.csv`, csv, "text/csv");
    toast("ok", "Resumen exportado");
  });

  $("#btnExportEventos")?.addEventListener("click", async () => {
    const ok = await requirePinIfSet();
    if (!ok) return;
    const csv = buildEventosCSV();
    downloadFile(`clockin_eventos_${dateKeyLocal(new Date())}.csv`, csv, "text/csv");
    toast("ok", "Eventos exportados");
  });

  $("#btnApplyFilters")?.addEventListener("click", () => {
    renderHistoryTable();
    toast("ok", "Filtros aplicados");
  });

  $("#btnBackup")?.addEventListener("click", async () => {
    const ok = await requirePinIfSet();
    if (!ok) return;
    exportBackup();
    toast("ok", "Copia exportada");
  });

  $("#btnRestore")?.addEventListener("click", async () => {
    const ok = await requirePinIfSet();
    if (!ok) return;
    importBackupFlow();
  });

  $("#btnWipe")?.addEventListener("click", wipeAllFlow);

  // ────────────────────────────────────────────────────────────────────────────
  // Render all
  // ────────────────────────────────────────────────────────────────────────────
  function renderAll() {
    uiVer.textContent = APP_VERSION;

    const now = new Date();
    uiDateConsider.textContent = fmtDateHuman(now).replace(/^./, c => c.toUpperCase());

    $("#tglGeo").checked = !!state.settings.geoEnabled;

    renderPanel();
    renderResumen();
    renderHistoryFilters();
    renderHistoryTable();
    renderEmployeeAdmin();

    updateOfflineBadge();
  }

  // init route
  setRoute(getRoute());
  window.addEventListener("hashchange", () => {
    setRoute(getRoute());
    renderAll();
  });

  // Boot
  renderAll();
  registerSW();
})();
