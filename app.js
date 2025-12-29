/* app.js — ClockIn v2.0.4 (STABLE + UI PRO + PWA + INSTALL + AUTO-UPDATE)
   ✅ Compat con tu index.html v2.0.3 (IDs/estructura) y styles.css v2.0.4
   ✅ Fixes clave:
   - Splash: NO bloquea nunca (pointer-events none + hidden+display none)
   - Modal: hardHide seguro + evita “modal colgado”
   - Routing: evita parpadeos/stack, anima solo el view activo
   - Schedule editor: inputs type="time" con layout responsive sin depender de grid fijo
   - Historial: paginación robusta + filtros estables
   - Restore: normaliza schema + asegura schedule + settings + pin
   - SW update: anti-loop + updatefound/waiting correctos
*/

(() => {
  "use strict";

  // ───────────────────────── Version / Guard ─────────────────────────
  const APP_VERSION = String((typeof window !== "undefined" && window.APP_VERSION) || "2.0.4");
  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  const LOAD_GUARD = "__CLOCKIN_APPJS_LOADED_V204";
  try { if (g && g[LOAD_GUARD]) return; if (g) g[LOAD_GUARD] = true; } catch (_) {}

  // ───────────────────────── Storage ─────────────────────────
  const STORAGE_KEY = "clockin_state_v2";
  const LEGACY_KEYS = ["clockin_state_v1", "clockin_state_v1_0", "clockin_state_v1.0.0"];

  // Días semana (ISO-like)
  const DOW_KEYS = ["mon","tue","wed","thu","fri","sat","sun"];
  const DOW_LABEL = { mon:"Lun", tue:"Mar", wed:"Mié", thu:"Jue", fri:"Vie", sat:"Sáb", sun:"Dom" };

  // Tipos de evento
  const EVT = {
    IN: "IN",
    OUT: "OUT",
    BREAK_START: "BREAK_START",
    BREAK_END: "BREAK_END",
  };

  // ───────────────────────── DOM helpers ─────────────────────────
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const el = (tag, cls) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  };

  const clamp = (v,a,b)=>Math.max(a, Math.min(b, v));
  const pad2 = (n)=> String(n).padStart(2,"0");

  function safeJsonParse(s, fallback=null){
    try { return JSON.parse(s); } catch(_) { return fallback; }
  }

  function nowMs(){ return Date.now(); }

  function toISODate(d){
    const y = d.getFullYear();
    const m = pad2(d.getMonth()+1);
    const day = pad2(d.getDate());
    return `${y}-${m}-${day}`;
  }

  function fromISODate(s){
    const [y,m,d] = (s||"").split("-").map(x=>parseInt(x,10));
    if (!y || !m || !d) return null;
    const dt = new Date(y, m-1, d, 12, 0, 0, 0);
    return Number.isFinite(dt.getTime()) ? dt : null;
  }

  function fmtDateLong(d){
    try {
      return new Intl.DateTimeFormat("es-ES", { weekday:"long", year:"numeric", month:"long", day:"2-digit" }).format(d);
    } catch(_) {
      return d.toLocaleDateString();
    }
  }

  function fmtTime(d){
    try {
      return new Intl.DateTimeFormat("es-ES", { hour:"2-digit", minute:"2-digit" }).format(d);
    } catch(_) {
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }
  }

  function fmtHMFromMinutes(mins){
    mins = Math.max(0, mins|0);
    const h = Math.floor(mins/60);
    const m = mins%60;
    return `${pad2(h)}:${pad2(m)}`;
  }

  function parseHHMM(s){
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s||"").trim());
    if (!m) return null;
    const hh = clamp(parseInt(m[1],10), 0, 23);
    const mm = clamp(parseInt(m[2],10), 0, 59);
    return { hh, mm };
  }

  function minutesBetween(aMs, bMs){
    return Math.max(0, Math.round((bMs - aMs) / 60000));
  }

  function isSameISODate(ts, iso){
    const d = new Date(ts);
    return toISODate(d) === iso;
  }

  // Hash corto (FNV-1a 32-bit)
  function fnv1a(str){
    let h = 0x811c9dc5;
    for (let i=0;i<str.length;i++){
      h ^= str.charCodeAt(i);
      h = (h + ((h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  function uid(){
    try { return crypto.randomUUID(); } catch(_) {
      return "id-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
    }
  }

  function downloadText(filename, text, mime="text/plain;charset=utf-8"){
    const blob = new Blob([text], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 250);
  }

  function csvEscape(v){
    const s = String(v ?? "");
    if (/[,"\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  }

  // ───────────────────────── State schema ─────────────────────────
  function defaultSchedule(){
    const s = {};
    for (const k of DOW_KEYS) s[k] = { enabled: false, start: "09:00", end: "17:00" };
    for (const k of ["mon","tue","wed","thu","fri"]) s[k].enabled = true;
    return s;
  }

  function defaultState(){
    return {
      schema: 2,
      version: APP_VERSION,
      createdAt: nowMs(),
      updatedAt: nowMs(),
      settings: {
        theme: "system",          // system|dark|light
        autoUpdate: true,
        confirmActions: true,
        noteMode: "ask",          // ask|never
        compact: false,
        haptics: true,
        geoEnabled: false,
        pin: {
          enabled: false,
          salt: "",
          hash: "",
          lastOkAt: 0
        }
      },
      employees: [],
      events: []
    };
  }

  function normalizeSchedule(s){
    const out = defaultSchedule();
    for (const k of DOW_KEYS){
      const d = s && s[k];
      if (!d) continue;
      out[k] = {
        enabled: !!d.enabled,
        start: typeof d.start === "string" ? d.start : out[k].start,
        end: typeof d.end === "string" ? d.end : out[k].end
      };
    }
    return out;
  }

  function normalizeState(parsed){
    const base = defaultState();
    const st = Object.assign(base, parsed || {});
    st.schema = 2;
    st.version = APP_VERSION;

    st.settings = Object.assign(base.settings, (parsed && parsed.settings) || {});
    st.settings.pin = Object.assign(base.settings.pin, (parsed && parsed.settings && parsed.settings.pin) || {});

    st.employees = Array.isArray(parsed && parsed.employees)
      ? parsed.employees.map(e => ({
          id: String(e.id || uid()),
          name: String(e.name || "Empleado"),
          schedule: (e.schedule && typeof e.schedule === "object") ? normalizeSchedule(e.schedule) : defaultSchedule()
        }))
      : [];

    st.events = Array.isArray(parsed && parsed.events)
      ? parsed.events.map(ev => ({
          id: String(ev.id || uid()),
          ts: Number(ev.ts || nowMs()),
          empId: String(ev.empId || ""),
          type: String(ev.type || EVT.IN),
          note: typeof ev.note === "string" ? ev.note : "",
          geo: (ev && ev.geo) ? ev.geo : null,
          hash: String(ev.hash || fnv1a(String(ev.id||"") + "|" + String(ev.ts||"") + "|" + String(ev.empId||"") + "|" + String(ev.type||"")))
        })).filter(x => x.empId && Number.isFinite(x.ts))
      : [];

    st.updatedAt = nowMs();
    return st;
  }

  function migrateLegacyIfNeeded(){
    for (const k of LEGACY_KEYS){
      const raw = localStorage.getItem(k);
      if (!raw) continue;

      if (!localStorage.getItem(STORAGE_KEY)){
        const old = safeJsonParse(raw, null);
        if (old && typeof old === "object"){
          const st = normalizeState(old);
          saveState(st);
        }
      }

      try { localStorage.removeItem(k); } catch (_) {}
    }
  }

  function loadState(){
    migrateLegacyIfNeeded();
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? safeJsonParse(raw, null) : null;
    if (!parsed || typeof parsed !== "object") return defaultState();
    return normalizeState(parsed);
  }

  function saveState(st){
    st.updatedAt = nowMs();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(st)); }
    catch(e){
      toast("error", "No se pudo guardar", "El almacenamiento del navegador está lleno o bloqueado.");
      console.error(e);
    }
  }

  // ───────────────────────── UI: Toasts / Modal ─────────────────────────
  const toasts = $("#toasts");
  function toast(kind, msg, sub){
    if (!toasts) return;

    const t = el("div", "toast");
    const ic = el("span", "ms");
    ic.textContent =
      kind === "ok" ? "check_circle" :
      kind === "warn" ? "warning" :
      kind === "error" ? "error" : "info";

    const body = el("div");
    const m = el("div");
    m.style.fontWeight = "900";
    m.style.marginBottom = sub ? "4px" : "0";
    m.textContent = msg || "";
    body.appendChild(m);

    if (sub){
      const s = el("div", "muted");
      s.style.fontSize = "12px";
      s.textContent = sub || "";
      body.appendChild(s);
    }

    t.appendChild(ic);
    t.appendChild(body);
    toasts.appendChild(t);

    setTimeout(() => { try { t.remove(); } catch(_) {} }, 4200);
  }

  const modalBackdrop = $("#modalBackdrop");
  const modalTitle = $("#modalTitle");
  const modalBody = $("#modalBody");
  const modalActions = $("#modalActions");
  const modalClose = $("#modalClose");

  let modalResolve = null;

  function hardHideBackdrop(){
    if (!modalBackdrop) return;
    modalBackdrop.hidden = true;
    modalBackdrop.style.display = "none";
    modalBackdrop.classList.remove("is-open");
    document.body.classList.remove("modal-open");
  }

  function closeModal(){
    if (!modalBackdrop) return;

    modalBackdrop.classList.remove("is-open");
    setTimeout(() => {
      modalBackdrop.hidden = true;
      modalBackdrop.style.display = "none";
      document.body.classList.remove("modal-open");

      if (modalTitle) modalTitle.textContent = "—";
      if (modalBody) modalBody.innerHTML = "";
      if (modalActions) modalActions.innerHTML = "";

      if (typeof modalResolve === "function") {
        modalResolve(null);
        modalResolve = null;
      }
    }, 120);
  }

  function openModal({ title, contentNode, actions=[] }){
    if (!modalBackdrop) return Promise.resolve(null);

    modalBackdrop.style.display = "grid";
    modalBackdrop.hidden = false;

    requestAnimationFrame(() => modalBackdrop.classList.add("is-open"));
    document.body.classList.add("modal-open");

    if (modalTitle) modalTitle.textContent = title || "";
    if (modalBody){
      modalBody.innerHTML = "";
      if (contentNode) modalBody.appendChild(contentNode);
    }
    if (modalActions){
      modalActions.innerHTML = "";
      for (const a of actions) modalActions.appendChild(a);
    }

    return new Promise((resolve) => { modalResolve = resolve; });
  }

  function btnIcon(label, iconName, cls, onClick){
    const b = el("button", cls || "btn");
    b.type = "button";
    const ic = el("span", "ms");
    ic.textContent = iconName;
    b.appendChild(ic);
    b.appendChild(document.createTextNode(" " + label));
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }

  function confirmDialog(title, message, yesLabel="Confirmar", noLabel="Cancelar"){
    const wrap = el("div");
    const p = el("div", "muted");
    p.style.lineHeight = "1.55";
    p.textContent = message || "";
    wrap.appendChild(p);

    const yes = btnIcon(yesLabel, "check", "btn btn-primary", () => {
      const r = modalResolve; modalResolve = null;
      closeModal();
      if (r) r(true);
    });
    const no = btnIcon(noLabel, "close", "btn btn-ghost", () => {
      const r = modalResolve; modalResolve = null;
      closeModal();
      if (r) r(false);
    });

    return openModal({ title, contentNode: wrap, actions: [no, yes] });
  }

  // ───────────────────────── PIN hashing (WebCrypto) ─────────────────────────
  async function sha256Hex(str){
    const enc = new TextEncoder();
    const data = enc.encode(str);
    const buf = await crypto.subtle.digest("SHA-256", data);
    const arr = Array.from(new Uint8Array(buf));
    return arr.map(b=>b.toString(16).padStart(2,"0")).join("");
  }

  async function ensurePinOk(st, purposeLabel){
    const pin = st.settings.pin;
    if (!pin || !pin.enabled) return true;

    const SESSION_MS = 10 * 60 * 1000;
    if (pin.lastOkAt && (nowMs() - pin.lastOkAt) < SESSION_MS) return true;

    const wrap = el("div");
    const p = el("div", "muted");
    p.style.lineHeight = "1.55";
    p.textContent = `Introduce el PIN para ${purposeLabel || "continuar"}.`;

    const field = el("label", "field");
    const span = el("span"); span.textContent = "PIN";
    const input = document.createElement("input");
    input.type = "password";
    input.inputMode = "numeric";
    input.autocomplete = "one-time-code";
    input.placeholder = "••••";

    field.appendChild(span);
    field.appendChild(input);

    wrap.appendChild(p);
    wrap.appendChild(el("div")).style.height = "8px";
    wrap.appendChild(field);

    const ok = btnIcon("Verificar", "lock", "btn btn-primary", async () => {
      const val = String(input.value || "").trim();
      if (val.length < 3) { toast("warn","PIN demasiado corto"); return; }

      try{
        const h = await sha256Hex(pin.salt + "|" + val);
        if (h !== pin.hash){
          toast("error","PIN incorrecto");
          input.value = "";
          input.focus();
          return;
        }

        st.settings.pin.lastOkAt = nowMs();
        saveState(st);

        const r = modalResolve; modalResolve = null;
        closeModal();
        if (r) r(true);
      }catch(e){
        toast("error","No se pudo verificar");
        console.error(e);
      }
    });

    const cancel = btnIcon("Cancelar", "close", "btn btn-ghost", () => {
      const r = modalResolve; modalResolve = null;
      closeModal();
      if (r) r(false);
    });

    setTimeout(() => { try { input.focus(); } catch(_) {} }, 60);
    const res = await openModal({ title:"PIN requerido", contentNode: wrap, actions:[cancel, ok] });
    return !!res;
  }

  // ───────────────────────── Detect device / mode + Install ─────────────────────────
  function isStandalone(){
    try{
      if (typeof navigator !== "undefined" && "standalone" in navigator && navigator.standalone) return true;
      return window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    }catch(_){ return false; }
  }

  function detectMode(){
    const ua = navigator.userAgent || "";
    const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
    const isMobileUA = /Android|iPhone|iPad|iPod/i.test(ua);
    const standalone = isStandalone();

    let label = standalone ? "App" : ((isMobileUA || isTouch) ? "Móvil" : "Desktop");
    const isOpera = /OPR\//.test(ua) || /Opera/.test(ua);
    if (!standalone && isOpera) label += " (Opera)";

    document.body.classList.toggle("is-standalone", !!standalone);
    document.body.classList.toggle("is-mobile", !!(isMobileUA || isTouch));
    document.body.classList.toggle("is-desktop", !(isMobileUA || isTouch));

    const uiMode = $("#uiMode");
    if (uiMode) uiMode.textContent = label;

    return { standalone, isTouch, isMobileUA, label };
  }

  // Install button (Chromium)
  const btnInstall = $("#btnInstall");
  let deferredInstallPrompt = null;

  function setupInstallButton(){
    if (!btnInstall) return;

    if (isStandalone()) {
      btnInstall.hidden = true;
      return;
    }

    btnInstall.hidden = true;

    window.addEventListener("beforeinstallprompt", (e) => {
      try{
        e.preventDefault();
        deferredInstallPrompt = e;
        btnInstall.hidden = false;
      }catch(_){}
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      btnInstall.hidden = true;
      detectMode();
      toast("ok", "App instalada", "ClockIn ya está disponible como aplicación.");
    });

    btnInstall.addEventListener("click", async () => {
      try{
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        btnInstall.hidden = true;
      }catch(_){}
    });
  }

  // ───────────────────────── Service Worker / Auto-update ─────────────────────────
  const btnUpdate = $("#btnUpdate");
  let swReg = null;
  let swWaiting = null;

  const RELOAD_GUARD_KEY = "clockin_reload_guard_v1";

  function markReloadGuard(){
    try { localStorage.setItem(RELOAD_GUARD_KEY, String(nowMs())); } catch(_) {}
  }
  function canReloadNow(){
    try{
      const t = Number(localStorage.getItem(RELOAD_GUARD_KEY) || 0);
      return (nowMs() - t) > 3000;
    }catch(_){ return true; }
  }

  async function registerSW(st){
    if (!("serviceWorker" in navigator)) return;

    try{
      swReg = await navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" });
    }catch(e){
      console.warn("SW register failed:", e);
      return;
    }

    // Si al cargar ya hay waiting
    if (swReg.waiting && navigator.serviceWorker.controller){
      swWaiting = swReg.waiting;
      showUpdatePill(st, true);
      if (st.settings.autoUpdate) applyUpdateNow(st);
    }

    swReg.addEventListener("updatefound", () => {
      const installing = swReg.installing;
      if (!installing) return;

      installing.addEventListener("statechange", () => {
        if (installing.state === "installed"){
          if (navigator.serviceWorker.controller){
            swWaiting = swReg.waiting || installing;
            showUpdatePill(st, true);
            if (st.settings.autoUpdate) applyUpdateNow(st);
          }
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!canReloadNow()) return;
      markReloadGuard();
      location.reload();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") swReg?.update().catch(()=>{});
    });

    setInterval(() => { swReg?.update().catch(()=>{}); }, 60 * 60 * 1000);
  }

  function showUpdatePill(st, show){
    if (!btnUpdate) return;
    btnUpdate.hidden = !show;
    if (!show) return;

    btnUpdate.onclick = async () => {
      if (st.settings.confirmActions){
        const ok = await confirmDialog("Actualizar", "Hay una actualización lista. ¿Aplicarla ahora?", "Actualizar", "Más tarde");
        if (!ok) return;
      }
      applyUpdateNow(st);
    };
  }

  function applyUpdateNow(st){
    const w = swWaiting || swReg?.waiting;
    if (!w) return;
    try{
      w.postMessage({ type: "SKIP_WAITING" });
      toast("info", "Aplicando update…", "En unos segundos se recargará la app.");
    }catch(e){
      console.warn(e);
      toast("warn", "No se pudo aplicar", "Prueba recargar o usar Repair si se atasca.");
    }
  }

  // ───────────────────────── Geolocation (opcional) ─────────────────────────
  async function getGeoIfEnabled(st){
    if (!st.settings.geoEnabled) return null;
    if (!("geolocation" in navigator)) return null;

    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; resolve(v); };

      const opt = { enableHighAccuracy: false, timeout: 5000, maximumAge: 120000 };
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = pos.coords;
          finish({ lat: Number(c.latitude), lon: Number(c.longitude), acc: Number(c.accuracy || 0) });
        },
        () => finish(null),
        opt
      );

      setTimeout(() => finish(null), 5200);
    });
  }

  // ───────────────────────── Business logic ─────────────────────────
  function getEmployeeById(st, id){
    return st.employees.find(e => e.id === id) || null;
  }

  function todaysDOWKey(d){
    const js = d.getDay(); // 0=Sun
    const map = { 0:"sun", 1:"mon", 2:"tue", 3:"wed", 4:"thu", 5:"fri", 6:"sat" };
    return map[js];
  }

  function getScheduleForDate(emp, isoDate){
    const d = fromISODate(isoDate) || new Date();
    const k = todaysDOWKey(d);
    const s = (emp && emp.schedule && emp.schedule[k]) ? emp.schedule[k] : null;
    if (!s || !s.enabled) return null;
    return s;
  }

  function getEventsForEmpOnDate(st, empId, isoDate){
    const arr = st.events.filter(ev => ev.empId === empId && isSameISODate(ev.ts, isoDate));
    arr.sort((a,b) => a.ts - b.ts);
    return arr;
  }

  function deriveDayStats(events, isoDate){
    let inAt = null;
    let outAt = null;
    let breakStart = null;
    let breakMins = 0;

    for (const ev of events){
      if (ev.type === EVT.IN) inAt = ev.ts;
      if (ev.type === EVT.OUT) outAt = ev.ts;
      if (ev.type === EVT.BREAK_START) breakStart = ev.ts;
      if (ev.type === EVT.BREAK_END){
        if (breakStart) breakMins += minutesBetween(breakStart, ev.ts);
        breakStart = null;
      }
    }

    const today = toISODate(new Date());
    const isToday = isoDate === today;
    const endRef = isToday ? nowMs() : (outAt || null);

    if (breakStart && endRef){
      breakMins += minutesBetween(breakStart, endRef);
    }

    let workedMins = 0;
    if (inAt){
      const end = outAt || (isToday ? nowMs() : null);
      if (end) workedMins = Math.max(0, minutesBetween(inAt, end) - breakMins);
    }

    let status = "Fuera";
    if (inAt && !outAt) status = breakStart ? "En pausa" : "Dentro";
    if (inAt && outAt) status = "Cerrado";

    return {
      inAt, outAt, breakMins, workedMins,
      breakOpen: !!breakStart && !outAt,
      isInside: !!inAt && !outAt,
      status
    };
  }

  async function addEvent(st, empId, type, note){
    const ev = {
      id: uid(),
      ts: nowMs(),
      empId,
      type,
      note: String(note || ""),
      geo: await getGeoIfEnabled(st),
      hash: ""
    };
    ev.hash = fnv1a(ev.id + "|" + ev.ts + "|" + ev.empId + "|" + ev.type);
    st.events.push(ev);
    saveState(st);
    return ev;
  }

  function haptic(st){
    if (!st.settings.haptics) return;
    try { navigator.vibrate && navigator.vibrate(12); } catch(_) {}
  }

  // ───────────────────────── Render refs ─────────────────────────
  const splash = $("#splash");
  const splashMsg = $("#splashMsg");
  const splashVer = $("#splashVer");

  const uiDate = $("#uiDate");
  const uiCounts = $("#uiCounts");
  const uiOffline = $("#uiOffline");
  const uiVer = $("#uiVer");

  const employeeList = $("#employeeList");
  const employeeAdminList = $("#employeeAdminList");

  const sumDate = $("#sumDate");
  const btnSumPrev = $("#btnSumPrev");
  const btnSumNext = $("#btnSumNext");
  const btnExportResumen = $("#btnExportResumen");
  const summaryTable = $("#summaryTable");
  const uiSummaryMeta = $("#uiSummaryMeta");

  const eventsTable = $("#eventsTable");
  const btnExportEventos = $("#btnExportEventos");
  const fEmp = $("#fEmp");
  const fFrom = $("#fFrom");
  const fTo = $("#fTo");
  const btnApplyFilters = $("#btnApplyFilters");
  const btnClearFilters = $("#btnClearFilters");
  const btnLoadMore = $("#btnLoadMore");
  const uiEventCount = $("#uiEventCount");

  const btnQuickAdd = $("#btnQuickAdd");
  const fabAdd = $("#fabAdd");
  const btnAddEmp = $("#btnAddEmp");

  const optTheme = $("#optTheme");
  const optAutoUpdate = $("#optAutoUpdate");
  const optConfirmActions = $("#optConfirmActions");
  const optNoteMode = $("#optNoteMode");
  const optCompact = $("#optCompact");
  const optHaptics = $("#optHaptics");
  const tglGeo = $("#tglGeo");

  const btnSetPin = $("#btnSetPin");
  const btnClearPin = $("#btnClearPin");

  const btnBackup = $("#btnBackup");
  const btnRestore = $("#btnRestore");
  const btnWipe = $("#btnWipe");
  const filePicker = $("#filePicker");

  const tabs = $$(".tab");
  const views = $$(".view");

  let histPage = 0;
  const HIST_PAGE_SIZE = 120;

  // ───────────────────────── Theme / layout helpers ─────────────────────────
  function applyTheme(theme){
    if (!theme) theme = "system";
    let t = theme;

    if (t === "system"){
      const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
      t = prefersLight ? "light" : "dark";
    }
    document.documentElement.setAttribute("data-theme", t);
  }

  function setCompact(on){
    document.body.classList.toggle("compact", !!on);
  }

  function setOfflineBadge(){
    const off = !navigator.onLine;
    if (uiOffline) uiOffline.hidden = !off;
  }

  function setHeaderDate(){
    if (!uiDate) return;
    uiDate.textContent = fmtDateLong(new Date());
  }

  function setCounts(st){
    if (!uiCounts) return;
    const n = st.employees.length;
    const today = toISODate(new Date());
    let inside = 0;

    for (const emp of st.employees){
      const ev = getEventsForEmpOnDate(st, emp.id, today);
      const ds = deriveDayStats(ev, today);
      if (ds.isInside) inside++;
    }

    uiCounts.textContent = `${n} empleados · ${inside} dentro`;
  }

  function pillText(text, kind){
    const p = el("span", "pill");
    if (kind) p.classList.add(kind);
    p.textContent = text;
    return p;
  }

  function avatarText(name){
    const s = String(name || "").trim();
    if (!s) return "?";
    const parts = s.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || "?";
    const b = parts.length > 1 ? parts[parts.length-1][0] : "";
    return (a + b).toUpperCase();
  }

  async function promptNoteIfNeeded(st, actionLabel){
    if (st.settings.noteMode === "never") return "";

    const wrap = el("div");
    const p = el("div", "muted");
    p.style.lineHeight = "1.55";
    p.textContent = `Nota (opcional) para: ${actionLabel}`;

    const field = el("label", "field");
    const span = el("span"); span.textContent = "Nota";
    const ta = document.createElement("textarea");
    ta.placeholder = "Ej: Llegó 10 min tarde, Cambio de turno, etc.";
    field.appendChild(span);
    field.appendChild(ta);

    wrap.appendChild(p);
    wrap.appendChild(el("div")).style.height = "8px";
    wrap.appendChild(field);

    const ok = btnIcon("Guardar", "check", "btn btn-primary", () => {
      const r = modalResolve; modalResolve = null;
      const v = String(ta.value || "");
      closeModal();
      if (r) r(v);
    });

    const skip = btnIcon("Sin nota", "notes", "btn btn-ghost", () => {
      const r = modalResolve; modalResolve = null;
      closeModal();
      if (r) r("");
    });

    const res = await openModal({ title:"Añadir nota", contentNode: wrap, actions:[skip, ok] });
    return typeof res === "string" ? res : "";
  }

  async function onToggleInOut(st, empId){
    const today = toISODate(new Date());
    const events = getEventsForEmpOnDate(st, empId, today);
    const ds = deriveDayStats(events, today);
    const emp = getEmployeeById(st, empId);
    if (!emp) return;

    if (ds.isInside){
      if (st.settings.confirmActions){
        const ok = await confirmDialog("Salida", `¿Cerrar salida de "${emp.name}" ahora?`, "Salida", "Cancelar");
        if (!ok) return;
      }

      if (ds.breakOpen){
        await addEvent(st, empId, EVT.BREAK_END, "Auto: fin pausa (antes de salida)");
      }

      const note = await promptNoteIfNeeded(st, "Salida");
      await addEvent(st, empId, EVT.OUT, note);
      toast("ok", "Salida registrada", emp.name);
      haptic(st);
      refreshAll(st);
      return;
    }

    if (st.settings.confirmActions){
      const ok = await confirmDialog("Entrada", `¿Registrar entrada de "${emp.name}" ahora?`, "Entrada", "Cancelar");
      if (!ok) return;
    }
    const note = await promptNoteIfNeeded(st, "Entrada");
    await addEvent(st, empId, EVT.IN, note);
    toast("ok", "Entrada registrada", emp.name);
    haptic(st);
    refreshAll(st);
  }

  async function onToggleBreak(st, empId){
    const today = toISODate(new Date());
    const events = getEventsForEmpOnDate(st, empId, today);
    const ds = deriveDayStats(events, today);
    const emp = getEmployeeById(st, empId);
    if (!emp) return;

    if (!ds.isInside){
      toast("warn", "No se puede pausar", "Primero registra la entrada.");
      return;
    }

    if (ds.breakOpen){
      if (st.settings.confirmActions){
        const ok = await confirmDialog("Fin de pausa", `¿Terminar la pausa de "${emp.name}" ahora?`, "Terminar", "Cancelar");
        if (!ok) return;
      }
      const note = await promptNoteIfNeeded(st, "Fin de pausa");
      await addEvent(st, empId, EVT.BREAK_END, note);
      toast("ok", "Pausa terminada", emp.name);
      haptic(st);
      refreshAll(st);
      return;
    }

    if (st.settings.confirmActions){
      const ok = await confirmDialog("Inicio de pausa", `¿Iniciar pausa de "${emp.name}" ahora?`, "Pausa", "Cancelar");
      if (!ok) return;
    }
    const note = await promptNoteIfNeeded(st, "Inicio de pausa");
    await addEvent(st, empId, EVT.BREAK_START, note);
    toast("ok", "Pausa iniciada", emp.name);
    haptic(st);
    refreshAll(st);
  }

  // ───────────────────────── Panel render ─────────────────────────
  function renderPanelEmployees(st){
    if (!employeeList) return;
    const today = toISODate(new Date());

    employeeList.innerHTML = "";
    if (!st.employees.length){
      const c = el("div", "card");
      const t = el("div", "card-title");
      t.textContent = "Sin empleados";
      const p = el("div", "muted");
      p.textContent = "Pulsa “Añadir empleado” para empezar.";
      c.appendChild(t);
      c.appendChild(p);
      employeeList.appendChild(c);
      return;
    }

    const frag = document.createDocumentFragment();

    for (const emp of st.employees){
      const ev = getEventsForEmpOnDate(st, emp.id, today);
      const ds = deriveDayStats(ev, today);

      const row = el("div", "emp");

      const left = el("div", "emp-left");
      const av = el("div", "avatar");
      av.textContent = avatarText(emp.name);

      const meta = el("div", "emp-meta");
      const name = el("div", "emp-name");
      name.textContent = emp.name;

      const sub = el("div", "emp-sub");

      const statusKind = ds.status === "Dentro" ? "ok" : (ds.status === "En pausa" ? "warn" : "");
      sub.appendChild(pillText(ds.status, statusKind));

      const sched = getScheduleForDate(emp, today);
      sub.appendChild(pillText(sched ? `${sched.start}–${sched.end}` : "Sin horario"));

      sub.appendChild(pillText(`E: ${ds.inAt ? fmtTime(new Date(ds.inAt)) : "—"}`));
      sub.appendChild(pillText(`S: ${ds.outAt ? fmtTime(new Date(ds.outAt)) : "—"}`));

      if (ds.breakMins > 0 || ds.breakOpen){
        sub.appendChild(pillText(`Pausa: ${fmtHMFromMinutes(ds.breakMins)}${ds.breakOpen ? " (…)" : ""}`, ds.breakOpen ? "warn" : ""));
      }
      if (ds.workedMins > 0){
        sub.appendChild(pillText(`Trab: ${fmtHMFromMinutes(ds.workedMins)}`, "ok"));
      }

      meta.appendChild(name);
      meta.appendChild(sub);

      left.appendChild(av);
      left.appendChild(meta);

      const right = el("div", "emp-right");

      const bInOut = el("button", "btn btn-primary");
      bInOut.type = "button";
      bInOut.dataset.action = "toggle-inout";
      bInOut.dataset.empId = emp.id;
      const ic = el("span", "ms");
      ic.textContent = ds.isInside ? "logout" : "login";
      bInOut.appendChild(ic);
      bInOut.appendChild(document.createTextNode(ds.isInside ? "Salida" : "Entrada"));

      const bBreak = el("button", "btn");
      bBreak.type = "button";
      bBreak.dataset.action = "toggle-break";
      bBreak.dataset.empId = emp.id;
      const icb = el("span", "ms");
      icb.textContent = ds.breakOpen ? "play_arrow" : "pause";
      bBreak.appendChild(icb);
      bBreak.appendChild(document.createTextNode(ds.breakOpen ? "Fin pausa" : "Pausa"));
      if (!ds.isInside) bBreak.disabled = true;

      right.appendChild(bInOut);
      right.appendChild(bBreak);

      row.appendChild(left);
      row.appendChild(right);
      frag.appendChild(row);
    }

    employeeList.appendChild(frag);
  }

  // ───────────────────────── Admin render + CRUD ─────────────────────────
  function renderAdminEmployees(st){
    if (!employeeAdminList) return;
    employeeAdminList.innerHTML = "";

    if (!st.employees.length){
      const c = el("div", "muted");
      c.textContent = "No hay empleados aún.";
      employeeAdminList.appendChild(c);
      return;
    }

    const frag = document.createDocumentFragment();

    for (const emp of st.employees){
      const card = el("div", "emp");

      const left = el("div", "emp-left");
      const av = el("div", "avatar"); av.textContent = avatarText(emp.name);

      const meta = el("div", "emp-meta");
      const name = el("div", "emp-name"); name.textContent = emp.name;

      const sub = el("div", "emp-sub");
      const bits = [];
      for (const k of DOW_KEYS){
        const d = emp.schedule?.[k];
        if (d && d.enabled) bits.push(`${DOW_LABEL[k]} ${d.start}-${d.end}`);
      }
      sub.appendChild(pillText(bits.length ? bits.join(" · ") : "Sin horario semanal"));

      meta.appendChild(name);
      meta.appendChild(sub);

      left.appendChild(av);
      left.appendChild(meta);

      const right = el("div", "emp-right");
      const bEdit = btnIcon("Editar", "edit", "btn", () => openEditEmployee(st, emp.id));
      const bDel = btnIcon("Borrar", "delete", "btn btn-danger", () => deleteEmployee(st, emp.id));
      right.appendChild(bEdit);
      right.appendChild(bDel);

      card.appendChild(left);
      card.appendChild(right);
      frag.appendChild(card);
    }

    employeeAdminList.appendChild(frag);
  }

  async function openAddEmployee(st){
    const wrap = el("div");

    const p = el("div", "muted");
    p.style.lineHeight = "1.55";
    p.textContent = "Crea un empleado. Puedes editar su horario semanal después.";
    wrap.appendChild(p);

    const fName = el("label", "field");
    const s1 = el("span"); s1.textContent = "Nombre";
    const iName = document.createElement("input");
    iName.placeholder = "Ej: Laura García";
    fName.appendChild(s1);
    fName.appendChild(iName);

    wrap.appendChild(el("div")).style.height = "8px";
    wrap.appendChild(fName);

    const create = btnIcon("Crear", "person_add", "btn btn-primary", () => {
      const name = String(iName.value || "").trim();
      if (!name){ toast("warn", "Nombre requerido"); iName.focus(); return; }

      const emp = { id: uid(), name, schedule: defaultSchedule() };
      st.employees.push(emp);
      saveState(st);

      const r = modalResolve; modalResolve = null;
      closeModal();
      if (r) r(emp.id);
    });

    const cancel = btnIcon("Cancelar", "close", "btn btn-ghost", () => {
      const r = modalResolve; modalResolve = null;
      closeModal();
      if (r) r(null);
    });

    setTimeout(() => { try { iName.focus(); } catch(_) {} }, 60);

    const res = await openModal({ title:"Añadir empleado", contentNode: wrap, actions:[cancel, create] });
    if (res){
      toast("ok", "Empleado creado", "Ahora puedes editar el horario.");
      refreshAll(st);
      await openEditEmployee(st, res);
    }
  }

  function makeScheduleRow(k, val){
    const row = el("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1fr";
    row.style.gap = "10px";
    row.style.padding = "10px 12px";
    row.style.border = "1px solid rgba(255,255,255,.08)";
    row.style.borderRadius = "14px";
    row.style.background = "rgba(255,255,255,.03)";

    const top = el("div");
    top.style.display = "flex";
    top.style.alignItems = "center";
    top.style.justifyContent = "space-between";
    top.style.gap = "10px";

    const label = el("div", "muted");
    label.style.fontWeight = "900";
    label.textContent = DOW_LABEL[k];

    const boxWrap = el("div");
    boxWrap.style.display = "flex";
    boxWrap.style.gap = "10px";
    boxWrap.style.alignItems = "center";

    const t = el("label", "toggle");
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = !!val.enabled;
    const sl = el("span", "slider");
    t.appendChild(chk);
    t.appendChild(sl);

    const lbl = el("div", "small muted");
    lbl.textContent = chk.checked ? "Activo" : "Libre";

    boxWrap.appendChild(t);
    boxWrap.appendChild(lbl);

    top.appendChild(label);
    top.appendChild(boxWrap);

    const timeRow = el("div");
    timeRow.style.display = "grid";
    timeRow.style.gridTemplateColumns = "1fr 1fr";
    timeRow.style.gap = "10px";

    const start = document.createElement("input");
    start.type = "time";
    start.value = val.start || "09:00";

    const end = document.createElement("input");
    end.type = "time";
    end.value = val.end || "17:00";

    start.style.width = "100%";
    end.style.width = "100%";

    const applyEnabled = () => {
      const on = chk.checked;
      start.disabled = !on;
      end.disabled = !on;
      lbl.textContent = on ? "Activo" : "Libre";
      lbl.style.opacity = on ? "1" : ".8";
    };

    chk.addEventListener("change", applyEnabled);
    applyEnabled();

    timeRow.appendChild(start);
    timeRow.appendChild(end);

    row.appendChild(top);
    row.appendChild(timeRow);

    return { row, chk, start, end };
  }

  async function openEditEmployee(st, empId){
    const emp = getEmployeeById(st, empId);
    if (!emp) return;

    const wrap = el("div");

    const fName = el("label", "field");
    const s1 = el("span"); s1.textContent = "Nombre";
    const iName = document.createElement("input");
    iName.value = emp.name;
    fName.appendChild(s1);
    fName.appendChild(iName);

    const schTitle = el("div", "card-title");
    schTitle.style.marginTop = "14px";
    schTitle.textContent = "Horario semanal";

    const sch = el("div", "grid");
    const rows = {};
    for (const k of DOW_KEYS){
      const r = makeScheduleRow(k, emp.schedule?.[k] || { enabled:false, start:"09:00", end:"17:00" });
      rows[k] = r;
      sch.appendChild(r.row);
    }

    wrap.appendChild(fName);
    wrap.appendChild(schTitle);
    wrap.appendChild(sch);

    const save = btnIcon("Guardar", "save", "btn btn-primary", () => {
      const name = String(iName.value || "").trim();
      if (!name){ toast("warn", "Nombre requerido"); iName.focus(); return; }

      emp.name = name;
      emp.schedule = emp.schedule || defaultSchedule();

      for (const k of DOW_KEYS){
        const r = rows[k];
        const startV = String(r.start.value || "09:00");
        const endV = String(r.end.value || "17:00");

        const ps = parseHHMM(startV);
        const pe = parseHHMM(endV);

        if (r.chk.checked && (!ps || !pe)){
          toast("warn", `Horario inválido (${DOW_LABEL[k]})`);
          return;
        }

        emp.schedule[k] = {
          enabled: !!r.chk.checked,
          start: ps ? `${pad2(ps.hh)}:${pad2(ps.mm)}` : "09:00",
          end: pe ? `${pad2(pe.hh)}:${pad2(pe.mm)}` : "17:00",
        };
      }

      saveState(st);
      const rsv = modalResolve; modalResolve = null;
      closeModal();
      if (rsv) rsv(true);
    });

    const cancel = btnIcon("Cerrar", "close", "btn btn-ghost", () => {
      const rsv = modalResolve; modalResolve = null;
      closeModal();
      if (rsv) rsv(false);
    });

    setTimeout(() => { try { iName.focus(); iName.select(); } catch(_) {} }, 60);

    await openModal({ title:`Editar: ${emp.name}`, contentNode: wrap, actions:[cancel, save] });
    refreshAll(st);
  }

  async function deleteEmployee(st, empId){
    const emp = getEmployeeById(st, empId);
    if (!emp) return;

    if (st.settings.confirmActions){
      const ok = await confirmDialog("Borrar empleado", `Se borrará "${emp.name}" y sus eventos asociados.`, "Borrar", "Cancelar");
      if (!ok) return;
    }

    st.employees = st.employees.filter(e => e.id !== empId);
    st.events = st.events.filter(ev => ev.empId !== empId);
    saveState(st);
    toast("ok", "Empleado borrado", emp.name);
    refreshAll(st);
  }

  // ───────────────────────── Resumen ─────────────────────────
  function renderSummary(st){
    if (!summaryTable) return;
    const tbody = $("tbody", summaryTable);
    if (!tbody) return;

    tbody.innerHTML = "";
    const iso = (sumDate && sumDate.value) ? sumDate.value : toISODate(new Date());

    const frag = document.createDocumentFragment();

    for (const emp of st.employees){
      const ev = getEventsForEmpOnDate(st, emp.id, iso);
      const ds = deriveDayStats(ev, iso);
      const tr = document.createElement("tr");

      const sched = getScheduleForDate(emp, iso);
      const schedStr = sched ? `${sched.start}–${sched.end}` : "—";

      const tdName = document.createElement("td"); tdName.textContent = emp.name;
      const tdSch = document.createElement("td"); tdSch.textContent = schedStr;
      const tdIn = document.createElement("td"); tdIn.textContent = ds.inAt ? fmtTime(new Date(ds.inAt)) : "—";
      const tdOut = document.createElement("td"); tdOut.textContent = ds.outAt ? fmtTime(new Date(ds.outAt)) : "—";
      const tdBreak = document.createElement("td"); tdBreak.textContent = ds.breakMins ? fmtHMFromMinutes(ds.breakMins) : "—";
      const tdWork = document.createElement("td"); tdWork.textContent = ds.workedMins ? fmtHMFromMinutes(ds.workedMins) : "—";
      const tdSt = document.createElement("td"); tdSt.textContent = ds.status;

      tr.appendChild(tdName);
      tr.appendChild(tdSch);
      tr.appendChild(tdIn);
      tr.appendChild(tdOut);
      tr.appendChild(tdBreak);
      tr.appendChild(tdWork);
      tr.appendChild(tdSt);

      frag.appendChild(tr);
    }

    tbody.appendChild(frag);

    if (uiSummaryMeta){
      uiSummaryMeta.textContent = `${st.employees.length} filas · Fecha: ${iso}`;
    }
  }

  // ───────────────────────── Historial ─────────────────────────
  function computeFilteredEvents(st, filter){
    let arr = st.events.slice();

    if (filter.empId && filter.empId !== "all"){
      arr = arr.filter(e => e.empId === filter.empId);
    }

    if (filter.from){
      const fromD = fromISODate(filter.from);
      if (fromD){
        const t0 = new Date(fromD.getFullYear(), fromD.getMonth(), fromD.getDate(), 0,0,0,0).getTime();
        arr = arr.filter(e => e.ts >= t0);
      }
    }

    if (filter.to){
      const toD = fromISODate(filter.to);
      if (toD){
        const t1 = new Date(toD.getFullYear(), toD.getMonth(), toD.getDate(), 23,59,59,999).getTime();
        arr = arr.filter(e => e.ts <= t1);
      }
    }

    arr.sort((a,b) => b.ts - a.ts);
    return arr;
  }

  function renderHistory(st, reset=false){
    if (!eventsTable) return;
    const tbody = $("tbody", eventsTable);
    if (!tbody) return;

    if (reset){
      histPage = 0;
      tbody.innerHTML = "";
    }

    const filter = {
      empId: fEmp ? fEmp.value : "all",
      from: fFrom ? fFrom.value : "",
      to: fTo ? fTo.value : ""
    };

    const all = computeFilteredEvents(st, filter);
    const start = histPage * HIST_PAGE_SIZE;
    const end = start + HIST_PAGE_SIZE;
    const page = all.slice(start, end);

    const frag = document.createDocumentFragment();

    for (const ev of page){
      const emp = getEmployeeById(st, ev.empId);
      const d = new Date(ev.ts);

      const tr = document.createElement("tr");

      const tdD = document.createElement("td"); tdD.textContent = toISODate(d);
      const tdT = document.createElement("td"); tdT.textContent = fmtTime(d);
      const tdE = document.createElement("td"); tdE.textContent = emp ? emp.name : ev.empId;

      const tdTy = document.createElement("td");
      tdTy.textContent =
        ev.type === EVT.IN ? "Entrada" :
        ev.type === EVT.OUT ? "Salida" :
        ev.type === EVT.BREAK_START ? "Pausa (inicio)" :
        ev.type === EVT.BREAK_END ? "Pausa (fin)" :
        ev.type;

      const tdN = document.createElement("td"); tdN.textContent = ev.note || "—";

      const tdG = document.createElement("td");
      if (ev.geo && Number.isFinite(ev.geo.lat) && Number.isFinite(ev.geo.lon)){
        tdG.textContent = `${ev.geo.lat.toFixed(4)}, ${ev.geo.lon.toFixed(4)} ±${Math.round(ev.geo.acc||0)}m`;
      } else tdG.textContent = "—";

      const tdH = document.createElement("td");
      tdH.className = "mono";
      tdH.textContent = ev.hash || "—";

      tr.appendChild(tdD);
      tr.appendChild(tdT);
      tr.appendChild(tdE);
      tr.appendChild(tdTy);
      tr.appendChild(tdN);
      tr.appendChild(tdG);
      tr.appendChild(tdH);

      frag.appendChild(tr);
    }

    tbody.appendChild(frag);

    const shown = Math.min(end, all.length);
    if (uiEventCount) uiEventCount.textContent = `${shown} / ${all.length} eventos`;
    if (btnLoadMore) btnLoadMore.hidden = shown >= all.length;
  }

  function rebuildHistoryFilters(st){
    if (!fEmp) return;
    const current = fEmp.value || "all";
    fEmp.innerHTML = "";

    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = "Todos";
    fEmp.appendChild(optAll);

    for (const emp of st.employees){
      const o = document.createElement("option");
      o.value = emp.id;
      o.textContent = emp.name;
      fEmp.appendChild(o);
    }

    // intenta mantener selección
    const stillExists = current === "all" || st.employees.some(e => e.id === current);
    fEmp.value = stillExists ? current : "all";
  }

  // ───────────────────────── CSV ─────────────────────────
  function exportSummaryCSV(st){
    const iso = (sumDate && sumDate.value) ? sumDate.value : toISODate(new Date());
    const lines = [];
    lines.push(["Empleado","Horario","Entrada","Salida","Pausa","Trabajado","Estado"].map(csvEscape).join(","));

    for (const emp of st.employees){
      const ev = getEventsForEmpOnDate(st, emp.id, iso);
      const ds = deriveDayStats(ev, iso);
      const sched = getScheduleForDate(emp, iso);

      lines.push([
        emp.name,
        sched ? `${sched.start}-${sched.end}` : "",
        ds.inAt ? fmtTime(new Date(ds.inAt)) : "",
        ds.outAt ? fmtTime(new Date(ds.outAt)) : "",
        ds.breakMins ? fmtHMFromMinutes(ds.breakMins) : "",
        ds.workedMins ? fmtHMFromMinutes(ds.workedMins) : "",
        ds.status
      ].map(csvEscape).join(","));
    }

    downloadText(`clockin_resumen_${iso}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
  }

  function exportEventsCSV(st){
    const filter = {
      empId: fEmp ? fEmp.value : "all",
      from: fFrom ? fFrom.value : "",
      to: fTo ? fTo.value : ""
    };

    const arr = computeFilteredEvents(st, filter);
    const lines = [];
    lines.push(["Fecha","Hora","Empleado","Tipo","Nota","Lat","Lon","Acc(m)","Hash"].map(csvEscape).join(","));

    for (const ev of arr){
      const emp = getEmployeeById(st, ev.empId);
      const d = new Date(ev.ts);
      lines.push([
        toISODate(d),
        fmtTime(d),
        emp ? emp.name : ev.empId,
        ev.type,
        ev.note || "",
        ev.geo?.lat ?? "",
        ev.geo?.lon ?? "",
        ev.geo?.acc ?? "",
        ev.hash || ""
      ].map(csvEscape).join(","));
    }

    const stamp = toISODate(new Date());
    downloadText(`clockin_eventos_${stamp}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
  }

  // ───────────────────────── Backup / Restore / Wipe ─────────────────────────
  async function doBackup(st){
    const ok = await ensurePinOk(st, "exportar (backup)");
    if (!ok) return;

    const payload = JSON.stringify(st, null, 2);
    downloadText(`clockin_backup_${toISODate(new Date())}.json`, payload, "application/json;charset=utf-8");
    toast("ok", "Backup descargado");
  }

  async function doRestore(st){
    const ok = await ensurePinOk(st, "importar (restore)");
    if (!ok) return;
    if (!filePicker) return;
    filePicker.value = "";
    filePicker.click();
  }

  async function doWipe(st){
    const ok = await ensurePinOk(st, "borrar todo");
    if (!ok) return;

    if (st.settings.confirmActions){
      const sure = await confirmDialog("Borrar todo", "Se eliminarán empleados, horarios y eventos del dispositivo.", "Borrar", "Cancelar");
      if (!sure) return;
    }

    const fresh = defaultState();
    saveState(fresh);
    toast("ok", "Datos borrados");

    state = fresh;
    applySettingsToUI(state);
    refreshAll(state);
  }

  // ───────────────────────── Settings UI ─────────────────────────
  function applySettingsToUI(st){
    if (uiVer) uiVer.textContent = APP_VERSION;
    if (splashVer) splashVer.textContent = APP_VERSION;

    if (optTheme) optTheme.value = st.settings.theme || "system";
    applyTheme(st.settings.theme);

    if (optAutoUpdate) optAutoUpdate.checked = !!st.settings.autoUpdate;
    if (optConfirmActions) optConfirmActions.checked = !!st.settings.confirmActions;
    if (optNoteMode) optNoteMode.value = st.settings.noteMode || "ask";
    if (optCompact) optCompact.checked = !!st.settings.compact;
    if (optHaptics) optHaptics.checked = !!st.settings.haptics;
    if (tglGeo) tglGeo.checked = !!st.settings.geoEnabled;

    setCompact(st.settings.compact);
  }

  function bindSettings(st){
    optTheme?.addEventListener("change", () => {
      st.settings.theme = optTheme.value;
      applyTheme(st.settings.theme);
      saveState(st);
    });

    // Si el usuario cambia el tema del sistema con theme=system
    try{
      const mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)");
      mq?.addEventListener?.("change", () => {
        if (st.settings.theme === "system") applyTheme("system");
      });
    }catch(_){}

    optAutoUpdate?.addEventListener("change", () => {
      st.settings.autoUpdate = !!optAutoUpdate.checked;
      saveState(st);
      toast("info", "Auto-update", st.settings.autoUpdate ? "Activado" : "Desactivado");
      if (st.settings.autoUpdate && (swWaiting || swReg?.waiting)) applyUpdateNow(st);
    });

    optConfirmActions?.addEventListener("change", () => {
      st.settings.confirmActions = !!optConfirmActions.checked;
      saveState(st);
    });

    optNoteMode?.addEventListener("change", () => {
      st.settings.noteMode = optNoteMode.value;
      saveState(st);
    });

    optCompact?.addEventListener("change", () => {
      st.settings.compact = !!optCompact.checked;
      setCompact(st.settings.compact);
      saveState(st);
    });

    optHaptics?.addEventListener("change", () => {
      st.settings.haptics = !!optHaptics.checked;
      saveState(st);
    });

    tglGeo?.addEventListener("change", () => {
      st.settings.geoEnabled = !!tglGeo.checked;
      saveState(st);
      toast("info", "Geolocalización", st.settings.geoEnabled ? "Activada" : "Desactivada");
    });
  }

  // ───────────────────────── PIN UI ─────────────────────────
  async function openSetPin(st){
    const wrap = el("div");

    const p = el("div", "muted");
    p.style.lineHeight = "1.55";
    p.textContent = "Configura un PIN para proteger import/export y borrados. (Se guarda hasheado).";
    wrap.appendChild(p);

    const f1 = el("label", "field");
    const s1 = el("span"); s1.textContent = "Nuevo PIN";
    const i1 = document.createElement("input");
    i1.type = "password";
    i1.inputMode = "numeric";
    i1.placeholder = "••••";
    f1.appendChild(s1); f1.appendChild(i1);

    const f2 = el("label", "field");
    const s2 = el("span"); s2.textContent = "Repetir PIN";
    const i2 = document.createElement("input");
    i2.type = "password";
    i2.inputMode = "numeric";
    i2.placeholder = "••••";
    f2.appendChild(s2); f2.appendChild(i2);

    wrap.appendChild(el("div")).style.height = "10px";
    wrap.appendChild(f1);
    wrap.appendChild(f2);

    const ok = btnIcon("Guardar", "lock", "btn btn-primary", async () => {
      const a = String(i1.value||"").trim();
      const b = String(i2.value||"").trim();
      if (a.length < 3){ toast("warn","PIN demasiado corto"); return; }
      if (a !== b){ toast("error","No coincide"); return; }

      try{
        const salt = uid();
        const hash = await sha256Hex(salt + "|" + a);
        st.settings.pin.enabled = true;
        st.settings.pin.salt = salt;
        st.settings.pin.hash = hash;
        st.settings.pin.lastOkAt = nowMs();
        saveState(st);
        toast("ok","PIN configurado");

        const r = modalResolve; modalResolve = null;
        closeModal();
        if (r) r(true);
      }catch(e){
        console.error(e);
        toast("error","No se pudo guardar el PIN");
      }
    });

    const cancel = btnIcon("Cancelar", "close", "btn btn-ghost", () => {
      const r = modalResolve; modalResolve = null;
      closeModal();
      if (r) r(false);
    });

    setTimeout(() => { try { i1.focus(); } catch(_) {} }, 60);
    await openModal({ title:"Configurar PIN", contentNode: wrap, actions:[cancel, ok] });
  }

  async function clearPin(st){
    if (!st.settings.pin.enabled){
      toast("info","No hay PIN configurado");
      return;
    }

    const ok = await ensurePinOk(st, "quitar el PIN");
    if (!ok) return;

    if (st.settings.confirmActions){
      const sure = await confirmDialog("Quitar PIN", "Se quitará la protección. ¿Continuar?", "Quitar", "Cancelar");
      if (!sure) return;
    }

    st.settings.pin.enabled = false;
    st.settings.pin.salt = "";
    st.settings.pin.hash = "";
    st.settings.pin.lastOkAt = 0;
    saveState(st);
    toast("ok","PIN eliminado");
  }

  // ───────────────────────── Routing ─────────────────────────
  function showRoute(route){
    for (const t of tabs){
      t.classList.toggle("is-active", t.dataset.route === route);
    }

    for (const v of views){
      const isTarget = v.dataset.route === route;
      if (isTarget){
        v.hidden = false;
        v.classList.add("view-enter");
        requestAnimationFrame(() => v.classList.add("is-entering"));
        setTimeout(() => v.classList.remove("view-enter", "is-entering"), 240);
      }else{
        // Oculta “sin animar” si ya estaba hidden; anima solo si estaba visible.
        if (!v.hidden){
          v.classList.add("view-exit");
          requestAnimationFrame(() => v.classList.add("is-exiting"));
          setTimeout(() => {
            v.hidden = true;
            v.classList.remove("view-exit", "is-exiting");
          }, 220);
        }
      }
    }

    if (route === "resumen") renderSummary(state);
    if (route === "historial") renderHistory(state, true);
  }

  function bindTabs(){
    for (const t of tabs){
      t.addEventListener("click", () => showRoute(t.dataset.route));
    }
  }

  // ───────────────────────── Refresh ─────────────────────────
  function refreshAll(st){
    setHeaderDate();
    setOfflineBadge();
    setCounts(st);
    renderPanelEmployees(st);
    renderAdminEmployees(st);
    rebuildHistoryFilters(st);
    renderSummary(st);
    renderHistory(st, true);
  }

  // ───────────────────────── Binding ─────────────────────────
  function bindPanelActions(st){
    if (!employeeList) return;

    employeeList.addEventListener("click", async (e) => {
      const b = e.target && e.target.closest ? e.target.closest("button[data-action]") : null;
      if (!b) return;

      const empId = b.dataset.empId;
      const act = b.dataset.action;
      if (!empId || !act) return;

      b.disabled = true;
      try{
        if (act === "toggle-inout") await onToggleInOut(st, empId);
        if (act === "toggle-break") await onToggleBreak(st, empId);
      } finally {
        b.disabled = false;
      }
    });
  }

  function bindSummary(st){
    if (!sumDate) return;

    if (!sumDate.value) sumDate.value = toISODate(new Date());
    sumDate.addEventListener("change", () => renderSummary(st));

    btnSumPrev?.addEventListener("click", () => {
      const d = fromISODate(sumDate.value) || new Date();
      d.setDate(d.getDate()-1);
      sumDate.value = toISODate(d);
      renderSummary(st);
    });

    btnSumNext?.addEventListener("click", () => {
      const d = fromISODate(sumDate.value) || new Date();
      d.setDate(d.getDate()+1);
      sumDate.value = toISODate(d);
      renderSummary(st);
    });

    btnExportResumen?.addEventListener("click", async () => {
      const ok = await ensurePinOk(st, "exportar CSV");
      if (!ok) return;
      exportSummaryCSV(st);
      toast("ok","CSV generado","Resumen");
    });
  }

  function bindHistory(st){
    btnApplyFilters?.addEventListener("click", () => renderHistory(st, true));

    btnClearFilters?.addEventListener("click", () => {
      if (fEmp) fEmp.value = "all";
      if (fFrom) fFrom.value = "";
      if (fTo) fTo.value = "";
      renderHistory(st, true);
    });

    btnLoadMore?.addEventListener("click", () => {
      histPage++;
      renderHistory(st, false);
    });

    btnExportEventos?.addEventListener("click", async () => {
      const ok = await ensurePinOk(st, "exportar CSV");
      if (!ok) return;
      exportEventsCSV(st);
      toast("ok","CSV generado","Eventos");
    });
  }

  function bindEmployeeButtons(st){
    const openAdd = () => openAddEmployee(st);
    btnQuickAdd?.addEventListener("click", openAdd);
    fabAdd?.addEventListener("click", openAdd);
    btnAddEmp?.addEventListener("click", openAdd);
  }

  function bindDataButtons(st){
    btnBackup?.addEventListener("click", () => doBackup(st));
    btnRestore?.addEventListener("click", () => doRestore(st));
    btnWipe?.addEventListener("click", () => doWipe(st));

    if (filePicker){
      filePicker.addEventListener("change", () => {
        const f = filePicker.files && filePicker.files[0];
        if (!f) return;

        const reader = new FileReader();
        reader.onload = () => {
          const txt = String(reader.result || "");
          const incoming = safeJsonParse(txt, null);
          if (!incoming || typeof incoming !== "object"){
            toast("error","JSON inválido");
            return;
          }

          try{
            const norm = normalizeState(incoming);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(norm));
            state = loadState();
            applySettingsToUI(state);
            refreshAll(state);
            toast("ok","Importación OK");
          }catch(e){
            console.error(e);
            toast("error","No se pudo importar");
          }
        };
        reader.readAsText(f);
      });
    }
  }

  function bindPinButtons(st){
    btnSetPin?.addEventListener("click", () => openSetPin(st));
    btnClearPin?.addEventListener("click", () => clearPin(st));
  }

  // Close modal
  modalClose?.addEventListener("click", closeModal);
  modalBackdrop?.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modalBackdrop && !modalBackdrop.hidden) closeModal(); });

  // ───────────────────────── Online/Offline & ticks ─────────────────────────
  window.addEventListener("online", () => setOfflineBadge());
  window.addEventListener("offline", () => setOfflineBadge());
  setInterval(() => { setHeaderDate(); }, 60 * 1000);

  // ───────────────────────── Splash FIX (Opera GX / overlays) ─────────────────────────
  function forceSplashNonBlocking(){
    if (!splash) return;
    splash.style.pointerEvents = "none";
  }

  function hideSplash(){
    if (!splash) return;
    if (splashMsg) splashMsg.textContent = "Listo";

    splash.classList.add("is-hidden");

    setTimeout(() => {
      try{
        splash.hidden = true;
        splash.style.display = "none";
        splash.style.pointerEvents = "none";
      }catch(_){}
    }, 260);
  }

  // ───────────────────────── Init ─────────────────────────
  let state = loadState();

  function init(){
    hardHideBackdrop();
    forceSplashNonBlocking();

    if (splashMsg) splashMsg.textContent = "Inicializando…";

    detectMode();
    setupInstallButton();

    applySettingsToUI(state);
    bindSettings(state);

    registerSW(state);

    bindTabs();
    bindPanelActions(state);
    bindSummary(state);
    bindHistory(state);
    bindEmployeeButtons(state);
    bindDataButtons(state);
    bindPinButtons(state);

    if (sumDate && !sumDate.value) sumDate.value = toISODate(new Date());

    rebuildHistoryFilters(state);
    refreshAll(state);

    // Mantén el route inicial como Panel, por si algún navegador restaura scroll/estado raro
    try { showRoute("panel"); } catch(_) {}

    hideSplash();
  }

  try{
    init();
  }catch(e){
    console.error(e);
    toast("error", "Error crítico", "Usa Repair si se queda atascado.");
    if (splashMsg) splashMsg.textContent = "Error al iniciar";
    try { hideSplash(); } catch(_) {}
  }

})();
