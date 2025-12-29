/* app.js — ClockIn v1.0.0 (ESTABLE) */
(() => {
  "use strict";

  const VERSION = String((typeof window !== "undefined" && window.APP_VERSION) || "1.0.0");
  const STORAGE_KEY = "clockin_state_v1";

  const DOW_KEYS = ["sun","mon","tue","wed","thu","fri","sat"];
  const DOW_LABEL = { mon:"Lun", tue:"Mar", wed:"Mié", thu:"Jue", fri:"Vie", sat:"Sáb", sun:"Dom" };

  const MAX_EVENTS_STEP = 300;

  const CR = (typeof globalThis !== "undefined" && globalThis.crypto) ? globalThis.crypto : null;

  function $(sel, root=document){ return root.querySelector(sel); }
  function $$(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
  function pad2(n){ return String(n).padStart(2,"0"); }

  function safeReplaceAll(s, a, b) {
    s = String(s);
    if (typeof s.replaceAll === "function") return s.replaceAll(a, b);
    return s.split(a).join(b);
  }

  function escapeHtml(s){
    s = String(s ?? "");
    s = safeReplaceAll(s, "&", "&amp;");
    s = safeReplaceAll(s, "<", "&lt;");
    s = safeReplaceAll(s, ">", "&gt;");
    s = safeReplaceAll(s, '"', "&quot;");
    s = safeReplaceAll(s, "'", "&#39;");
    return s;
  }

  function fatalScreen(title, details){
    try {
      const mb = document.getElementById("modalBackdrop");
      if (mb) mb.hidden = true;
    } catch(_) {}
    try { document.body.style.overflow = "auto"; } catch(_) {}

    const main = $(".main");
    if (!main) { alert(title + "\n\n" + details); return; }
    main.innerHTML = `
      <div class="card">
        <div class="card-title">⛔ ${escapeHtml(title)}</div>
        <div class="muted small" style="white-space:pre-wrap">${escapeHtml(details)}</div>
        <div class="row" style="margin-top:12px">
          <a class="btn btn-ghost" href="./?repair">Repair (borra caché/SW)</a>
          <button class="btn btn-primary" id="btnReload">Recargar</button>
        </div>
      </div>
    `;
    const r = $("#btnReload");
    if (r) r.addEventListener("click", () => location.reload());
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
  function timeHHMM(ms){
    const d = new Date(ms);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function prettyDateLong(ms){
    try { return new Intl.DateTimeFormat("es-ES",{weekday:"long",year:"numeric",month:"long",day:"numeric"}).format(new Date(ms)); }
    catch(_) { return dateKeyLocal(ms); }
  }
  function fmtDuration(ms){
    ms = Math.max(0, ms|0);
    const m = Math.floor(ms/60000);
    const h = Math.floor(m/60);
    const mm = m%60;
    return h<=0 ? `${mm} min` : `${h} h ${mm} min`;
  }
  function todayDowKey(){ return DOW_KEYS[new Date().getDay()]; }

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
      const v = sch && sch[k] ? sch[k] : def[k];
      out[k] = { off: !!v.off, start: v.start ? String(v.start) : "", end: v.end ? String(v.end) : "" };
    }
    return out;
  }

  function makeDefaultState(){
    const a = { id: uid(), name: "Empleado 1", schedule: makeDefaultSchedule(), createdAt: now() };
    const b = { id: uid(), name: "Empleado 2", schedule: makeDefaultSchedule(), createdAt: now() };
    return {
      version: VERSION,
      settings: { geoEnabled:false },
      security: { pin: null }, // {saltB64, iter, hashB64}
      employees: [a,b],
      events: [] // {id, empId, type, ts, note, loc, hash}
    };
  }

  function normalizeState(s){
    const st = (s && typeof s === "object") ? s : makeDefaultState();
    st.version = VERSION;

    if (!st.settings || typeof st.settings !== "object") st.settings = { geoEnabled:false };
    st.settings.geoEnabled = !!st.settings.geoEnabled;

    if (!st.security || typeof st.security !== "object") st.security = { pin:null };
    if (st.security.pin && (!st.security.pin.saltB64 || !st.security.pin.hashB64)) st.security.pin = null;

    if (!Array.isArray(st.employees)) st.employees = [];
    st.employees = st.employees
      .filter(e => e && e.id && e.name)
      .map(e => ({ id:String(e.id), name:String(e.name), schedule: normalizeSchedule(e.schedule), createdAt: Number(e.createdAt||now()) }));
    if (!st.employees.length) st.employees = makeDefaultState().employees;

    if (!Array.isArray(st.events)) st.events = [];
    st.events = st.events
      .filter(ev => ev && ev.id && ev.empId && ev.type && ev.ts)
      .map(ev => ({
        id:String(ev.id),
        empId:String(ev.empId),
        type:String(ev.type),
        ts:Number(ev.ts),
        note: ev.note ? String(ev.note) : "",
        loc: ev.loc && typeof ev.loc === "object" ? { lat:Number(ev.loc.lat), lon:Number(ev.loc.lon) } : null,
        hash: ev.hash ? String(ev.hash) : ""
      }));

    return st;
  }

  function loadState(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return makeDefaultState();
      return normalizeState(JSON.parse(raw));
    } catch(_) {
      return makeDefaultState();
    }
  }

  function saveState(){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("⛔", "No se pudo guardar", "El almacenamiento está bloqueado (modo privado/permisos).");
    }
  }

  let state = null;

  // ───────────────────────── Crypto helpers (PIN + Hash) ─────────────────────────
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

  // ───────────────────────── UI helpers ─────────────────────────
  function toast(icon, msg, sub){
    const zone = $("#toasts");
    if (!zone) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `
      <div class="ticon">${icon||"ℹ️"}</div>
      <div>
        <div class="tmsg">${escapeHtml(msg)}</div>
        ${sub ? `<div class="tsub">${escapeHtml(sub)}</div>` : ""}
      </div>
    `;
    zone.appendChild(el);
    setTimeout(()=>{ el.style.opacity="0"; el.style.transform="translateY(6px)"; }, 2400);
    setTimeout(()=>{ el.remove(); }, 2900);
  }

  const modalBackdrop = () => $("#modalBackdrop");
  const modalTitle = () => $("#modalTitle");
  const modalBody = () => $("#modalBody");
  const modalActions = () => $("#modalActions");

  function mkBtn(label, cls, onClick){
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls || "btn";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function openModal(title, bodyNode, actions){
    modalTitle().textContent = title || "—";
    modalBody().innerHTML = "";
    modalBody().appendChild(bodyNode);
    modalActions().innerHTML = "";
    (actions||[]).forEach(a => modalActions().appendChild(a));
    const mb = modalBackdrop();
    if (mb) mb.hidden = false;
  }
  function closeModal(){
    const mb = modalBackdrop();
    if (mb) mb.hidden = true;
  }

  function initialsFromName(name){
    const parts = String(name||"").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "??";
    const a = parts[0][0] || "?";
    const b = parts.length>1 ? (parts[parts.length-1][0]||"") : (parts[0][1]||"");
    return (a+b).toUpperCase();
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

  function askNoteModal(title, onOk){
    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.innerHTML = `
      <span>Nota (opcional)</span>
      <textarea id="mNote" placeholder="Ej: médico, reunión, incidencia..."></textarea>
      <div class="small muted">Se guarda junto al evento.</div>
    `;
    const ta = $("#mNote", wrap);

    const bCancel = mkBtn("Cancelar","btn btn-ghost", ()=>closeModal());
    const bNo = mkBtn("Guardar sin nota","btn btn-ghost", ()=>{ closeModal(); onOk(""); });
    const bOk = mkBtn("Guardar","btn btn-primary", ()=>{ closeModal(); onOk(ta.value||""); });

    openModal(title, wrap, [bCancel,bNo,bOk]);
    setTimeout(()=>ta && ta.focus(),0);
  }

  async function addEvent(empId, type, note){
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

    try { ev.hash = await makeEventHash(ev, lastHash()); } catch(_) { ev.hash = ""; }

    state.events.push(ev);
    saveState();
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
        <div class="small muted">${escapeHtml(reasonText||"Acción protegida")}</div>
      `;
      const pin = $("#mPin", wrap);

      const bCancel = mkBtn("Cancelar","btn btn-ghost", ()=>{ closeModal(); resolve(false); });
      const bOk = mkBtn("Verificar","btn btn-primary", async ()=>{
        const ok = await verifyPin(pin.value||"");
        if (!ok) { toast("⛔","PIN incorrecto"); return; }
        closeModal();
        resolve(true);
      });

      openModal("Seguridad", wrap, [bCancel,bOk]);
      setTimeout(()=>pin && pin.focus(),0);
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
    const bOk = mkBtn("Guardar PIN","btn btn-primary", async ()=>{
      const a = (p1.value||"").trim();
      const b = (p2.value||"").trim();
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
    setTimeout(()=>p1 && p1.focus(),0);
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
    const bSave = mkBtn(isEdit ? "Guardar cambios" : "Crear empleado","btn btn-primary", ()=>{
      const name = (nameInput.value||"").trim();
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
    setTimeout(()=>nameInput && nameInput.focus(),0);
  }

  async function deleteEmployeeFlow(empId){
    const emp = getEmployee(empId);
    if (!emp) return;

    const ok = await requirePinIfSet("Borrar empleado y sus eventos requiere PIN (si está activo).");
    if (!ok) return;

    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="muted">Se borrará <b>${escapeHtml(emp.name)}</b> y todos sus eventos.</div>`;

    const bCancel = mkBtn("Cancelar","btn btn-ghost", ()=>closeModal());
    const bDel = mkBtn("Borrar","btn btn-danger", ()=>{
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
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${safeReplaceAll(s, '"', '""')}"`;
    return s;
  }

  async function exportResumenCSV(){
    const ok = await requirePinIfSet("Exportar CSV está protegido por PIN (si está activo).");
    if (!ok) return;

    const dayKey = dateKeyLocal(now());
    const dowKey = todayDowKey();

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
    const ok = await requirePinIfSet("Exportar copia JSON está protegido por PIN (si está activo).");
    if (!ok) return;

    downloadText(`clockin_backup_${dateKeyLocal(now())}.json`, JSON.stringify(state, null, 2), "application/json;charset=utf-8");
    toast("⬇️","Copia JSON exportada");
  }

  async function restoreJSON(file){
    const ok = await requirePinIfSet("Importar copia JSON está protegido por PIN (si está activo).");
    if (!ok) return;

    const text = await file.text();
    let parsed;
    try { parsed = JSON.parse(text); }
    catch(_) { toast("⛔","JSON inválido"); return; }

    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="muted">Vas a reemplazar los datos actuales por la copia importada.</div>`;
    const bCancel = mkBtn("Cancelar","btn btn-ghost", ()=>closeModal());
    const bOk = mkBtn("Importar","btn btn-primary", ()=>{
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
    const bOk = mkBtn("Borrar todo","btn btn-danger", ()=>{
      try { localStorage.removeItem(STORAGE_KEY); } catch(_) {}
      closeModal();
      location.reload();
    });
    openModal("Confirmar borrado total", wrap, [bCancel,bOk]);
  }

  // ───────────────────────── Rendering + Routing ─────────────────────────
  const ui = {};
  const renderState = { historyLimit: MAX_EVENTS_STEP, historyLastRows: [] };

  function ensureHistoryFooter(){
    const hist = $("#view-historial");
    if (!hist) return;

    // Si ya existe en HTML, perfecto.
    let count = $("#uiEventCount", hist);
    let load = $("#btnLoadMore", hist);

    // Si falta, lo creamos dentro del último card del historial.
    if (!count || !load){
      let footer = $("#historyFooter", hist);
      if (!footer){
        footer = document.createElement("div");
        footer.id = "historyFooter";
        footer.className = "row row-between";
        footer.style.marginTop = "12px";
        footer.innerHTML = `
          <span class="badge badge-soft" id="uiEventCount">—</span>
          <button class="btn btn-ghost" id="btnLoadMore" hidden>Cargar más</button>
        `;
        const cards = $$(".card", hist);
        const target = cards.length ? cards[cards.length - 1] : hist;
        target.appendChild(footer);
      }
      count = $("#uiEventCount", hist);
      load = $("#btnLoadMore", hist);
    }

    ui.uiEventCount = count || null;
    ui.btnLoadMore = load || null;
  }

  function setRoute(route){
    $$(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.route===route));
    $$(".view").forEach(v => v.hidden = (v.dataset.route!==route));
    renderAll();
  }

  function renderPanel(){
    ui.employeeList.innerHTML = "";
    const dayKey = dateKeyLocal(now());
    const dowKey = todayDowKey();

    ui.uiCounts.textContent = `${state.employees.length} empleado(s)`;

    for (const emp of state.employees){
      const d = computeDay(emp.id, dayKey);
      const el = document.createElement("div");
      el.className = "emp";

      const pills = [
        `<span class="pill ${d.phase==="IN"?"ok":d.phase==="BREAK"?"warn":d.phase==="DONE"?"off":""}">${escapeHtml(d.status)}</span>`,
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

      const btnClock = document.createElement("button");
      btnClock.className = "btn btn-primary";
      btnClock.textContent = (d.phase==="OUT" || d.phase==="DONE") ? "Entrada" : "Salida";
      btnClock.addEventListener("click", ()=>{
        const cur = computeDay(emp.id, dayKey);
        if (cur.phase==="BREAK"){ toast("⚠️","Termina la pausa antes de salir"); return; }
        const type = (cur.phase==="OUT" || cur.phase==="DONE") ? "IN" : "OUT";
        askNoteModal(`${eventTypeLabel(type)} — ${emp.name}`, (note)=>addEvent(emp.id, type, note));
      });

      const btnBreak = document.createElement("button");
      btnBreak.className = "btn";
      btnBreak.textContent = (d.phase==="BREAK") ? "Fin pausa" : "Pausa";
      btnBreak.disabled = (d.phase==="OUT" || d.phase==="DONE");
      btnBreak.addEventListener("click", ()=>{
        const cur = computeDay(emp.id, dayKey);
        if (cur.phase==="OUT" || cur.phase==="DONE") return;
        const type = (cur.phase==="BREAK") ? "BREAK_END" : "BREAK_START";
        askNoteModal(`${eventTypeLabel(type)} — ${emp.name}`, (note)=>addEvent(emp.id, type, note));
      });

      right.appendChild(btnClock);
      right.appendChild(btnBreak);

      ui.employeeList.appendChild(el);
    }
  }

  function renderResumen(){
    ui.summaryBody.innerHTML = "";
    const dayKey = dateKeyLocal(now());
    const dowKey = todayDowKey();

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
      ui.summaryBody.appendChild(tr);
    }
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
    ensureHistoryFooter();
    fillEmpFilter();

    const allRows = filterEvents();
    const limit = renderState.historyLimit;
    const rows = allRows.slice(0, limit);

    renderState.historyLastRows = allRows;

    ui.eventsBody.innerHTML = "";
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
      ui.eventsBody.appendChild(tr);
    }

    if (ui.uiEventCount) ui.uiEventCount.textContent = `Mostrando ${rows.length} de ${allRows.length} evento(s).`;
    if (ui.btnLoadMore) ui.btnLoadMore.hidden = (allRows.length <= limit);
  }

  function renderAjustes(){
    ui.uiVer.textContent = VERSION;
    ui.tglGeo.checked = !!state.settings.geoEnabled;

    ui.employeeAdminList.innerHTML = "";
    for (const emp of state.employees){
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
      right.appendChild(mkBtn("Editar","btn", ()=>addOrEditEmployeeFlow(emp.id)));
      right.appendChild(mkBtn("Borrar","btn btn-danger", ()=>deleteEmployeeFlow(emp.id)));
      ui.employeeAdminList.appendChild(d);
    }
  }

  function renderAll(){
    if (ui.uiDate) ui.uiDate.textContent = prettyDateLong(now());
    if (ui.uiOffline) ui.uiOffline.hidden = navigator.onLine;

    const active = ($$(".tab").find(t=>t.classList.contains("is-active"))?.dataset.route) || "panel";
    if (active==="panel") renderPanel();
    if (active==="resumen") renderResumen();
    if (active==="historial") renderHistorial();
    if (active==="ajustes") renderAjustes();
  }

  // ───────────────────────── Service Worker (update pill sin bucles) ─────────────────────────
  async function initSW(){
    if (!("serviceWorker" in navigator)) return;
    if (!ui.btnUpdate) return;

    const btn = ui.btnUpdate;
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      if (reg.waiting) btn.hidden = false;

      reg.addEventListener("updatefound", ()=>{
        const inst = reg.installing;
        if (!inst) return;
        inst.addEventListener("statechange", ()=>{
          if (inst.state==="installed" && navigator.serviceWorker.controller) btn.hidden = false;
        });
      });

      btn.addEventListener("click", ()=>{
        try {
          btn.disabled = true;
          if (reg.waiting) reg.waiting.postMessage({type:"SKIP_WAITING"});
          setTimeout(()=>location.reload(), 250);
        } catch(_) {
          btn.disabled = false;
        }
      });
    } catch(_) {}
  }

  // ───────────────────────── Boot ─────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    try {
      // cache UI refs (requeridos)
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
      ui.tglGeo = $("#tglGeo");

      // Validación mínima para NO quedarse pillado
      const required = [
        ["#employeeList", ui.employeeList],
        ["#employeeAdminList", ui.employeeAdminList],
        ["#summaryTable tbody", ui.summaryBody],
        ["#eventsTable tbody", ui.eventsBody],
        ["#fEmp", ui.fEmp],
        ["#fFrom", ui.fFrom],
        ["#fTo", ui.fTo],
        ["#tglGeo", ui.tglGeo],
      ];
      for (const [sel, el] of required){
        if (!el) throw new Error(`Falta el elemento ${sel} en index.html (ID/estructura incorrecta).`);
      }

      // modal events
      const mClose = $("#modalClose");
      const mBack = $("#modalBackdrop");
      if (mClose) mClose.addEventListener("click", closeModal);
      if (mBack) mBack.addEventListener("click", (e)=>{ if (e.target===mBack) closeModal(); });

      // state
      state = loadState();

      // tabs
      $$(".tab").forEach(btn => btn.addEventListener("click", ()=>setRoute(btn.dataset.route)));

      // actions (con guards)
      const btnQuickAdd = $("#btnQuickAdd");
      if (btnQuickAdd) btnQuickAdd.addEventListener("click", ()=>addOrEditEmployeeFlow(null));

      const btnAddEmp = $("#btnAddEmp");
      if (btnAddEmp) btnAddEmp.addEventListener("click", ()=>addOrEditEmployeeFlow(null));

      const btnExportResumen = $("#btnExportResumen");
      if (btnExportResumen) btnExportResumen.addEventListener("click", exportResumenCSV);

      const btnExportEventos = $("#btnExportEventos");
      if (btnExportEventos) btnExportEventos.addEventListener("click", ()=>exportEventosCSV(renderState.historyLastRows || null));

      const btnApplyFilters = $("#btnApplyFilters");
      if (btnApplyFilters) btnApplyFilters.addEventListener("click", ()=>{
        renderState.historyLimit = MAX_EVENTS_STEP;
        renderHistorial();
      });

      ensureHistoryFooter();
      if (ui.btnLoadMore){
        ui.btnLoadMore.addEventListener("click", ()=>{
          renderState.historyLimit += MAX_EVENTS_STEP;
          renderHistorial();
        });
      }

      const btnBackup = $("#btnBackup");
      if (btnBackup) btnBackup.addEventListener("click", backupJSON);

      const filePicker = $("#filePicker");
      const btnRestore = $("#btnRestore");
      if (btnRestore && filePicker){
        btnRestore.addEventListener("click", async ()=>{
          const ok = await requirePinIfSet("Importar copia JSON está protegido por PIN (si está activo).");
          if (!ok) return;
          filePicker.value = "";
          filePicker.click();
        });
        filePicker.addEventListener("change", async ()=>{
          const file = filePicker.files && filePicker.files[0];
          if (!file) return;
          restoreJSON(file);
        });
      }

      const btnWipe = $("#btnWipe");
      if (btnWipe) btnWipe.addEventListener("click", wipeAll);

      const btnSetPin = $("#btnSetPin");
      if (btnSetPin) btnSetPin.addEventListener("click", setPinFlow);

      const btnClearPin = $("#btnClearPin");
      if (btnClearPin) btnClearPin.addEventListener("click", clearPinFlow);

      ui.tglGeo.addEventListener("change", ()=>{
        state.settings.geoEnabled = ui.tglGeo.checked;
        saveState();
        toast("📍", state.settings.geoEnabled ? "Geolocalización activada" : "Geolocalización desactivada");
      });

      window.addEventListener("online", ()=>{ if (ui.uiOffline) ui.uiOffline.hidden = true; });
      window.addEventListener("offline", ()=>{ if (ui.uiOffline) ui.uiOffline.hidden = false; });

      renderAll();
      initSW();

      // refresco suave para tiempos
      setInterval(()=>{
        const active = ($$(".tab").find(t=>t.classList.contains("is-active"))?.dataset.route) || "panel";
        if (active==="panel" || active==="resumen") renderAll();
      }, 15000);

    } catch (e) {
      console.error(e);
      fatalScreen("La app falló al iniciar", (e && e.stack) ? e.stack : String(e));
    }
  });

})();
