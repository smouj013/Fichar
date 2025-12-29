/*
  app.js — lógica de la aplicación ClockIn
  Desarrollado por Smouj013
*/
(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  const LOAD_GUARD = "__CLOCKIN_APP_LOADED_V1";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch {}

  const STORAGE_KEY = "clockin_state_v1";

  /**
   * @typedef {"IN"|"OUT"|"BREAK_START"|"BREAK_END"|"NOTE"} EventType
   */

  const $ = (id) => document.getElementById(id);

  const el = {
    companyName: $("companyName"),
    employeeName: $("employeeName"),
    statusText: $("statusText"),
    statusMeta: $("statusMeta"),
    timerText: $("timerText"),
    timerHint: $("timerHint"),

    btnIn: $("btnIn"),
    btnOut: $("btnOut"),
    btnBreakStart: $("btnBreakStart"),
    btnBreakEnd: $("btnBreakEnd"),

    noteInput: $("noteInput"),
    btnAddNote: $("btnAddNote"),

    days: $("days"),
    events: $("events"),

    btnExport: $("btnExport"),
    btnExportRaw: $("btnExportRaw"),
    btnClear: $("btnClear"),

    integrityRow: $("integrityRow"),
    integrityText: $("integrityText"),

    btnSettings: $("btnSettings"),
    settingsBackdrop: $("settingsBackdrop"),
    settingsModal: $("settingsModal"),
    btnCloseSettings: $("btnCloseSettings"),
    btnCancelSettings: $("btnCancelSettings"),
    btnSaveSettings: $("btnSaveSettings"),
    inpCompany: $("inpCompany"),
    inpEmployee: $("inpEmployee"),
    chkPin: $("chkPin"),
    inpPin: $("inpPin"),
    chkGeo: $("chkGeo"),

    btnInstall: $("btnInstall"),
  };

  /** Estado */
  const state = loadState();

  let deferredInstallPrompt = null;
  let liveTimerHandle = null;

  // ─────────────────────────────────────────────────────────────
  // Utilidades
  // ─────────────────────────────────────────────────────────────
  const pad2 = (n) => String(n).padStart(2, "0");
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const nowMs = () => Date.now();
  const toISO = (ms) => new Date(ms).toISOString();

  const fmtDate = (ms) => {
    const d = new Date(ms);
    // YYYY-MM-DD local
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const da = pad2(d.getDate());
    return `${y}-${m}-${da}`;
  };

  const fmtTime = (ms) => {
    const d = new Date(ms);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  };

  const fmtHM = (mins) => {
    const m = Math.max(0, mins | 0);
    const h = Math.floor(m / 60);
    const r = m % 60;
    return `${h}h ${pad2(r)}m`;
  };

  const msToHMS = (ms) => {
    const t = Math.max(0, ms | 0);
    const s = Math.floor(t / 1000);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
  };

  const safeText = (v) => (v == null ? "" : String(v));

  // ─────────────────────────────────────────────────────────────
  // Persistencia
  // ─────────────────────────────────────────────────────────────
  function defaultState() {
    return {
      settings: {
        company: "ClockIn",
        employee: "Sin usuario",
        requirePin: false,
        pinSalt: "",
        pinHash: "",
        saveGeo: false,
        deviceId: makeId(),
      },
      events: /** @type {Array<any>} */ ([]),
      integrityOK: true
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const merged = defaultState();
      merged.settings = Object.assign(merged.settings, parsed.settings || {});
      merged.events = Array.isArray(parsed.events) ? parsed.events : [];
      merged.integrityOK = (parsed.integrityOK !== false);
      return merged;
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        settings: state.settings,
        events: state.events,
        integrityOK: state.integrityOK
      }));
    } catch {}
  }

  function makeId() {
    return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }

  // ─────────────────────────────────────────────────────────────
  // Hash chain (integridad “básica”)
  // ─────────────────────────────────────────────────────────────
  async function sha256Hex(str) {
    if (!crypto?.subtle) return "";
    const data = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function computeEventHash(ev) {
    const base = [
      ev.prevHash || "",
      ev.id || "",
      ev.ts || 0,
      ev.type || "",
      ev.note || "",
      ev.meta ? JSON.stringify(ev.meta) : ""
    ].join("|");
    return await sha256Hex(base);
  }

  async function verifyChain() {
    let prev = "";
    for (let i = 0; i < state.events.length; i++) {
      const ev = state.events[i];
      const expected = await computeEventHash({ ...ev, prevHash: prev });
      if (!ev.hash || ev.prevHash !== prev || ev.hash !== expected) {
        state.integrityOK = false;
        saveState();
        return false;
      }
      prev = ev.hash;
    }
    state.integrityOK = true;
    saveState();
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // PIN (PBKDF2)
  // ─────────────────────────────────────────────────────────────
  function randomSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
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

  function hexToBytes(hex) {
    const clean = (hex || "").trim();
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
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
    return hash && (hash === target);
  }

  // ─────────────────────────────────────────────────────────────
  // Estado derivado: OUT / WORKING / BREAK
  // ─────────────────────────────────────────────────────────────
  function getDerivedStatus() {
    const last = state.events[state.events.length - 1];
    if (!last) return { mode: "OUT", since: 0 };

    if (last.type === "OUT") return { mode: "OUT", since: last.ts };
    if (last.type === "IN") return { mode: "WORKING", since: last.ts };
    if (last.type === "BREAK_START") return { mode: "BREAK", since: last.ts };
    if (last.type === "BREAK_END") return { mode: "WORKING", since: last.ts };

    // NOTE no cambia modo: buscar último no-NOTE
    for (let i = state.events.length - 1; i >= 0; i--) {
      const ev = state.events[i];
      if (ev.type !== "NOTE") {
        return getDerivedStatusFrom(ev);
      }
    }
    return { mode: "OUT", since: 0 };
  }

  function getDerivedStatusFrom(ev) {
    if (!ev) return { mode: "OUT", since: 0 };
    if (ev.type === "OUT") return { mode: "OUT", since: ev.ts };
    if (ev.type === "IN") return { mode: "WORKING", since: ev.ts };
    if (ev.type === "BREAK_START") return { mode: "BREAK", since: ev.ts };
    if (ev.type === "BREAK_END") return { mode: "WORKING", since: ev.ts };
    return { mode: "OUT", since: 0 };
  }

  // ─────────────────────────────────────────────────────────────
  // Cálculo de resumen diario
  // ─────────────────────────────────────────────────────────────
  function buildShifts() {
    // Convierte eventos en “turnos” IN->OUT con pausas dentro.
    /** @type {Array<any>} */
    const shifts = [];
    let cur = null;

    for (const ev of state.events) {
      if (ev.type === "NOTE") continue;

      if (ev.type === "IN") {
        // Si hay turno abierto, lo cerramos “virtualmente” antes de abrir otro
        if (cur && !cur.outTs) {
          cur.outTs = ev.ts;
          shifts.push(cur);
        }
        cur = { inTs: ev.ts, outTs: 0, breaks: [], notes: [] };
      } else if (ev.type === "OUT") {
        if (cur && !cur.outTs) {
          cur.outTs = ev.ts;
          shifts.push(cur);
          cur = null;
        } else {
          // OUT sin IN: ignorar
        }
      } else if (ev.type === "BREAK_START") {
        if (cur && !cur.outTs) {
          cur.breaks.push({ start: ev.ts, end: 0 });
        }
      } else if (ev.type === "BREAK_END") {
        if (cur && !cur.outTs) {
          const b = cur.breaks[cur.breaks.length - 1];
          if (b && !b.end) b.end = ev.ts;
        }
      }
    }

    // Turno abierto: mantenlo abierto (para cálculo live)
    if (cur && !cur.outTs) shifts.push(cur);

    // Añadir notas al turno más cercano (simple: nota va al último turno)
    const notes = state.events.filter(e => e.type === "NOTE");
    if (notes.length) {
      const lastShift = shifts[shifts.length - 1];
      if (lastShift) lastShift.notes = notes.map(n => n.note).filter(Boolean);
    }

    return shifts;
  }

  function summarizeByDay(now = nowMs()) {
    const shifts = buildShifts();
    /** @type {Record<string, any>} */
    const days = {};

    for (const s of shifts) {
      const inDay = fmtDate(s.inTs);
      if (!days[inDay]) days[inDay] = { date: inDay, shifts: [], workMin: 0, breakMin: 0 };

      const outTs = s.outTs || now; // turno abierto => ahora
      const totalMin = Math.max(0, Math.floor((outTs - s.inTs) / 60000));

      let breakMin = 0;
      for (const b of s.breaks) {
        const be = b.end || ((b.start && !b.end) ? now : 0);
        if (b.start && be && be >= b.start) {
          breakMin += Math.floor((be - b.start) / 60000);
        }
      }

      const workMin = Math.max(0, totalMin - breakMin);

      days[inDay].shifts.push({
        inTs: s.inTs,
        outTs: s.outTs,
        totalMin,
        breakMin,
        workMin,
        notes: (s.notes || []).slice(0, 4)
      });

      days[inDay].workMin += workMin;
      days[inDay].breakMin += breakMin;
    }

    // Orden por fecha desc
    const list = Object.values(days).sort((a, b) => (a.date < b.date ? 1 : -1));
    return list;
  }

  // ─────────────────────────────────────────────────────────────
  // Registrar evento
  // ─────────────────────────────────────────────────────────────
  async function getGeoIfEnabled() {
    if (!state.settings.saveGeo) return null;
    if (!navigator.geolocation) return null;

    return await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          // Reduce precisión (privacidad): 3 decimales ~ 100m
          const lat = Math.round(pos.coords.latitude * 1000) / 1000;
          const lon = Math.round(pos.coords.longitude * 1000) / 1000;
          resolve({ lat, lon, acc: Math.round(pos.coords.accuracy || 0) });
        },
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 3500, maximumAge: 60000 }
      );
    });
  }

  async function addEvent(type, note = "") {
    const ts = nowMs();
    const prevHash = state.events.length ? (state.events[state.events.length - 1].hash || "") : "";
    const geo = await getGeoIfEnabled();

    const ev = {
      id: makeId(),
      ts,
      type,
      note: safeText(note).slice(0, 120),
      prevHash,
      hash: "",
      meta: {
        deviceId: state.settings.deviceId,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
        ua: navigator.userAgent.slice(0, 120),
        geo: geo || null
      }
    };

    ev.hash = await computeEventHash(ev);

    state.events.push(ev);
    saveState();
    await verifyChain();
    renderAll();
  }

  // ─────────────────────────────────────────────────────────────
  // Acciones (lógica “fichar”)
  // ─────────────────────────────────────────────────────────────
  async function doIn() {
    const s = getDerivedStatus();
    if (s.mode !== "OUT") return;
    await addEvent("IN", el.noteInput.value.trim());
    el.noteInput.value = "";
  }

  async function doOut() {
    const s = getDerivedStatus();
    if (s.mode === "OUT") return;
    // Si está en pausa, primero cerramos pausa
    if (s.mode === "BREAK") await addEvent("BREAK_END", "Auto-cierre pausa");
    await addEvent("OUT", el.noteInput.value.trim());
    el.noteInput.value = "";
  }

  async function doBreakStart() {
    const s = getDerivedStatus();
    if (s.mode !== "WORKING") return;
    await addEvent("BREAK_START", el.noteInput.value.trim());
    el.noteInput.value = "";
  }

  async function doBreakEnd() {
    const s = getDerivedStatus();
    if (s.mode !== "BREAK") return;
    await addEvent("BREAK_END", el.noteInput.value.trim());
    el.noteInput.value = "";
  }

  async function addNoteToLast() {
    const note = el.noteInput.value.trim();
    if (!note) return;
    await addEvent("NOTE", note);
    el.noteInput.value = "";
  }

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  function setButtonsByStatus() {
    const s = getDerivedStatus();
    const out = (s.mode === "OUT");
    const working = (s.mode === "WORKING");
    const brk = (s.mode === "BREAK");

    el.btnIn.disabled = !out;
    el.btnOut.disabled = out;

    el.btnBreakStart.disabled = !working;
    el.btnBreakEnd.disabled = !brk;
  }

  function renderHeader() {
    el.companyName.textContent = state.settings.company || "ClockIn";
    el.employeeName.textContent = state.settings.employee || "Sin usuario";
  }

  function renderStatus(now = nowMs()) {
    const s = getDerivedStatus();
    let label = "—";
    let meta = "—";
    let hint = "—";

    if (s.mode === "OUT") {
      label = "Fuera";
      if (s.since) meta = `Última salida: ${fmtDate(s.since)} ${fmtTime(s.since)}`;
      hint = "Pulsa Entrar para iniciar turno";
    } else if (s.mode === "WORKING") {
      label = "Trabajando";
      meta = `Desde: ${fmtDate(s.since)} ${fmtTime(s.since)}`;
      hint = "Pausa para descansar / Salir para terminar";
    } else if (s.mode === "BREAK") {
      label = "En pausa";
      meta = `Desde: ${fmtDate(s.since)} ${fmtTime(s.since)}`;
      hint = "Pulsa Volver para retomar";
    }

    el.statusText.textContent = label;
    el.statusMeta.textContent = meta;

    // Timer: si trabajando o pausa => elapsed desde since
    if (s.mode === "OUT" || !s.since) {
      el.timerText.textContent = "00:00:00";
      el.timerHint.textContent = hint;
    } else {
      el.timerText.textContent = msToHMS(now - s.since);
      el.timerHint.textContent = hint;
    }
  }

  function renderIntegrity() {
    if (state.integrityOK) {
      el.integrityRow.hidden = true;
      return;
    }
    el.integrityRow.hidden = false;
    el.integrityText.textContent = "Se detectó una inconsistencia. Si editaste el storage o hubo un fallo, exporta y reinicia.";
  }

  function renderDays(now = nowMs()) {
    const list = summarizeByDay(now);
    if (!list.length) {
      el.days.innerHTML = `<div class="day"><div class="dayTop"><div class="dayDate">Sin datos</div><div class="dayStats">Aún no has fichado.</div></div></div>`;
      return;
    }

    el.days.innerHTML = list.map(day => {
      const lines = day.shifts.map((s, idx) => {
        const outTxt = s.outTs ? `${fmtTime(s.outTs)}` : "— (en curso)";
        const notes = (s.notes && s.notes.length) ? ` · Notas: ${s.notes.join(" | ")}` : "";
        return `
          <div class="line">
            <div><b>Turno ${idx + 1}</b> · ${fmtTime(s.inTs)} → ${outTxt}</div>
            <div>Trabajo: <b>${fmtHM(s.workMin)}</b> · Pausa: ${fmtHM(s.breakMin)}${notes}</div>
          </div>
        `;
      }).join("");

      return `
        <div class="day">
          <div class="dayTop">
            <div class="dayDate">${day.date}</div>
            <div class="dayStats">Total trabajo: <b>${fmtHM(day.workMin)}</b> · Total pausas: ${fmtHM(day.breakMin)}</div>
          </div>
          <div class="dayLines">${lines}</div>
        </div>
      `;
    }).join("");
  }

  function typeLabel(t) {
    if (t === "IN") return "✅ ENTRADA";
    if (t === "OUT") return "⛔ SALIDA";
    if (t === "BREAK_START") return "⏸️ PAUSA";
    if (t === "BREAK_END") return "▶️ VUELTA";
    if (t === "NOTE") return "📝 NOTA";
    return t;
  }

  function renderEvents() {
    const evs = state.events.slice().reverse();
    if (!evs.length) {
      el.events.innerHTML = `<div class="event"><div class="eventLeft"><div class="eventType">Sin eventos</div><div class="eventMeta">—</div></div></div>`;
      return;
    }

    el.events.innerHTML = evs.map(ev => {
      const meta = `${fmtDate(ev.ts)} ${fmtTime(ev.ts)} · ${ev.meta?.tz || "local"}`;
      const note = ev.note ? `<div class="eventNote">${escapeHtml(ev.note)}</div>` : "";
      const geo = ev.meta?.geo ? ` · 📍 ${ev.meta.geo.lat},${ev.meta.geo.lon}` : "";
      return `
        <div class="event">
          <div class="eventLeft">
            <div class="eventType">${typeLabel(ev.type)}</div>
            <div class="eventMeta">${meta}${geo}</div>
            ${note}
          </div>
          <div class="eventRight">
            <span class="badge">${ev.hash ? ("#" + ev.hash.slice(0, 8)) : "sin hash"}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderAll() {
    renderHeader();
    renderIntegrity();
    renderStatus(nowMs());
    setButtonsByStatus();
    renderDays(nowMs());
    renderEvents();
  }

  function startLiveTimer() {
    if (liveTimerHandle) clearInterval(liveTimerHandle);
    liveTimerHandle = setInterval(() => {
      renderStatus(nowMs());
      renderDays(nowMs()); // para turnos en curso
      setButtonsByStatus();
    }, 500);
  }

  // ─────────────────────────────────────────────────────────────
  // Export CSV
  // ─────────────────────────────────────────────────────────────
  function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function csvEscape(v) {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  }

  async function exportSummaryCSV() {
    if (!(await ensurePinAllowed())) return;

    const now = nowMs();
    const days = summarizeByDay(now);

    const header = ["fecha", "turno", "entrada", "salida", "pausa_min", "trabajo_min", "notas"].join(",");
    const rows = [header];

    for (const d of days.slice().reverse()) { // ascendente
      d.shifts.forEach((s, i) => {
        rows.push([
          d.date,
          String(i + 1),
          fmtTime(s.inTs),
          s.outTs ? fmtTime(s.outTs) : "",
          String(s.breakMin),
          String(s.workMin),
          (s.notes || []).join(" | ")
        ].map(csvEscape).join(","));
      });
    }

    const name = (state.settings.employee || "empleado").replaceAll(" ", "_");
    downloadText(`clockin_resumen_${name}.csv`, rows.join("\n"), "text/csv;charset=utf-8");
  }

  async function exportRawCSV() {
    if (!(await ensurePinAllowed())) return;

    const header = ["ts_iso", "fecha", "hora", "tipo", "nota", "hash", "prevHash", "tz", "geo"].join(",");
    const rows = [header];

    for (const ev of state.events) {
      const iso = toISO(ev.ts);
      const geo = ev.meta?.geo ? `${ev.meta.geo.lat},${ev.meta.geo.lon}` : "";
      rows.push([
        iso,
        fmtDate(ev.ts),
        fmtTime(ev.ts),
        ev.type,
        ev.note || "",
        ev.hash || "",
        ev.prevHash || "",
        ev.meta?.tz || "",
        geo
      ].map(csvEscape).join(","));
    }

    const name = (state.settings.employee || "empleado").replaceAll(" ", "_");
    downloadText(`clockin_eventos_${name}.csv`, rows.join("\n"), "text/csv;charset=utf-8");
  }

  // ─────────────────────────────────────────────────────────────
  // Ajustes modal
  // ─────────────────────────────────────────────────────────────
  function openSettings() {
    el.inpCompany.value = state.settings.company || "";
    el.inpEmployee.value = state.settings.employee || "";
    el.chkPin.checked = !!state.settings.requirePin;
    el.inpPin.value = "";
    el.chkGeo.checked = !!state.settings.saveGeo;

    el.settingsBackdrop.hidden = false;
    el.settingsModal.hidden = false;
  }

  function closeSettings() {
    el.settingsBackdrop.hidden = true;
    el.settingsModal.hidden = true;
  }

  async function saveSettingsFromUI() {
    const company = el.inpCompany.value.trim().slice(0, 40) || "ClockIn";
    const employee = el.inpEmployee.value.trim().slice(0, 40) || "Sin usuario";
    const requirePin = !!el.chkPin.checked;
    const saveGeo = !!el.chkGeo.checked;

    state.settings.company = company;
    state.settings.employee = employee;
    state.settings.requirePin = requirePin;
    state.settings.saveGeo = saveGeo;

    // Si PIN activado y han escrito uno nuevo, lo guardamos
    const newPin = el.inpPin.value.trim();
    if (requirePin) {
      if (newPin.length >= 4 && newPin.length <= 10 && /^\d+$/.test(newPin)) {
        const salt = randomSalt();
        const hash = await pbkdf2Hex(newPin, salt);
        state.settings.pinSalt = salt;
        state.settings.pinHash = hash;
      } else if (!state.settings.pinHash) {
        alert("Activas PIN, pero no has puesto un PIN válido (4–10 dígitos).”);
        return;
      }
    } else {
      // PIN desactivado => borramos
      state.settings.pinSalt = "";
      state.settings.pinHash = "";
    }

    saveState();
    closeSettings();
    renderAll();
  }

  // ─────────────────────────────────────────────────────────────
  // Borrado
  // ─────────────────────────────────────────────────────────────
  async function clearAll() {
    if (!(await ensurePinAllowed())) return;
    const ok = confirm("¿Seguro que quieres borrar TODO el historial?");
    if (!ok) return;

    state.events = [];
    state.integrityOK = true;
    saveState();
    renderAll();
  }

  // ─────────────────────────────────────────────────────────────
  // PWA install prompt + SW
  // ─────────────────────────────────────────────────────────────
  function setupPWA() {
    // Service worker
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

  // ─────────────────────────────────────────────────────────────
  // Bindings
  // ─────────────────────────────────────────────────────────────
  function bindUI() {
    el.btnIn.addEventListener("click", doIn);
    el.btnOut.addEventListener("click", doOut);
    el.btnBreakStart.addEventListener("click", doBreakStart);
    el.btnBreakEnd.addEventListener("click", doBreakEnd);

    el.btnAddNote.addEventListener("click", addNoteToLast);

    el.btnExport.addEventListener("click", exportSummaryCSV);
    el.btnExportRaw.addEventListener("click", exportRawCSV);

    el.btnClear.addEventListener("click", clearAll);

    el.btnSettings.addEventListener("click", openSettings);
    el.btnCloseSettings.addEventListener("click", closeSettings);
    el.btnCancelSettings.addEventListener("click", closeSettings);
    el.settingsBackdrop.addEventListener("click", closeSettings);

    el.btnSaveSettings.addEventListener("click", saveSettingsFromUI);

    // Atajos
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSettings();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        exportSummaryCSV();
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Boot
  // ─────────────────────────────────────────────────────────────
  (async function boot() {
    bindUI();
    setupPWA();

    // Verifica cadena si hay crypto
    await verifyChain();

    renderAll();
    startLiveTimer();
  })();

})();