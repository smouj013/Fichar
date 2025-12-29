/* app.js — ClockIn v2.0.0 (STABLE + PWA + AUTO-UPDATE + UI PRO) */
(() => {
  "use strict";

  const VERSION = String((typeof window !== "undefined" && window.APP_VERSION) || "2.0.0");

  // Storage (v2) + migración desde v1
  const STORAGE_KEY = "clockin_state_v2";
  const LEGACY_KEYS = ["clockin_state_v1", "clockin_state_v1_0", "clockin_state_v1.0.0"];

  const DOW_KEYS = ["sun","mon","tue","wed","thu","fri","sat"];
  const DOW_LABEL = { mon:"Lun", tue:"Mar", wed:"Mié", thu:"Jue", fri:"Vie", sat:"Sáb", sun:"Dom" };

  const MAX_EVENTS_STEP = 300;
  const SW_RELOAD_GUARD = "clockin_sw_reload_once";

  const CR = (typeof globalThis !== "undefined" && globalThis.crypto) ? globalThis.crypto : null;

  // ───────────────────────── Helpers ─────────────────────────
  function $(sel, root){ return (root || document).querySelector(sel); }
  function $$(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }
  function pad2(n){ return String(n).padStart(2,"0"); }

  function safeReplaceAll(s, a, b) {
    s = String(s);
    if (typeof s.replaceAll === "function") return s.replaceAll(a, b);
    return s.split(a).join(b);
  }

  function escapeHtml(s){
    s = String(s == null ? "" : s);
    s = safeReplaceAll(s, "&", "&amp;");
    s = safeReplaceAll(s, "<", "&lt;");
    s = safeReplaceAll(s, ">", "&gt;");
    s = safeReplaceAll(s, '"', "&quot;");
    s = safeReplaceAll(s, "'", "&#39;");
    return s;
  }

  function now(){ return Date.now(); }

  function uid(){
    try { if (CR && typeof CR.randomUUID === "function") return CR.randomUUID(); } catch(_) {}
    return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }

  function dateKeyLocal(ms){
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  }

  function dowKeyFromDateKey(dayKey){
    // YYYY-MM-DD -> evita UTC raro en iOS usando mediodía
    const d = new Date(dayKey + "T12:00:00");
    return DOW_KEYS[d.getDay()];
  }

  function timeHHMM(ms){
    const d = new Date(ms);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function prettyDateLong(ms){
    try {
      return new Intl.DateTimeFormat("es-ES",{
        weekday:"long",year:"numeric",month:"long",day:"numeric"
      }).format(new Date(ms));
    } catch(_) {
      return dateKeyLocal(ms);
    }
  }

  function fmtDuration(ms){
    ms = Math.max(0, ms|0);
    const m = Math.floor(ms/60000);
    const h = Math.floor(m/60);
    const mm = m%60;
    return h<=0 ? `${mm} min` : `${h} h ${mm} min`;
  }

  // ───────────────────────── Splash / Fatal ─────────────────────────
  const ui = {};
  function setSplash(msg){
    if (!ui.splashMsg) return;
    if (msg) ui.splashMsg.textContent = msg;
  }

  function hideSplash(){
    if (!ui.splash) return;
    ui.splash.classList.add("is-hidden");
    setTimeout(() => {
      try { ui.splash.remove(); } catch(_) { ui.splash.style.display = "none"; }
    }, 320);
  }

  function hardCloseOverlays(){
    try { if (ui.modalBackdrop) ui.modalBackdrop.hidden = true; } catch(_) {}
    try { document.body.classList.remove("modal-open"); } catch(_) {}
    try {
      const splash = ui.splash || $("#splash");
      if (splash) splash.style.display = "none";
    } catch(_) {}
  }

  function fatalScreen(title, details){
    hardCloseOverlays();

    const main = ui.appMain || $("#appMain") || $(".main");
    if (!main) { alert(title + "\n\n" + details); return; }

    main.innerHTML = `
      <div class="card">
        <div class="card-title">⛔ ${escapeHtml(title)}</div>
        <div class="muted small" style="white-space:pre-wrap; margin-top:8px">${escapeHtml(details)}</div>
        <div class="row" style="margin-top:12px">
          <a class="btn btn-ghost" href="./?repair"><span class="ms">construction</span> Repair</a>
          <button class="btn btn-primary" id="btnReload" type="button"><span class="ms">refresh</span> Recargar</button>
        </div>
      </div>
    `;
    const r = $("#btnReload");
    if (r) r.addEventListener("click", () => location.reload());
  }

  // ───────────────────────── State ─────────────────────────
  function makeDefaultSchedule(){
    const base = { off:false, start:"09:00", end:"17:00" };
    return {
      mon:{...base}, tue:{...base}, wed:{...base}, thu:{...base}, fri:{...base},
      sat:{off:true, start:"", end:""},
      sun:{off:true, start:"", end:""}
    };
  }

  function normalizeSchedule(sch){
    const def = makeDefaultSchedule();
    const out = {};
    for (const k of Object.keys(def)){
      const v = (sch && sch[k]) ? sch[k] : def[k];
      out[k] = { off: !!v.off, start: v.start ? String(v.start) : "", end: v.end ? String(v.end) : "" };
    }
    return out;
  }

  function makeDefaultState(){
    const a = { id: uid(), name: "Empleado 1", schedule: makeDefaultSchedule(), createdAt: now() };
    const b = { id: uid(), name: "Empleado 2", schedule: makeDefaultSchedule(), createdAt: now() };
    return {
      version: VERSION,
      settings: {
        geoEnabled:false,
        theme:"dark",          // dark | light | system
        autoUpdate:true,
        confirmActions:false,
        noteMode:"ask",        // ask | never
        compact:false,
        haptics:false
      },
      security: { pin: null }, // {saltB64, iter, hashB64}
      employees: [a,b],
      events: [] // {id, empId, type, ts, note, loc, hash}
    };
  }

  function normalizeState(s){
    const base = makeDefaultState();
    const st = (s && typeof s === "object") ? s : base;

    st.version = VERSION;

    if (!st.settings || typeof st.settings !== "object") st.settings = {...base.settings};
    st.settings.geoEnabled = !!st.settings.geoEnabled;
    st.settings.theme = (st.settings.theme==="light" || st.settings.theme==="system") ? st.settings.theme : "dark";
    st.settings.autoUpdate = (typeof st.settings.autoUpdate==="boolean") ? st.settings.autoUpdate : true;
    st.settings.confirmActions = !!st.settings.confirmActions;
    st.settings.noteMode = (st.settings.noteMode==="never") ? "never" : "ask";
    st.settings.compact = !!st.settings.compact;
    st.settings.haptics = !!st.settings.haptics;

    if (!st.security || typeof st.security !== "object") st.security = { pin:null };
    if (st.security.pin && (!st.security.pin.saltB64 || !st.security.pin.hashB64)) st.security.pin = null;

    if (!Array.isArray(st.employees)) st.employees = [];
    st.employees = st.employees
      .filter(e => e && e.id && e.name)
      .map(e => ({
        id:String(e.id),
        name:String(e.name),
        schedule: normalizeSchedule(e.schedule),
        createdAt: Number(e.createdAt || now())
      }));
    if (!st.employees.length) st.employees = base.employees;

    if (!Array.isArray(st.events)) st.events = [];
    st.events = st.events
      .filter(ev => ev && ev.id && ev.empId && ev.type && ev.ts)
      .map(ev => ({
        id:String(ev.id),
        empId:String(ev.empId),
        type:String(ev.type),
        ts:Number(ev.ts),
        note: ev.note ? String(ev.note) : "",
        loc: (ev.loc && typeof ev.loc === "object") ? { lat:Number(ev.loc.lat), lon:Number(ev.loc.lon) } : null,
        hash: ev.hash ? String(ev.hash) : ""
      }));

    return st;
  }

  function loadFromKey(key){
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch(_) {
      return null;
    }
  }

  function loadState(){
    const cur = loadFromKey(STORAGE_KEY);
    if (cur) return normalizeState(cur);

    for (const k of LEGACY_KEYS){
      const legacy = loadFromKey(k);
      if (legacy) {
        const migrated = normalizeState(legacy);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)); } catch(_) {}
        return migrated;
      }
    }

    return makeDefaultState();
  }

  function saveState(){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (_) {
      toast("⛔", "No se pudo guardar", "Almacenamiento bloqueado (modo privado/permisos).");
      return false;
    }
  }

  let state = null;

  // ───────────────────────── Haptics ─────────────────────────
  function vibrate(ms){
    try{
      if (!state || !state.settings || !state.settings.haptics) return;
      if (navigator.vibrate) navigator.vibrate(ms);
    }catch(_){}
  }

  // ───────────────────────── Crypto (PIN + Hash) ─────────────────────────
  function b64FromBuf(buf){
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function bufFromB64(b64){
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function hexFromBuf(buf){
    const b = new Uint8Array(buf);
    let out = "";
    for (let i=0;i<b.length;i++) out += b[i].toString(16).padStart(2,"0");
    return out;
  }
  function constEq(a,b){
    a=String(a); b=String(b);
    if (a.length!==b.length) return false;
    let ok=0;
    for (let i=0;i<a.length;i++) ok |= (a.charCodeAt(i)^b.charCodeAt(i));
    return ok===0;
  }

  async function sha256Hex(str){
    if (!CR || !CR.subtle) return "";
    const enc = new TextEncoder().encode(str);
    const hash = await CR.subtle.digest("SHA-256", enc);
    return hexFromBuf(hash);
  }

  async function pbkdf2HashB64(password, saltB64, iter){
    if (!CR || !CR.subtle) throw new Error("CryptoSubtle no disponible (necesita HTTPS o localhost).");
    const keyMaterial = await CR.subtle.importKey("raw", new TextEncoder().encode(password), {name:"PBKDF2"}, false, ["deriveBits"]);
    const bits = await CR.subtle.deriveBits(
      { name:"PBKDF2", hash:"SHA-256", salt: bufFromB64(saltB64), iterations: iter },
      keyMaterial,
      256
    );
    return b64FromBuf(bits);
  }

  function lastHash(){
    if (!state.events.length) return "GENESIS";
    return state.events[state.events.length-1].hash || "GENESIS";
  }

  async function makeEventHash(ev, prevHash){
    const payload = JSON.stringify({
      prev: prevHash || "GENESIS",
      id: ev.id, empId: ev.empId, type: ev.type, ts: ev.ts,
      note: ev.note || "",
      loc: ev.loc ? { lat: ev.loc.lat, lon: ev.loc.lon } : null
    });
    return sha256Hex(payload);
  }

  // ───────────────────────── UI: Toast + Modal ─────────────────────────
  function toast(icon, msg, sub){
    const zone = ui.toasts || $("#toasts");
    if (!zone) return;

    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `
      <div class="ticon">${escapeHtml(icon || "ℹ️")}</div>
      <div>
        <div class="tmsg">${escapeHtml(msg)}</div>
        ${sub ? `<div class="tsub">${escapeHtml(sub)}</div>` : ""}
      </div>
    `;
    zone.appendChild(el);

    setTimeout(()=>{ el.style.opacity="0"; el.style.transform="translateY(6px)"; }, 2600);
    setTimeout(()=>{ try{ el.remove(); }catch(_){ } }, 3200);
  }

  function openModal(title, bodyNode, actions){
    const mb = ui.modalBackdrop;
    if (!mb) return;

    ui.modalTitle.textContent = title || "—";
    ui.modalBody.innerHTML = "";
    ui.modalBody.appendChild(bodyNode);

    ui.modalActions.innerHTML = "";
    (actions || []).forEach(a => ui.modalActions.appendChild(a));

    mb.hidden = false;
    document.body.classList.add("modal-open");

    setTimeout(()=>{
      const focusable = mb.querySelector("input, textarea, select, button");
      if (focusable) focusable.focus();
    }, 0);
  }

  function closeModal(){
    const mb = ui.modalBackdrop;
    if (!mb) return;
    mb.hidden = true;
    document.body.classList.remove("modal-open");
    try{
      ui.modalBody.innerHTML = "";
      ui.modalActions.innerHTML = "";
    }catch(_){}
  }

  function mkBtn(label, cls, onClick){
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls || "btn";
    b.innerHTML = label; // label puede incluir <span class="ms">
    b.addEventListener("click", onClick);
    return b;
  }

  function initialsFromName(name){
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "??";
    const a = parts[0][0] || "?";
    const b = parts.length>1 ? (parts[parts.length-1][0] || "") : (parts[0][1] || "");
    return (a + b).toUpperCase();
  }

  function initModalGuards(){
    const mb = ui.modalBackdrop;
    if (!mb) return;

    mb.addEventListener("click", (e)=>{ if (e.target === mb) closeModal(); });
    window.addEventListener("keydown", (e)=>{ if (e.key === "Escape" && !mb.hidden) closeModal(); });
  }

  // ───────────────────────── Theme ─────────────────────────
  let themeMedia = null;
  function applyTheme(){
    const t = state.settings.theme;
    if (t === "system"){
      if (!themeMedia) themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
      document.documentElement.dataset.theme = themeMedia.matches ? "dark" : "light";
    } else {
      document.documentElement.dataset.theme = t;
    }
  }

  function hookThemeListener(){
    if (!themeMedia) themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
    try{
      themeMedia.addEventListener("change", ()=>{ if (state.settings.theme==="system") applyTheme(); });
    }catch(_){
      try{
        themeMedia.addListener(()=>{ if (state.settings.theme==="system") applyTheme(); });
      }catch(__){}
    }
  }

  // ───────────────────────── Business logic ─────────────────────────
  function getEmployee(id){ return state.employees.find(e=>e.id===id) || null; }

  function eventsForEmpDay(empId, dayKey){
    return state.events
      .filter(ev => ev.empId===empId && dateKeyLocal(ev.ts)===dayKey)
      .sort((a,b)=>a.ts-b.ts);
  }

  function computeDay(empId, dayKey){
    const evs = eventsForEmpDay(empId, dayKey);

    let firstIn=null, lastOut=null;
    let workMs=0, breakMs=0;
    let workStart=null, breakStart=null;

    for (const ev of evs){
      if (ev.type==="IN"){
        if (!firstIn) firstIn=ev.ts;
        workStart = ev.ts;
        breakStart = null;
      } else if (ev.type==="BREAK_START"){
        if (workStart!=null){ workMs += Math.max(0, ev.ts-workStart); workStart=null; }
        if (breakStart==null) breakStart=ev.ts;
      } else if (ev.type==="BREAK_END"){
        if (breakStart!=null){ breakMs += Math.max(0, ev.ts-breakStart); breakStart=null; }
        if (workStart==null) workStart=ev.ts;
      } else if (ev.type==="OUT"){
        if (breakStart!=null){ breakMs += Math.max(0, ev.ts-breakStart); breakStart=null; }
        if (workStart!=null){ workMs += Math.max(0, ev.ts-workStart); workStart=null; }
        lastOut = ev.ts;
      }
    }

    const n = now();
    const isToday = (dayKey===dateKeyLocal(n));
    if (isToday){
      if (breakStart!=null) breakMs += Math.max(0, n-breakStart);
      if (workStart!=null) workMs += Math.max(0, n-workStart);
    }

    let status="No fichado";
    let phase="OUT"; // OUT | IN | BREAK | DONE
    if (firstIn && !lastOut){
      if (breakStart!=null){ status="En pausa"; phase="BREAK"; }
      else { status="Trabajando"; phase="IN"; }
    } else if (firstIn && lastOut){
      status="Finalizado"; phase="DONE";
    }

    return { firstIn, lastOut, workMs, breakMs, status, phase };
  }

  function scheduleStr(emp, dowKey){
    const slot = emp.schedule && emp.schedule[dowKey];
    if (!slot || slot.off) return "Libre";
    const s = (slot.start||"").trim();
    const e = (slot.end||"").trim();
    if (!s || !e) return "—";
    return `${s}–${e}`;
  }

  function eventTypeLabel(t){
    if (t==="IN") return "Entrada";
    if (t==="OUT") return "Salida";
    if (t==="BREAK_START") return "Pausa inicio";
    if (t==="BREAK_END") return "Pausa fin";
    return t;
  }

  async function getGeoIfEnabled(){
    if (!state.settings.geoEnabled) return null;
    if (!("geolocation" in navigator)) return null;

    return new Promise((resolve)=>{
      navigator.geolocation.getCurrentPosition(
        (pos)=>{
          const lat = Math.round(pos.coords.latitude*1000)/1000;
          const lon = Math.round(pos.coords.longitude*1000)/1000;
          resolve({lat,lon});
        },
        ()=>resolve(null),
        { enableHighAccuracy:false, timeout:6000, maximumAge:300000 }
      );
    });
  }

  function validateNextAction(curPhase, actionType){
    if (actionType==="IN") return (curPhase==="OUT" || curPhase==="DONE");
    if (actionType==="OUT") return (curPhase==="IN");
    if (actionType==="BREAK_START") return (curPhase==="IN");
    if (actionType==="BREAK_END") return (curPhase==="BREAK");
    return false;
  }

  function askNoteModal(title, onOk){
    if (state.settings.noteMode === "never"){
      onOk("");
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.innerHTML = `
      <span>Nota (opcional)</span>
      <textarea id="mNote" placeholder="Ej: médico, reunión, incidencia..."></textarea>
      <div class="small muted">Se guarda junto al evento.</div>
    `;
    const ta = $("#mNote", wrap);

    const bCancel = mkBtn(`Cancelar`, "btn btn-ghost", ()=>closeModal());
    const bNo = mkBtn(`Guardar sin nota`, "btn btn-ghost", ()=>{ closeModal(); onOk(""); });
    const bOk = mkBtn(`<span class="ms">done</span> Guardar`, "btn btn-primary", ()=>{ closeModal(); onOk(ta.value || ""); });

    openModal(title, wrap, [bCancel, bNo, bOk]);
    setTimeout(()=>{ try{ ta.focus(); }catch(_){} }, 0);
  }

  async function confirmIfNeeded(title, text){
    if (!state.settings.confirmActions) return true;

    return new Promise((resolve)=>{
      const wrap = document.createElement("div");
      wrap.innerHTML = `<div class="muted">${escapeHtml(text || "¿Confirmas la acción?")}</div>`;
      const bCancel = mkBtn("Cancelar","btn btn-ghost", ()=>{ closeModal(); resolve(false); });
      const bOk = mkBtn(`<span class="ms">check</span> Confirmar`,"btn btn-primary", ()=>{ closeModal(); resolve(true); });
      openModal(title, wrap, [bCancel, bOk]);
    });
  }

  async function addEvent(empId, type, note){
    const emp = getEmployee(empId);
    if (!emp) return;

    const dayKey = dateKeyLocal(now());
    const cur = computeDay(empId, dayKey);

    // mensaje específico para evitar confusión
    if (type === "OUT" && cur.phase === "BREAK"){
      toast("⚠️","No puedes salir en pausa","Termina la pausa antes de fichar salida.");
      return;
    }

    if (!validateNextAction(cur.phase, type)){
      toast("⚠️", "Acción no válida", `Estado actual: ${cur.status}`);
      return;
    }

    const ev = {
      id: uid(),
      empId,
      type,
      ts: now(),
      note: note ? String(note) : "",
      loc: await getGeoIfEnabled(),
      hash: ""
    };

    try { ev.hash = await makeEventHash(ev, lastHash()); } catch(_) { ev.hash = ""; }

    state.events.push(ev);
    saveState();

    vibrate(18);
    toast("✅", `${eventTypeLabel(type)} — ${emp.name}`, ev.note ? ev.note : "");
    renderAll();
  }

  // ───────────────────────── PIN ─────────────────────────
  async function verifyPin(pin){
    const p = state.security.pin;
    if (!p) return true;
    try {
      const hash = await pbkdf2HashB64(pin, p.saltB64, p.iter);
      return constEq(hash, p.hashB64);
    } catch (_) {
      toast("⚠️","PIN no disponible", "Necesita HTTPS o localhost");
      return false;
    }
  }

  async function requirePinIfSet(reasonText){
    if (!state.security.pin) return true;

    return new Promise((resolve)=>{
      const wrap = document.createElement("div");
      wrap.className="field";
      wrap.innerHTML = `
        <span>Introduce el PIN</span>
        <input id="mPin" type="password" inputmode="numeric" placeholder="PIN" />
        <div class="small muted">${escapeHtml(reasonText || "Acción protegida")}</div>
      `;
      const pin = $("#mPin", wrap);

      const bCancel = mkBtn("Cancelar","btn btn-ghost", ()=>{ closeModal(); resolve(false); });
      const bOk = mkBtn(`<span class="ms">lock</span> Verificar`,"btn btn-primary", async ()=>{
        const ok = await verifyPin(pin.value || "");
        if (!ok) { toast("⛔","PIN incorrecto"); return; }
        closeModal();
        resolve(true);
      });

      openModal("Seguridad", wrap, [bCancel, bOk]);
      setTimeout(()=>{ try{ pin.focus(); }catch(_){} }, 0);
    });
  }

  async function setPinFlow(){
    const wrap = document.createElement("div");
    wrap.style.display="grid";
    wrap.style.gap="12px";
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

    const bCancel = mkBtn("Cancelar","btn btn-ghost", ()=>closeModal());
    const bOk = mkBtn(`<span class="ms">save</span> Guardar`,"btn btn-primary", async ()=>{
      const a = (p1.value || "").trim();
      const b = (p2.value || "").trim();
      if (a.length<4) { toast("⚠️","PIN demasiado corto","Mínimo 4 dígitos"); return; }
      if (a!==b) { toast("⚠️","No coincide el PIN"); return; }

      try {
        if (!CR) throw new Error("crypto no disponible");
        const salt = CR.getRandomValues(new Uint8Array(16));
        const saltB64 = b64FromBuf(salt.buffer);
        const iter = 120000;
        const hashB64 = await pbkdf2HashB64(a, saltB64, iter);
        state.security.pin = { saltB64, iter, hashB64 };
        saveState();
        closeModal();
        toast("🔐","PIN guardado");
        renderAll();
      } catch (_) {
        toast("⛔","No se pudo guardar PIN", "Necesita HTTPS o localhost");
      }
    });

    openModal("Configurar PIN", wrap, [bCancel,bOk]);
    setTimeout(()=>{ try{ p1.focus(); }catch(_){} }, 0);
  }

  async function clearPinFlow(){
    const ok = await requirePinIfSet("Para quitar el PIN, confírmalo.");
    if (!ok) return;
    state.security.pin = null;
    saveState();
    toast("✅","PIN eliminado");
    renderAll();
  }

  // ───────────────────────── Employees CRUD ─────────────────────────
  function scheduleEditorNode(schedule){
    const sch = normalizeSchedule(schedule);
    const wrap = document.createElement("div");
    wrap.className="card";
    wrap.style.marginTop="10px";
    wrap.innerHTML = `<div class="card-title">Horario semanal</div>`;

    const grid = document.createElement("div");
    grid.style.display="grid";
    grid.style.gridTemplateColumns="1fr 1fr 1fr auto";
    grid.style.gap="10px";
    grid.style.alignItems="center";

    for (const k of ["mon","tue","wed","thu","fri","sat","sun"]){
      const day = document.createElement("div");
      day.className="small muted";
      day.textContent = DOW_LABEL[k];

      const start = document.createElement("input");
      start.type="time";
      start.value = sch[k].start || "";

      const end = document.createElement("input");
      end.type="time";
      end.value = sch[k].end || "";

      const offWrap = document.createElement("label");
      offWrap.className="toggle";
      offWrap.innerHTML = `<input type="checkbox"><span class="slider"></span>`;
      const off = $("input", offWrap);
      off.checked = !!sch[k].off;

      const applyOff = () => {
        const isOff = off.checked;
        start.disabled = isOff;
        end.disabled = isOff;
        if (isOff) { start.value=""; end.value=""; }
        else {
          if (!start.value) start.value="09:00";
          if (!end.value) end.value="17:00";
        }
      };
      off.addEventListener("change", applyOff);
      applyOff();

      grid.appendChild(day);
      grid.appendChild(start);
      grid.appendChild(end);
      grid.appendChild(offWrap);

      sch[k]._startEl = start;
      sch[k]._endEl = end;
      sch[k]._offEl = off;
    }

    wrap.appendChild(grid);

    wrap.getSchedule = () => {
      const out = {};
      for (const k of ["mon","tue","wed","thu","fri","sat","sun"]){
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

  function addOrEditEmployeeFlow(empId){
    const isEdit = !!empId;
    const emp = isEdit ? getEmployee(empId) : null;

    const wrap = document.createElement("div");

    const nameField = document.createElement("label");
    nameField.className="field";
    nameField.innerHTML = `<span>Nombre</span><input id="eName" type="text" placeholder="Nombre del empleado" />`;
    const nameInput = $("#eName", nameField);
    nameInput.value = emp ? emp.name : "";

    const schNode = scheduleEditorNode(emp ? emp.schedule : makeDefaultSchedule());

    wrap.appendChild(nameField);
    wrap.appendChild(schNode);

    const bCancel = mkBtn("Cancelar","btn btn-ghost", ()=>closeModal());
    const bSave = mkBtn(`<span class="ms">save</span> ${isEdit ? "Guardar" : "Crear"}`,"btn btn-primary", ()=>{
      const name = (nameInput.value || "").trim();
      if (name.length<2) { toast("⚠️","Nombre demasiado corto"); return; }

      const schedule = schNode.getSchedule();
      if (isEdit){
        emp.name = name;
        emp.schedule = schedule;
      } else {
        state.employees.push({ id: uid(), name, schedule, createdAt: now() });
      }
      saveState();
      closeModal();
      toast("✅", isEdit ? "Empleado actualizado" : "Empleado creado", name);
      renderAll();
    });

    openModal(isEdit ? "Editar empleado" : "Añadir empleado", wrap, [bCancel,bSave]);
    setTimeout(()=>{ try{ nameInput.focus(); }catch(_){} },0);
  }

  async function deleteEmployeeFlow(empId){
    const emp = getEmployee(empId);
    if (!emp) return;

    const ok = await requirePinIfSet("Borrar empleado y eventos requiere PIN (si está activo).");
    if (!ok) return;

    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="muted">Se borrará <b>${escapeHtml(emp.name)}</b> y todos sus eventos.</div>`;

    const bCancel = mkBtn("Cancelar","btn btn-ghost", ()=>closeModal());
    const bDel = mkBtn(`<span class="ms">delete</span> Borrar`,"btn btn-danger", ()=>{
      state.employees = state.employees.filter(e=>e.id!==empId);
      state.events = state.events.filter(ev=>ev.empId!==empId);
      saveState();
      closeModal();
      toast("🗑️","Empleado borrado", emp.name);
      renderAll();
    });

    openModal("Confirmar borrado", wrap, [bCancel,bDel]);
  }

  // ───────────────────────── Export / Backup / Restore / Wipe ─────────────────────────
  function downloadText(filename, text, mime){
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 800);
  }

  function csvEscape(v){
    const s = String(v == null ? "" : v);
    if (/[",\n]/.test(s)) return `"${safeReplaceAll(s, '"', '""')}"`;
    return s;
  }

  async function exportResumenCSV(){
    const ok = await requirePinIfSet("Exportar CSV está protegido por PIN (si está activo).");
    if (!ok) return;

    const dayKey = renderState.summaryDayKey || dateKeyLocal(now());
    const dowKey = dowKeyFromDateKey(dayKey);

    let csv = "Empleado,Horario,Entrada,Salida,Pausa,Trabajado,Estado\n";
    for (const emp of state.employees){
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
    toast("⬇️","Resumen CSV exportado");
  }

  async function exportEventosCSV(rows){
    const ok = await requirePinIfSet("Exportar CSV está protegido por PIN (si está activo).");
    if (!ok) return;

    rows = rows || state.events.slice().sort((a,b)=>a.ts-b.ts);
    let csv = "Fecha,Hora,Empleado,Tipo,Nota,Ubicacion,Hash\n";
    for (const ev of rows){
      const emp = getEmployee(ev.empId);
      const loc = ev.loc ? `${ev.loc.lat},${ev.loc.lon}` : "";
      csv += [
        csvEscape(dateKeyLocal(ev.ts)),
        csvEscape(timeHHMM(ev.ts)),
        csvEscape(emp ? emp.name : ev.empId),
        csvEscape(eventTypeLabel(ev.type)),
        csvEscape(ev.note||""),
        csvEscape(loc),
        csvEscape(ev.hash||"")
      ].join(",") + "\n";
    }
    downloadText(`clockin_eventos_${dateKeyLocal(now())}.csv`, csv, "text/csv;charset=utf-8");
    toast("⬇️","Eventos CSV exportados");
  }

  async function backupJSON(){
    const ok = await requirePinIfSet("Exportar backup JSON está protegido por PIN (si está activo).");
    if (!ok) return;

    downloadText(`clockin_backup_${dateKeyLocal(now())}.json`, JSON.stringify(state, null, 2), "application/json;charset=utf-8");
    toast("⬇️","Backup JSON exportado");
  }

  async function restoreJSON(file){
    const ok = await requirePinIfSet("Importar backup JSON está protegido por PIN (si está activo).");
    if (!ok) return;

    const text = await file.text();
    let parsed;
    try { parsed = JSON.parse(text); }
    catch(_) { toast("⛔","JSON inválido"); return; }

    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="muted">Vas a reemplazar los datos actuales por la copia importada.</div>`;
    const bCancel = mkBtn("Cancelar","btn btn-ghost", ()=>closeModal());
    const bOk = mkBtn(`<span class="ms">file_upload</span> Importar`,"btn btn-primary", ()=>{
      state = normalizeState(parsed);
      saveState();
      closeModal();
      toast("✅","Copia importada");
      renderAll();
    });
    openModal("Confirmar importación", wrap, [bCancel,bOk]);
  }

  async function wipeAll(){
    const ok = await requirePinIfSet("Borrar todo está protegido por PIN (si está activo).");
    if (!ok) return;

    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="muted">Esto borrará empleados, horarios y eventos (solo en este dispositivo).</div>`;
    const bCancel = mkBtn("Cancelar","btn btn-ghost", ()=>closeModal());
    const bOk = mkBtn(`<span class="ms">delete_forever</span> Borrar todo`,"btn btn-danger", ()=>{
      try { localStorage.removeItem(STORAGE_KEY); } catch(_) {}
      closeModal();
      location.reload();
    });
    openModal("Confirmar borrado total", wrap, [bCancel,bOk]);
  }

  // ───────────────────────── Rendering / Routing ─────────────────────────
  const renderState = {
    historyLimit: MAX_EVENTS_STEP,
    historyLastRows: [],
    summaryDayKey: dateKeyLocal(now())
  };

  function setRoute(route){
    $$(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.route===route));
    $$(".view").forEach(v => v.hidden = (v.dataset.route!==route));
    renderAll();
  }

  function renderPanel(){
    ui.employeeList.innerHTML = "";

    const dayKey = dateKeyLocal(now());
    const dowKey = dowKeyFromDateKey(dayKey);

    ui.uiCounts.textContent = `${state.employees.length} empleado(s)`;

    const frag = document.createDocumentFragment();

    for (const emp of state.employees){
      const d = computeDay(emp.id, dayKey);

      const el = document.createElement("div");
      el.className = "emp";

      const pillStateClass =
        (d.phase==="IN") ? "ok" :
        (d.phase==="BREAK") ? "warn" :
        (d.phase==="DONE") ? "off" : "";

      const pills = [
        `<span class="pill ${pillStateClass}">${escapeHtml(d.status)}</span>`,
        `<span class="pill">${escapeHtml(scheduleStr(emp, dowKey))}</span>`,
        `<span class="pill">Pausa: ${escapeHtml(fmtDuration(d.breakMs))}</span>`,
        `<span class="pill">Trab.: ${escapeHtml(fmtDuration(d.workMs))}</span>`
      ];

      el.innerHTML = `
        <div class="emp-left">
          <div class="avatar">${escapeHtml(initialsFromName(emp.name))}</div>
          <div class="emp-meta">
            <div class="emp-name">${escapeHtml(emp.name)}</div>
            <div class="emp-sub">${pills.join("")}</div>
          </div>
        </div>
        <div class="emp-right"></div>
      `;

      const right = $(".emp-right", el);

      // Entrada/Salida
      const btnClock = document.createElement("button");
      btnClock.type = "button";
      btnClock.className = "btn btn-primary";

      btnClock.innerHTML =
        (d.phase==="OUT" || d.phase==="DONE")
          ? `<span class="ms">login</span> Entrada`
          : `<span class="ms">logout</span> Salida`;

      btnClock.addEventListener("click", async ()=>{
        const cur = computeDay(emp.id, dayKey);

        // mensaje específico antes de validar
        if (cur.phase === "BREAK"){
          toast("⚠️","No puedes salir en pausa","Termina la pausa antes de fichar salida.");
          return;
        }

        const type = (cur.phase==="OUT" || cur.phase==="DONE") ? "IN" : "OUT";

        if (!validateNextAction(cur.phase, type)){
          toast("⚠️","Acción no válida", `Estado: ${cur.status}`);
          return;
        }

        const ok = await confirmIfNeeded(`${eventTypeLabel(type)} — ${emp.name}`, `¿Registrar ${eventTypeLabel(type).toLowerCase()} ahora?`);
        if (!ok) return;

        askNoteModal(`${eventTypeLabel(type)} — ${emp.name}`, (note)=>addEvent(emp.id, type, note));
      });

      // Pausa
      const btnBreak = document.createElement("button");
      btnBreak.type = "button";
      btnBreak.className = "btn";
      btnBreak.innerHTML = (d.phase==="BREAK")
        ? `<span class="ms">play_arrow</span> Fin pausa`
        : `<span class="ms">pause</span> Pausa`;

      btnBreak.disabled = (d.phase==="OUT" || d.phase==="DONE");
      btnBreak.addEventListener("click", async ()=>{
        const cur = computeDay(emp.id, dayKey);
        if (cur.phase==="OUT" || cur.phase==="DONE") return;

        const type = (cur.phase==="BREAK") ? "BREAK_END" : "BREAK_START";

        if (!validateNextAction(cur.phase, type)){
          toast("⚠️","Acción no válida", `Estado: ${cur.status}`);
          return;
        }

        const ok = await confirmIfNeeded(`${eventTypeLabel(type)} — ${emp.name}`, `¿Registrar ${eventTypeLabel(type).toLowerCase()} ahora?`);
        if (!ok) return;

        askNoteModal(`${eventTypeLabel(type)} — ${emp.name}`, (note)=>addEvent(emp.id, type, note));
      });

      // Opciones
      const btnMore = document.createElement("button");
      btnMore.type = "button";
      btnMore.className = "btn btn-ghost";
      btnMore.innerHTML = `<span class="ms">more_vert</span>`;
      btnMore.title = "Opciones";
      btnMore.addEventListener("click", ()=>{
        const wrap = document.createElement("div");
        wrap.style.display = "grid";
        wrap.style.gap = "10px";
        wrap.innerHTML = `<div class="muted">Acciones para <b>${escapeHtml(emp.name)}</b></div>`;

        const bEdit = mkBtn(`<span class="ms">edit</span> Editar empleado`,"btn", ()=>{ closeModal(); addOrEditEmployeeFlow(emp.id); });
        const bDel = mkBtn(`<span class="ms">delete</span> Borrar empleado`,"btn btn-danger", ()=>{ closeModal(); deleteEmployeeFlow(emp.id); });
        const bClose = mkBtn("Cerrar","btn btn-ghost", ()=>closeModal());

        openModal("Opciones", wrap, [bClose, bEdit, bDel]);
      });

      right.appendChild(btnClock);
      right.appendChild(btnBreak);
      right.appendChild(btnMore);

      frag.appendChild(el);
    }

    ui.employeeList.appendChild(frag);
  }

  function renderResumen(){
    ui.summaryBody.innerHTML = "";

    const dayKey = renderState.summaryDayKey || dateKeyLocal(now());
    const dowKey = dowKeyFromDateKey(dayKey);

    const frag = document.createDocumentFragment();

    for (const emp of state.employees){
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
      frag.appendChild(tr);
    }

    ui.summaryBody.appendChild(frag);
  }

  function fillEmpFilter(){
    const cur = ui.fEmp.value;
    ui.fEmp.innerHTML = "";

    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Todos";
    ui.fEmp.appendChild(all);

    for (const emp of state.employees){
      const o = document.createElement("option");
      o.value = emp.id;
      o.textContent = emp.name;
      ui.fEmp.appendChild(o);
    }
    if ([...ui.fEmp.options].some(o=>o.value===cur)) ui.fEmp.value = cur;
  }

  function filterEvents(){
    const empId = ui.fEmp.value || "";
    const from = ui.fFrom.value || "";
    const to = ui.fTo.value || "";

    const fromTs = from ? new Date(from+"T00:00:00").getTime() : null;
    const toTs = to ? new Date(to+"T23:59:59").getTime() : null;

    return state.events
      .slice()
      .sort((a,b)=>b.ts-a.ts)
      .filter(ev=>{
        if (empId && ev.empId!==empId) return false;
        if (fromTs!=null && ev.ts<fromTs) return false;
        if (toTs!=null && ev.ts>toTs) return false;
        return true;
      });
  }

  function renderHistorial(){
    fillEmpFilter();

    const allRows = filterEvents();
    const limit = renderState.historyLimit;
    const rows = allRows.slice(0, limit);

    renderState.historyLastRows = allRows;

    ui.eventsBody.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const ev of rows){
      const emp = getEmployee(ev.empId);
      const loc = ev.loc ? `${ev.loc.lat}, ${ev.loc.lon}` : "";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(dateKeyLocal(ev.ts))}</td>
        <td>${escapeHtml(timeHHMM(ev.ts))}</td>
        <td>${escapeHtml(emp ? emp.name : ev.empId)}</td>
        <td>${escapeHtml(eventTypeLabel(ev.type))}</td>
        <td>${escapeHtml(ev.note||"")}</td>
        <td class="mono">${escapeHtml(loc)}</td>
        <td class="mono">${escapeHtml((ev.hash||"").slice(0,16))}${(ev.hash||"") ? "…" : ""}</td>
      `;
      frag.appendChild(tr);
    }

    ui.eventsBody.appendChild(frag);

    ui.uiEventCount.textContent = `Mostrando ${rows.length} de ${allRows.length} evento(s).`;
    ui.btnLoadMore.hidden = (allRows.length <= limit);
  }

  function renderAjustes(){
    ui.uiVer.textContent = VERSION;

    ui.tglGeo.checked = !!state.settings.geoEnabled;
    ui.optTheme.value = state.settings.theme;
    ui.optAutoUpdate.checked = !!state.settings.autoUpdate;
    ui.optConfirmActions.checked = !!state.settings.confirmActions;
    ui.optNoteMode.value = state.settings.noteMode;
    ui.optCompact.checked = !!state.settings.compact;
    ui.optHaptics.checked = !!state.settings.haptics;

    document.body.classList.toggle("compact", !!state.settings.compact);

    ui.employeeAdminList.innerHTML = "";
    const frag = document.createDocumentFragment();

    const todayDow = dowKeyFromDateKey(dateKeyLocal(now()));

    for (const emp of state.employees){
      const d = document.createElement("div");
      d.className = "emp";
      d.innerHTML = `
        <div class="emp-left">
          <div class="avatar">${escapeHtml(initialsFromName(emp.name))}</div>
          <div class="emp-meta">
            <div class="emp-name">${escapeHtml(emp.name)}</div>
            <div class="emp-sub">
              <span class="pill">${escapeHtml(scheduleStr(emp, todayDow))}</span>
              <span class="pill off">ID: <span class="mono">${escapeHtml(emp.id.slice(0,8))}</span></span>
            </div>
          </div>
        </div>
        <div class="emp-right"></div>
      `;
      const right = $(".emp-right", d);
      right.appendChild(mkBtn(`<span class="ms">edit</span> Editar`,"btn", ()=>addOrEditEmployeeFlow(emp.id)));
      right.appendChild(mkBtn(`<span class="ms">delete</span> Borrar`,"btn btn-danger", ()=>deleteEmployeeFlow(emp.id)));
      frag.appendChild(d);
    }

    ui.employeeAdminList.appendChild(frag);
  }

  function renderAll(){
    ui.uiDate.textContent = prettyDateLong(now());
    ui.uiOffline.hidden = navigator.onLine;

    const active = ($$(".tab").find(t=>t.classList.contains("is-active"))?.dataset.route) || "panel";
    if (active==="panel") renderPanel();
    if (active==="resumen") renderResumen();
    if (active==="historial") renderHistorial();
    if (active==="ajustes") renderAjustes();
  }

  // ───────────────────────── Service Worker (AUTO-UPDATE sin loops) ─────────────────────────
  async function initSW(){
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.addEventListener("controllerchange", ()=>{
      if (sessionStorage.getItem(SW_RELOAD_GUARD)) return;
      sessionStorage.setItem(SW_RELOAD_GUARD, "1");
      location.reload();
    });

    try{
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });

      const showUpdate = ()=>{
        ui.btnUpdate.hidden = false;
        if (state.settings.autoUpdate){
          setTimeout(()=>{
            if (ui.modalBackdrop && !ui.modalBackdrop.hidden) return;
            applyUpdate(reg);
          }, 700);
        }
      };

      if (reg.waiting) showUpdate();

      reg.addEventListener("updatefound", ()=>{
        const inst = reg.installing;
        if (!inst) return;
        inst.addEventListener("statechange", ()=>{
          if (inst.state === "installed" && navigator.serviceWorker.controller){
            showUpdate();
          }
        });
      });

      ui.btnUpdate.addEventListener("click", ()=>applyUpdate(reg));

      const softUpdate = async ()=>{
        try{
          if (navigator.onLine) await reg.update();
        }catch(_){}
      };

      setTimeout(softUpdate, 1200);
      setInterval(softUpdate, 30 * 60 * 1000);

      document.addEventListener("visibilitychange", ()=>{
        if (!document.hidden) softUpdate();
      });

    }catch(_){}
  }

  function applyUpdate(reg){
    try{
      ui.btnUpdate.disabled = true;
      if (reg.waiting) reg.waiting.postMessage({type:"SKIP_WAITING"});
      setTimeout(()=>{ ui.btnUpdate.disabled = false; }, 1500);
    }catch(_){
      ui.btnUpdate.disabled = false;
    }
  }

  // ───────────────────────── Boot bindings ─────────────────────────
  function bindOptionHandlers(){
    ui.optTheme.addEventListener("change", ()=>{
      state.settings.theme = ui.optTheme.value;
      saveState();
      applyTheme();
      toast("🎨", "Tema actualizado", state.settings.theme === "system" ? "Sistema" : state.settings.theme);
    });

    ui.optAutoUpdate.addEventListener("change", ()=>{
      state.settings.autoUpdate = ui.optAutoUpdate.checked;
      saveState();
      toast("🔁", state.settings.autoUpdate ? "Auto-update activado" : "Auto-update desactivado");
    });

    ui.optConfirmActions.addEventListener("change", ()=>{
      state.settings.confirmActions = ui.optConfirmActions.checked;
      saveState();
      toast("✅", state.settings.confirmActions ? "Confirmaciones activadas" : "Confirmaciones desactivadas");
    });

    ui.optNoteMode.addEventListener("change", ()=>{
      state.settings.noteMode = ui.optNoteMode.value;
      saveState();
      toast("📝", "Notas al fichar", state.settings.noteMode === "ask" ? "Preguntar" : "Nunca");
    });

    ui.optCompact.addEventListener("change", ()=>{
      state.settings.compact = ui.optCompact.checked;
      saveState();
      renderAll();
      toast("📐", state.settings.compact ? "Modo compacto ON" : "Modo compacto OFF");
    });

    ui.optHaptics.addEventListener("change", ()=>{
      state.settings.haptics = ui.optHaptics.checked;
      saveState();
      vibrate(18);
      toast("📳", state.settings.haptics ? "Vibración ON" : "Vibración OFF");
    });

    ui.tglGeo.addEventListener("change", ()=>{
      state.settings.geoEnabled = ui.tglGeo.checked;
      saveState();
      toast("📍", state.settings.geoEnabled ? "Geolocalización activada" : "Geolocalización desactivada");
    });
  }

  function bindSummaryDateControls(){
    function clampDate(dk){
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return dateKeyLocal(now());
      return dk;
    }

    ui.sumDate.value = renderState.summaryDayKey;

    ui.sumDate.addEventListener("change", ()=>{
      renderState.summaryDayKey = clampDate(ui.sumDate.value);
      renderAll();
    });

    ui.btnSumPrev.addEventListener("click", ()=>{
      const d = new Date(renderState.summaryDayKey + "T12:00:00");
      d.setDate(d.getDate() - 1);
      renderState.summaryDayKey = dateKeyLocal(d.getTime());
      ui.sumDate.value = renderState.summaryDayKey;
      renderAll();
    });

    ui.btnSumNext.addEventListener("click", ()=>{
      const d = new Date(renderState.summaryDayKey + "T12:00:00");
      d.setDate(d.getDate() + 1);
      renderState.summaryDayKey = dateKeyLocal(d.getTime());
      ui.sumDate.value = renderState.summaryDayKey;
      renderAll();
    });
  }

  function bindGlobalGuards(){
    window.addEventListener("error", (e)=>{
      try{
        console.error(e.error || e.message);
        fatalScreen("Error inesperado", (e.error && e.error.stack) ? e.error.stack : String(e.message || e.error || e));
      }catch(_){}
    });

    window.addEventListener("unhandledrejection", (e)=>{
      try{
        console.error(e.reason);
        fatalScreen("Promesa rechazada", (e.reason && e.reason.stack) ? e.reason.stack : String(e.reason));
      }catch(_){}
    });
  }

  // ───────────────────────── DOM Ready ─────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    try {
      // refs splash
      ui.splash = $("#splash");
      ui.splashMsg = $("#splashMsg");
      ui.splashVer = $("#splashVer");
      if (ui.splashVer) ui.splashVer.textContent = VERSION;

      setSplash("Inicializando…");

      // UI refs core
      ui.appMain = $("#appMain");

      ui.uiDate = $("#uiDate");
      ui.uiCounts = $("#uiCounts");
      ui.uiOffline = $("#uiOffline");
      ui.uiVer = $("#uiVer");

      ui.employeeList = $("#employeeList");
      ui.employeeAdminList = $("#employeeAdminList");

      ui.summaryBody = $("#summaryTable tbody");
      ui.eventsBody = $("#eventsTable tbody");

      ui.fEmp = $("#fEmp");
      ui.fFrom = $("#fFrom");
      ui.fTo = $("#fTo");

      ui.btnUpdate = $("#btnUpdate");
      ui.btnLoadMore = $("#btnLoadMore");
      ui.uiEventCount = $("#uiEventCount");

      ui.tglGeo = $("#tglGeo");

      ui.modalBackdrop = $("#modalBackdrop");
      ui.modalTitle = $("#modalTitle");
      ui.modalBody = $("#modalBody");
      ui.modalActions = $("#modalActions");

      ui.optTheme = $("#optTheme");
      ui.optAutoUpdate = $("#optAutoUpdate");
      ui.optConfirmActions = $("#optConfirmActions");
      ui.optNoteMode = $("#optNoteMode");
      ui.optCompact = $("#optCompact");
      ui.optHaptics = $("#optHaptics");

      ui.sumDate = $("#sumDate");
      ui.btnSumPrev = $("#btnSumPrev");
      ui.btnSumNext = $("#btnSumNext");

      ui.toasts = $("#toasts");

      // Extra buttons
      ui.btnExportResumen = $("#btnExportResumen");
      ui.btnExportEventos = $("#btnExportEventos");
      ui.btnApplyFilters = $("#btnApplyFilters");
      ui.btnClearFilters = $("#btnClearFilters");
      ui.btnBackup = $("#btnBackup");
      ui.btnRestore = $("#btnRestore");
      ui.btnWipe = $("#btnWipe");
      ui.btnSetPin = $("#btnSetPin");
      ui.btnClearPin = $("#btnClearPin");
      ui.btnAddEmp = $("#btnAddEmp");
      ui.btnQuickAdd = $("#btnQuickAdd");
      ui.fabAdd = $("#fabAdd");
      ui.filePicker = $("#filePicker");
      ui.modalClose = $("#modalClose");

      const required = [
        ui.uiDate, ui.uiCounts, ui.uiOffline, ui.uiVer,
        ui.employeeList, ui.employeeAdminList,
        ui.summaryBody, ui.eventsBody,
        ui.fEmp, ui.fFrom, ui.fTo,
        ui.btnUpdate, ui.btnLoadMore, ui.uiEventCount,
        ui.tglGeo,
        ui.modalBackdrop, ui.modalTitle, ui.modalBody, ui.modalActions,
        ui.optTheme, ui.optAutoUpdate, ui.optConfirmActions, ui.optNoteMode, ui.optCompact, ui.optHaptics,
        ui.sumDate, ui.btnSumPrev, ui.btnSumNext,
        ui.btnExportResumen, ui.btnExportEventos,
        ui.btnApplyFilters, ui.btnClearFilters,
        ui.btnBackup, ui.btnRestore, ui.btnWipe,
        ui.btnSetPin, ui.btnClearPin,
        ui.btnAddEmp, ui.btnQuickAdd, ui.fabAdd,
        ui.filePicker, ui.modalClose
      ];
      if (required.some(x=>!x)) throw new Error("Faltan elementos en index.html (IDs/estructura incorrecta).");

      // modal close
      ui.modalClose.addEventListener("click", closeModal);
      initModalGuards();

      // state
      setSplash("Cargando datos…");
      state = loadState();

      // theme
      applyTheme();
      hookThemeListener();

      // tabs
      $$(".tab").forEach(btn => btn.addEventListener("click", ()=>setRoute(btn.dataset.route)));

      // add employee
      const openAdd = ()=>addOrEditEmployeeFlow(null);
      ui.btnQuickAdd.addEventListener("click", openAdd);
      ui.btnAddEmp.addEventListener("click", openAdd);
      ui.fabAdd.addEventListener("click", openAdd);

      // export
      ui.btnExportResumen.addEventListener("click", exportResumenCSV);
      ui.btnExportEventos.addEventListener("click", ()=>exportEventosCSV(renderState.historyLastRows || null));

      // filters
      ui.btnApplyFilters.addEventListener("click", ()=>{
        renderState.historyLimit = MAX_EVENTS_STEP;
        renderHistorial();
      });

      ui.btnClearFilters.addEventListener("click", ()=>{
        ui.fEmp.value = "";
        ui.fFrom.value = "";
        ui.fTo.value = "";
        renderState.historyLimit = MAX_EVENTS_STEP;
        renderHistorial();
      });

      ui.btnLoadMore.addEventListener("click", ()=>{
        renderState.historyLimit += MAX_EVENTS_STEP;
        renderHistorial();
      });

      // backup/restore
      ui.btnBackup.addEventListener("click", backupJSON);

      ui.btnRestore.addEventListener("click", async ()=>{
        const ok = await requirePinIfSet("Importar backup JSON está protegido por PIN (si está activo).");
        if (!ok) return;
        ui.filePicker.value = "";
        ui.filePicker.click();
      });

      ui.filePicker.addEventListener("change", ()=>{
        const file = ui.filePicker.files && ui.filePicker.files[0];
        if (!file) return;
        restoreJSON(file);
      });

      // wipe
      ui.btnWipe.addEventListener("click", wipeAll);

      // pin
      ui.btnSetPin.addEventListener("click", setPinFlow);
      ui.btnClearPin.addEventListener("click", clearPinFlow);

      // settings
      bindOptionHandlers();
      bindSummaryDateControls();

      // offline badge
      window.addEventListener("online", ()=>{ ui.uiOffline.hidden = true; renderAll(); });
      window.addEventListener("offline", ()=>{ ui.uiOffline.hidden = false; renderAll(); });

      // initial render
      setSplash("Preparando interfaz…");
      renderState.summaryDayKey = dateKeyLocal(now());
      ui.sumDate.value = renderState.summaryDayKey;
      renderAll();

      // SW
      initSW();

      // refresco suave (panel/resumen)
      setInterval(()=>{
        const active = ($$(".tab").find(t=>t.classList.contains("is-active"))?.dataset.route) || "panel";
        if (active==="panel" || active==="resumen") renderAll();
      }, 15000);

      // done
      setTimeout(()=>hideSplash(), 250);

    } catch (e) {
      console.error(e);
      fatalScreen("La app falló al iniciar", (e && e.stack) ? e.stack : String(e));
    }
  });

  // guards global
  bindGlobalGuards();

})();
