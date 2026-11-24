"use strict";
// =====================================================================
//  BLOCCHI
// =====================================================================
const H = { act: 210, sens: 160, ctl: 20, extra: 290 };
Blockly.common.defineBlocksWithJsonArray([
  { type:"bb_start", message0:"▶ quando premo AVVIA", nextStatement:null, colour:120, tooltip:"Il programma parte da qui." },
  { type:"bb_servo", message0:"inclina la trave a %1 gradi", args0:[{type:"input_value",name:"V",check:"Number"}],
    previousStatement:null, nextStatement:null, colour:H.act, tooltip:"Angolo positivo = la palla rotola verso valori di posizione più grandi (se calibrato)." },
  { type:"bb_wait", message0:"aspetta %1 secondi", args0:[{type:"input_value",name:"V",check:"Number"}],
    previousStatement:null, nextStatement:null, colour:H.act },
  { type:"bb_say", message0:"mostra %1", args0:[{type:"input_value",name:"V"}],
    previousStatement:null, nextStatement:null, colour:H.act, tooltip:"Scrive un valore nei messaggi." },
  { type:"bb_until", message0:"attendi finché %1", args0:[{type:"input_value",name:"C",check:"Boolean"}],
    previousStatement:null, nextStatement:null, colour:H.ctl },
  { type:"bb_forever", message0:"per sempre %1", args0:[{type:"input_statement",name:"DO"}],
    previousStatement:null, colour:H.ctl },
  { type:"bb_setpoint", message0:"obiettivo palla a %1 cm", args0:[{type:"input_value",name:"V",check:"Number"}],
    previousStatement:null, nextStatement:null, colour:H.extra, tooltip:"Dove vuoi che il PID porti la palla (distanza dal sensore)." },
  { type:"bb_pid", message0:"attiva PID  Kp %1  Ki %2  Kd %3",
    args0:[{type:"input_value",name:"KP",check:"Number"},{type:"input_value",name:"KI",check:"Number"},{type:"input_value",name:"KD",check:"Number"}],
    previousStatement:null, nextStatement:null, colour:H.extra, inputsInline:true,
    tooltip:"Il PID resta attivo finché il programma gira. Alla fine del programma la trave torna orizzontale." },
  { type:"bb_pid_off", message0:"disattiva PID", previousStatement:null, nextStatement:null, colour:H.extra },
  { type:"bb_if_pos", message0:"se la palla è %1 %2 cm", args0:[
      { type:"field_dropdown", name:"OP", options:[["prima di","LT"],["oltre","GT"]] }, { type:"input_value", name:"X", check:"Number" } ],
    message1:"allora %1", args1:[{ type:"input_statement", name:"DO" }], message2:"altrimenti %1", args2:[{ type:"input_statement", name:"ELSE" }],
    previousStatement:null, nextStatement:null, colour:H.sens,
    tooltip:"Confronta la posizione della palla (distanza dal sensore) con un valore. Si incastra insieme agli altri blocchi di azione." },
  { type:"bb_until_pos", message0:"aspetta che la palla sia %1 %2 cm", args0:[
      { type:"field_dropdown", name:"OP", options:[["prima di","LT"],["oltre","GT"]] }, { type:"input_value", name:"X", check:"Number" } ],
    previousStatement:null, nextStatement:null, colour:H.sens,
    tooltip:"Il programma resta fermo finché la palla non arriva prima (o oltre) la distanza indicata." },
  { type:"bb_pos", message0:"posizione palla (cm)", output:"Number", colour:H.sens, tooltip:"Distanza della palla dal sensore." },
  { type:"bb_sp", message0:"obiettivo (cm)", output:"Number", colour:H.sens },
  { type:"bb_angle", message0:"angolo trave (gradi)", output:"Number", colour:H.sens },
  { type:"bb_time", message0:"tempo dall'avvio (s)", output:"Number", colour:H.sens },
]);

const num = (n) => ({ shadow: { type: "math_number", fields: { NUM: n } } });
const B = (type, inputs) => (inputs ? { kind:"block", type, inputs } : { kind:"block", type });

function toolboxFor(level) {
  const cats = [];
  cats.push({ kind:"category", name:"Azioni", colour:H.act, contents:[
    B("bb_servo",{V:num(0)}), B("bb_wait",{V:num(1)}), B("bb_say",{V:num(0)}) ]});
  cats.push({ kind:"category", name:"Sensori", colour:H.sens, contents:[
    B("bb_if_pos",{X:num(20)}), B("bb_until_pos",{X:num(20)}), B("bb_pos"), B("bb_time"), ...(level>=3 ? [B("bb_sp"), B("bb_angle")] : []) ]});
  const ctl = [ B("controls_repeat_ext",{TIMES:num(5)}), B("bb_forever") ];
  if (level>=2) ctl.push(B("controls_whileUntil"), B("bb_until"));
  cats.push({ kind:"category", name:"Cicli", colour:H.ctl, contents:ctl });
  if (level>=2) {
    cats.push({ kind:"category", name:"Logica", colour:210, contents:[
      B("controls_if"), B("logic_compare",{A:num(0),B:num(0)}), B("logic_operation"), B("logic_negate"), B("logic_boolean") ]});
    cats.push({ kind:"category", name:"Operazioni", colour:230, contents:[
      B("math_arithmetic",{A:num(1),B:num(1)}), B("math_single",{NUM:num(0)}) ]});
    cats.push({ kind:"category", name:"Variabili", colour:330, custom:"VARIABLE" });
  }
  cats.push({ kind:"category", name:"Numeri", colour:230, contents:[ B("math_number") ]});
  if (level>=3) {
    cats.push({ kind:"category", name:"Controllo PID", colour:H.extra, contents:[
      B("bb_setpoint",{V:num(20)}), B("bb_pid",{KP:num(2),KI:num(0),KD:num(1)}), B("bb_pid_off") ]});
  }
  return { kind:"categoryToolbox", contents:cats };
}

const ws = Blockly.inject("blocklyDiv", {
  toolbox: toolboxFor(3), renderer:"zelos", trashcan:true, sounds:false,
  zoom:{ controls:true, wheel:true, startScale:1.0, minScale:.5, maxScale:2 },
  grid:{ spacing:25, length:3, colour:"#e3e8ee", snap:true }, move:{ scrollbars:true, drag:true, wheel:false },
});
ws.addChangeListener(Blockly.Events.disableOrphans);

// ---------------- esempi e stato iniziale ----------------
const nb = (n) => ({ block:{ type:"math_number", fields:{ NUM:n } } });
function chain(arr) {                       // arr: [{type, inputs, ...}] -> catena con "next"
  let head = null;
  for (let i = arr.length - 1; i >= 0; i--) head = head ? { ...arr[i], next:{ block:head } } : { ...arr[i] };
  return head;
}
function startWith(blocks) {
  const first = chain(blocks);
  return { blocks:{ languageVersion:0, blocks:[ { type:"bb_start", x:40, y:40, deletable:false, ...(first ? { next:{ block:first } } : {}) } ] } };
}
const EXAMPLES = [
  { name:"1 · Inclina la trave", level:1, note:"La trave si inclina da una parte, poi dall'altra, poi torna orizzontale.",
    state: startWith([ { type:"bb_servo", inputs:{ V:nb(6) } }, { type:"bb_wait", inputs:{ V:nb(1) } },
      { type:"bb_servo", inputs:{ V:nb(-6) } }, { type:"bb_wait", inputs:{ V:nb(1) } }, { type:"bb_servo", inputs:{ V:nb(0) } } ]) },
  { name:"2 · Ripeti più volte", level:1, note:"Il blocco “ripeti” evita di copiare gli stessi blocchi tante volte.",
    state: startWith([ { type:"controls_repeat_ext", inputs:{ TIMES:nb(3), DO:{ block: chain([
      { type:"bb_servo", inputs:{ V:nb(8) } }, { type:"bb_wait", inputs:{ V:nb(0.5) } },
      { type:"bb_servo", inputs:{ V:nb(-8) } }, { type:"bb_wait", inputs:{ V:nb(0.5) } } ]) } } },
      { type:"bb_servo", inputs:{ V:nb(0) } } ]) },
  { name:"3 · Leggi il sensore", level:1, note:"Muovi la palla con la mano e guarda i numeri nei Messaggi: è la distanza dal sensore in cm.",
    state: startWith([ { type:"controls_repeat_ext", inputs:{ TIMES:nb(10), DO:{ block: chain([
      { type:"bb_say", inputs:{ V:{ block:{ type:"bb_pos" } } } }, { type:"bb_wait", inputs:{ V:nb(0.5) } } ]) } } } ]) },
  { name:"4 · Reagisci al sensore", level:1, note:"Se la palla è prima di 25 cm inclina da una parte, altrimenti dall'altra. Oscilla: capirai perché serve il PID.",
    state: startWith([ { type:"bb_forever", inputs:{ DO:{ block: chain([
      { type:"bb_if_pos", fields:{ OP:"LT" }, inputs:{ X:nb(25), DO:{ block:{ type:"bb_servo", inputs:{ V:nb(6) } } }, ELSE:{ block:{ type:"bb_servo", inputs:{ V:nb(-6) } } } } },
      { type:"bb_wait", inputs:{ V:nb(0.05) } } ]) } } } ]) },
  { name:"5 · Decidi con SE", level:2, note:"Se la palla è prima di 20 cm la spinge avanti, altrimenti indietro. Vedrai che oscilla: serve qualcosa di più furbo.",
    state: startWith([ { type:"bb_forever", inputs:{ DO:{ block: chain([
      { type:"controls_if", extraState:{ hasElse:true }, inputs:{
        IF0:{ block:{ type:"logic_compare", fields:{ OP:"LT" }, inputs:{ A:{ block:{ type:"bb_pos" } }, B:nb(20) } } },
        DO0:{ block:{ type:"bb_servo", inputs:{ V:nb(6) } } }, ELSE:{ block:{ type:"bb_servo", inputs:{ V:nb(-6) } } } } },
      { type:"bb_wait", inputs:{ V:nb(0.05) } } ]) } } } ]) },
  { name:"6 · Controllo proporzionale a mano", level:2, note:"Più la palla è lontana da 20 cm, più inclini la trave. Ma senza “frenare” la palla oscilla!",
    state: (() => { const st = startWith([ { type:"bb_forever", inputs:{ DO:{ block: chain([
      { type:"variables_set", fields:{ VAR:{ id:"v_err" } }, inputs:{ VALUE:{ block:{ type:"math_arithmetic", fields:{ OP:"MINUS" }, inputs:{ A:nb(20), B:{ block:{ type:"bb_pos" } } } } } } },
      { type:"bb_servo", inputs:{ V:{ block:{ type:"math_arithmetic", fields:{ OP:"MULTIPLY" }, inputs:{ A:{ block:{ type:"variables_get", fields:{ VAR:{ id:"v_err" } } } }, B:nb(1.5) } } } } },
      { type:"bb_wait", inputs:{ V:nb(0.05) } } ]) } } } ]);
      st.variables = [ { name:"errore", id:"v_err" } ]; return st; })() },
  { name:"7 · Tieni la palla con il PID", level:3, note:"Il PID fa da solo quello che hai provato a mano, e in più frena la palla (Kd).",
    state: startWith([ { type:"bb_setpoint", inputs:{ V:nb(20) } }, { type:"bb_pid", inputs:{ KP:nb(2), KI:nb(0), KD:nb(1) } },
      { type:"bb_forever", inputs:{ DO:{ block:{ type:"bb_wait", inputs:{ V:nb(0.1) } } } } } ]) },
  { name:"8 · PID tra due posizioni", level:3, note:"Ogni 6 secondi l'obiettivo cambia: la palla viene portata da 12 a 28 cm e ritorno.",
    state: startWith([ { type:"bb_pid", inputs:{ KP:nb(2), KI:nb(0), KD:nb(1) } },
      { type:"bb_forever", inputs:{ DO:{ block: chain([
        { type:"bb_setpoint", inputs:{ V:nb(12) } }, { type:"bb_wait", inputs:{ V:nb(6) } },
        { type:"bb_setpoint", inputs:{ V:nb(28) } }, { type:"bb_wait", inputs:{ V:nb(6) } } ]) } } } ]) },
];
function loadState(st) {
  Blockly.Events.disable();
  try { Blockly.serialization.workspaces.load(st, ws); } finally { Blockly.Events.enable(); }
  ensureStart(); saveLocal();
}
function ensureStart() {
  if (ws.getBlocksByType("bb_start", false).length === 0) {
    const b = ws.newBlock("bb_start"); b.initSvg(); b.render(); b.moveBy(40,40); b.setDeletable(false);
  }
}
function saveLocal() { try { localStorage.setItem("bb_ws", JSON.stringify(Blockly.serialization.workspaces.save(ws))); } catch(e) {} }
ws.addChangeListener((e) => { if (!e.isUiEvent) saveLocal(); });
(function init() {
  let st = null;
  try { st = JSON.parse(localStorage.getItem("bb_ws") || "null"); } catch(e) {}
  loadState(st || startWith([]));
})();

// =====================================================================
//  GENERATORE: blocchi -> programma JSON
// =====================================================================
class GenError extends Error {}
let blockIds = [];                         // indice istruzione -> id del blocco (per evidenziare)
const blockText = (b) => b.toString(40);
function flagBlock(b) { try { ws.centerOnBlock(b.id); b.select(); } catch (e) {} }
function problem(block, what) { flagBlock(block); throw new GenError("Nel blocco “" + blockText(block) + "” " + what); }
// valore collegato a un ingresso: se è vuoto spiega dove
function val(parent, name) {
  const t = parent.getInputTargetBlock(name);
  if (!t) problem(parent, "c'è un buco vuoto: riempilo con un numero o con un altro blocco.");
  return expr(t);
}
function expr(block) {
  const inp = (n) => val(block, n);
  switch (block.type) {
    case "math_number": return Number(block.getFieldValue("NUM"));
    case "logic_boolean": return block.getFieldValue("BOOL") === "TRUE" ? 1 : 0;
    case "bb_pos": return { o:"pos" };
    case "bb_sp": return { o:"sp" };
    case "bb_angle": return { o:"angle" };
    case "bb_time": return { o:"time" };
    case "variables_get": return { o:"var", n:varName(block) };
    case "logic_negate": return { o:"not", a:inp("BOOL") };
    case "logic_operation": return { o: block.getFieldValue("OP")==="AND" ? "and" : "or", a:inp("A"), b:inp("B") };
    case "logic_compare": {
      const m = { EQ:"==", NEQ:"!=", LT:"<", LTE:"<=", GT:">", GTE:">=" };
      return { o:"cmp", op:m[block.getFieldValue("OP")], a:inp("A"), b:inp("B") };
    }
    case "math_arithmetic": {
      const m = { ADD:"+", MINUS:"-", MULTIPLY:"*", DIVIDE:"/" };
      const op = m[block.getFieldValue("OP")];
      if (!op) problem(block, "questa operazione non è disponibile: usa + − × ÷.");
      return { o:"bin", op, a:inp("A"), b:inp("B") };
    }
    case "math_single": {
      const op = block.getFieldValue("OP");
      if (op === "ABS") return { o:"abs", a:inp("NUM") };
      if (op === "NEG") return { o:"bin", op:"-", a:0, b:inp("NUM") };
      problem(block, "questa operazione non è disponibile: usa solo valore assoluto o negativo.");
    }
    default: problem(block, "questo blocco non si può usare qui.");
  }
}
function varName(b) { return String(b.getField("VAR").getText()).slice(0, 15); }
function chainOf(first) { const out = []; for (let b = first; b; b = b.getNextBlock()) { const s = stmt(b); if (s) out.push(s); } return out; }
function stmt(b) {
  const id = blockIds.length; blockIds.push(b.id);
  const inp = (n) => val(b, n);
  const body = (n) => chainOf(b.getInputTargetBlock(n));
  const tag = (o) => { o.i = id; return o; };
  switch (b.type) {
    case "bb_servo": return tag({ o:"servo", v:inp("V") });
    case "bb_wait": return tag({ o:"wait", v:inp("V") });
    case "bb_say": return tag({ o:"say", v:inp("V") });
    case "bb_setpoint": return tag({ o:"setpoint", v:inp("V") });
    case "bb_pid": return tag({ o:"pid", kp:inp("KP"), ki:inp("KI"), kd:inp("KD") });
    case "bb_pid_off": return tag({ o:"pid_off" });
    case "bb_until": return tag({ o:"until", c:inp("C") });
    case "bb_until_pos": return tag({ o:"until", c:{ o:"cmp", op: b.getFieldValue("OP") === "LT" ? "<" : ">", a:{ o:"pos" }, b:inp("X") } });
    case "bb_if_pos": {
      const node = tag({ o:"if", c:{ o:"cmp", op: b.getFieldValue("OP") === "LT" ? "<" : ">", a:{ o:"pos" }, b:inp("X") }, t:body("DO") });
      const f = body("ELSE"); if (f.length) node.f = f;
      return node;
    }
    case "bb_forever": return tag({ o:"forever", b:body("DO") });
    case "controls_repeat_ext": return tag({ o:"repeat", n:inp("TIMES"), b:body("DO") });
    case "controls_whileUntil": {
      let c = inp("BOOL"); if (b.getFieldValue("MODE") === "UNTIL") c = { o:"not", a:c };
      return tag({ o:"while", c, b:body("DO") });
    }
    case "controls_if": {
      let n = 0; while (b.getInput("IF" + n)) n++;
      let els = b.getInput("ELSE") ? body("ELSE") : [];
      for (let i = n - 1; i >= 0; i--) {
        const node = tag({ o:"if", c:inp("IF" + i), t:body("DO" + i) });
        if (els.length) node.f = els;
        els = [node];
      }
      return els[0];
    }
    case "variables_set": return tag({ o:"set", n:varName(b), v:inp("VALUE") });
    case "math_change": return tag({ o:"change", n:varName(b), v:inp("DELTA") });
    default: problem(b, "questo blocco non si può usare qui.");
  }
}
function buildProgram() {
  blockIds = [];
  const starts = ws.getBlocksByType("bb_start", true);
  if (!starts.length) throw new GenError("Manca il blocco “quando premo AVVIA”.");
  return chainOf(starts[0].getNextBlock());
}
function jsonDepth(x) { if (x === null || typeof x !== "object") return 0; let m = 0; for (const k in x) m = Math.max(m, jsonDepth(x[k])); return m + 1; }

// ---------------- messaggi comprensibili ----------------
const FRIENDLY = {
  "sensore non valido: stop": "Il sensore non vede più la palla, quindi ho fermato tutto. Rimetti la palla sulla trave davanti al sensore (e controlla il cavetto).",
  "sensore non valido": "Non posso partire: il sensore non vede la palla. Mettila sulla trave davanti al sensore.",
  "connessione persa: stop": "Il computer non parla più con la scheda (cavo staccato o pagina ferma): la trave è tornata orizzontale.",
  "ferma il programma prima": "Prima di cambiare le impostazioni premi STOP.",
  "programma in esecuzione": "Un programma sta già girando: premi STOP e riprova.",
  "già in esecuzione": "Un programma sta già girando: premi STOP e riprova.",
  "nessun programma": "La scheda non ha ricevuto nessun programma: premi di nuovo AVVIA.",
  "programma vuoto": "La scheda ha ricevuto un programma vuoto.",
  "JSON non valido": "La scheda non ha capito il programma: forse ha troppi blocchi uno dentro l'altro. Prova a semplificarlo.",
  "riga troppo lunga": "Il programma è troppo grande per la scheda: usa meno blocchi.",
  "programma troppo annidato": "Ci sono troppi blocchi uno dentro l'altro: semplifica il programma.",
  "competizione in corso": "C'è una competizione in corso: non puoi avviare altre modalità (puoi regolare i parametri PID).",
  "comando sconosciuto": "La scheda non conosce questo comando: il suo software potrebbe essere vecchio.",
};
const friendly = (m) => FRIENDLY[m] || m;

// =====================================================================
//  USB (Web Serial)
// =====================================================================
const $ = (id) => document.getElementById(id);
let port = null, writer = null, reader = null, pingTimer = null, connected = false, running = false, sensorOk = false;
let link = null, readDone = null, closing = false;
let wsock = null;                      // WebSocket verso l'ESP32 (Wi-Fi)
const served = /^https?:$/.test(location.protocol);   // pagina servita dall'ESP32 stesso                       // { write(str) }: USB oppure simulatore
let sim = null, simTimer = null;
const enc = new TextEncoder();

function logLine(text, cls) {
  const d = document.createElement("div"); if (cls) d.className = cls; d.textContent = text;
  const L = $("log"); L.appendChild(d); while (L.childNodes.length > 200) L.removeChild(L.firstChild); L.scrollTop = L.scrollHeight;
}
function say(text, isErr) { const m = $("msg"); m.textContent = text || ""; m.className = isErr ? "err" : ""; }
function refreshUi() {
  $("connBadge").textContent = connected ? (sim ? "simulazione" : wsock ? "Wi-Fi" : "connesso") : "non connesso"; $("connBadge").className = "chip " + (connected ? "ok" : "");
  $("btnSim").textContent = sim ? "Esci dalla simulazione" : "🧪 Simulazione"; $("btnSim").disabled = connected && !sim; $("btnConnect").disabled = !!sim || !!wsock && !served;
  $("btnWifi").hidden = served; $("btnWifi").textContent = wsock ? "Disconnetti Wi-Fi" : "📶 Wi-Fi"; $("btnWifi").disabled = !!sim || (connected && !wsock);
  $("simCard").hidden = !sim;
  $("sensorBadge").textContent = connected ? (sensorOk ? "sensore OK" : "palla non vista") : "sensore ?";
  $("sensorBadge").className = "chip " + (connected ? (sensorOk ? "ok" : "bad") : "");
  $("btnConnect").textContent = connected ? "Disconnetti" : (served ? "Connetti" : "Connetti USB");
  $("btnRun").disabled = !connected || running; $("btnStop").disabled = !connected;
  $("pidRun").disabled = !connected || running; $("pidStop").disabled = !connected;
  $("tryAngle").disabled = !connected || running;
  $("compGo").disabled = !connected || running || compOn() || mode !== "pid";
  const lock = compOn(); $("pidRun").disabled = $("pidRun").disabled || lock; $("btnRun").disabled = $("btnRun").disabled || lock;
  for (const id of ["launchDeg","modePid","modeBlk"]) $(id).disabled = lock;
}
async function sendRaw(str) { await link.write(str); }
function usbLink() {
  return { async write(str) {
    const data = enc.encode(str);
    for (let i = 0; i < data.length; i += 128) {         // a pezzi, per non saturare il buffer dell'ESP32
      await writer.write(data.slice(i, i + 128));
      if (data.length > 128) await new Promise((r) => setTimeout(r, 8));
    }
  } };
}
async function send(obj) { if (!link) return; try { await sendRaw(JSON.stringify(obj) + "\n"); } catch (e) { logLine("Non riesco a mandare i dati alla scheda: " + e.message, "err"); } }

function connectWs(host) {
  return new Promise((resolve) => {
    const url = (location.protocol === "https:" ? "wss://" : "ws://") + host + ":81/";
    let w;
    try { w = new WebSocket(url); } catch (e) { say("Indirizzo non valido: " + host, true); return resolve(); }
    let opened = false;
    w.onopen = () => {
      opened = true; wsock = w; connected = true; sensorOk = false; say("");
      link = { async write(str) { for (const l of str.split("\n")) if (l && w.readyState === 1) w.send(l); } };
      pingTimer = setInterval(() => send({ c:"ping" }), 500);
      logLine("Collegato via Wi-Fi a " + host, "info");
      refreshUi(); send({ c:"hello" }); resolve();
    };
    w.onmessage = (ev) => { const l = String(ev.data).trim(); if (l[0] === "{") handleLine(l); };
    w.onerror = () => { if (!opened) say("Non riesco a raggiungere la scheda su " + host + ": è accesa e collegata al Wi-Fi? Il computer è sulla stessa rete?", true); };
    w.onclose = () => {
      if (!opened) { resolve(); return; }
      if (wsock === w) {                                      // caduta inattesa
        clearInterval(pingTimer); wsock = null; link = null; connected = false; running = false; pidOn = false; refreshUi();
        say("Collegamento con la scheda perso: la trave è tornata orizzontale. Riprovo…", true);
        if (served) setTimeout(() => { if (!connected) connectWs(host); }, 2000);
      }
    };
  });
}
async function connect() {
  if (served) return connectWs(location.hostname);
  if (!("serial" in navigator)) { say("Questo browser non supporta l'USB. Usa Chrome o Edge.", true); return; }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate:115200 });
  } catch (e) {
    port = null;
    say(e.name === "NotFoundError" ? "Non hai scelto nessuna scheda."
      : "Non riesco ad aprire la porta: forse la sta usando un altro programma (Arduino IDE, monitor seriale…). Chiudilo e riprova.", true);
    return;
  }
  writer = port.writable.getWriter(); link = usbLink(); connected = true; sensorOk = false; say("");
  refreshUi(); readDone = readLoop();
  setTimeout(() => send({ c:"hello" }), 1800);             // l'ESP32 può riavviarsi all'apertura della porta
  pingTimer = setInterval(() => send({ c:"ping" }), 500);
}
function connectSim() {
  sim = BBSim.createSim({ centerOffset: 1 /* trave orizzontale a 91° */, length: +$("cLen").value || 70, mountInverted: $("simMount").checked, noise: 0.1, onLine: (l) => handleLine(l) });
  sim.setBall(($("simBall").value / 100) * (+$("cLen").value || 70));
  link = { async write(s) { sim.write(s); } };
  connected = true; sensorOk = false; say("");
  let last = performance.now(), acc = 0;
  simTimer = setInterval(() => {                           // tempo simulato = tempo reale (al massimo 100 ms per volta)
    const n = performance.now(); acc = Math.min(acc + n - last, 100); last = n;
    const ms = Math.floor(acc); acc -= ms; if (sim) sim.step(ms);
  }, 10);
  pingTimer = setInterval(() => send({ c:"ping" }), 500);
  setTimeout(() => send({ c:"hello" }), 50);
  logLine("Simulazione avviata: palla e trave virtuali.", "info");
  refreshUi();
}
async function disconnect() {
  clearInterval(pingTimer); pingTimer = null;
  if (wsock) {
    try { await send({ c:"stop" }); } catch (e) {}
    const w = wsock; wsock = null; link = null; connected = false; running = false; pidOn = false; hist.length = 0; refreshUi(); w.close(); return;
  }
  if (sim) { clearInterval(simTimer); simTimer = null; sim = null; link = null; connected = false; running = false; sensorOk = false; hist.length = 0; refreshUi(); return; }
  try { await send({ c:"stop" }); } catch (e) {}
  closing = true;
  try { if (reader) await reader.cancel(); } catch (e) {}
  try { if (readDone) await readDone; } catch (e) {}       // il ciclo di lettura deve rilasciare il blocco prima di chiudere
  try { if (writer) { writer.releaseLock(); } } catch (e) {}
  try { if (port) await port.close(); } catch (e) {}
  port = writer = reader = link = readDone = null; connected = false; running = false; closing = false; refreshUi();
}
async function readLoop() {
  reader = port.readable.getReader(); const dec = new TextDecoder(); let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream:true });
      let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line[0] === "{") handleLine(line); }
      if (buf.length > 20000) buf = "";
    }
  } catch (e) { logLine("Collegamento interrotto: " + e.message, "err"); }
  try { reader.releaseLock(); } catch (e) {}
  if (connected && !closing) { clearInterval(pingTimer); connected = false; running = false; port = writer = reader = link = null; say("Cavo scollegato.", true); refreshUi(); }
}

// ---------------- messaggi dall'ESP32 ----------------
const hist = []; let lastSp = null;
function handleLine(line) {
  let o; try { o = JSON.parse(line); } catch (e) { return; }
  if (o.e) {
    if (o.e === "hello") { logLine("ESP32 pronto (fw " + o.fw + ")", "info"); }
    else if (o.e === "err") { logLine("⚠ " + friendly(o.m), "err"); say(friendly(o.m), true); }
    else if (o.e === "comp_countdown") { logLine("Competizione: conto alla rovescia", "info"); }
    else if (o.e === "comp_start") { logLine("Competizione: VIA! 60 secondi", "info"); }
    else if (o.e === "tune_start") { logLine("Addestramento PID: VIA!", "info"); }
    else if (o.e === "comp_win") { compWin[o.i] = o.f === undefined ? +o.p : +o.f; logLine("Finestra " + (o.i + 1) + "/10: " + (+o.p).toFixed(2) + " punti", "info"); compDraw(); }
    else if (o.e === "comp_end") { compEnd(o); }
    else if (o.e === "log") { logLine("→ " + (+o.v).toFixed(2), "info"); }
    else if (o.e === "done") {
    logLine("Programma finito.", "info"); highlight(null);
    if (runUsesServo && performance.now() - runStart < 1500) {
      say("Il programma è finito subito e la trave è tornata orizzontale. Per tenerla inclinata metti i blocchi dentro “per sempre” (con un “aspetta” dentro).");
    }
  }
    return;
  }
  if (o.x === undefined) return;
  compTele(o);
  sensorOk = !!o.ok; const wasRunning = running; running = !!o.run;
  if (wasRunning !== running || $("sensorBadge").textContent !== (sensorOk ? "sensore OK" : "palla non vista")) refreshUi();
  hist.push({ t:o.t, x:+o.x, sp:+o.sp, a:+o.a, pid:o.pid, ok:o.ok }); if (hist.length > 1400) hist.shift();
  $("vErr").textContent = (o.pid && o.ok) ? (+o.sp - +o.x).toFixed(1) : "–";
  $("vPos").textContent = o.ok ? (+o.x).toFixed(1) : "–"; $("vSp").textContent = o.pid ? (+o.sp).toFixed(1) : "–"; $("vAng").textContent = (+o.a).toFixed(1);
  lastSp = o.pid ? +o.sp : null;
  highlight(running && o.s !== undefined ? blockIds[o.s] : null);
  // palla fuori dal campo del sensore: non è un errore, il firmware continua da solo (ultima posizione nota, poi trave orizzontale)
  const lost = running && !o.ok;
  if (lost && !ballLost) { ballLost = true; logLine("La palla è fuori dal campo del sensore: continuo con l'ultima posizione nota.", "info"); }
  if (lost) say("La palla è fuori dal campo del sensore. Rimettila sulla trave: il programma riprende da solo.");
  else if (ballLost) { ballLost = false; if ($("msg").className !== "err") say(""); logLine("Palla di nuovo visibile.", "info"); }
  if (pidOn && !running && performance.now() - pidStartedAt > 1500) { pidOn = false; refreshUi(); }   // fermato dalla scheda (sicurezze)
}
let ballLost = false;
let hlId = null, runStart = 0, runUsesServo = false;
let mode = "pid", pidOn = false, pidDirty = false, pidStartedAt = 0;
function highlight(id) { id = id || null; if (id === hlId) return; hlId = id; try { ws.highlightBlock(id); } catch (e) {} }

// ---------------- grafico grande ----------------
let chartWin = 30;                                         // secondi visibili
try { chartWin = +localStorage.getItem("bb_win") || 30; } catch (e) {}
function setWin(w) { chartWin = w; try { localStorage.setItem("bb_win", w); } catch (e) {} for (const b of $("winsel").children) b.classList.toggle("on", +b.dataset.w === w); }
$("winsel").onclick = (e) => { if (e.target.dataset && e.target.dataset.w) setWin(+e.target.dataset.w); };
setWin(chartWin);
const cv = $("chart"), cx = cv.getContext("2d");
const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function rgba(c, a) { const m = /^#([0-9a-f]{6})$/i.exec(c); if (!m) return c; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function fitCanvas(c) {
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (w < 10 || h < 10) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const niceStep = (v) => [1, 2, 5, 10, 20, 25, 50].find((s) => s >= v) || 100;

function drawChart() {
  const f = fitCanvas(cv); if (!f) return;
  const { g, w, h } = f;
  const C = { pos:cssv("--pos"), sp:cssv("--sp"), ang:cssv("--ang"), plot:cssv("--plot"), grid:cssv("--grid"), axis:cssv("--axis"), ink:cssv("--ink"), bad:cssv("--bad") };
  let len = Math.max(10, +$("cLen").value || 70);
  for (const p of hist) if (p.ok && p.x > len) len = Math.ceil(p.x / 10) * 10;
  const lim = Math.max(1, +$("cLimit").value || 20);
  const small = w < 520, padL = small ? 38 : 46, padR = small ? 60 : 66, padT = 12, padB = 26, gap = small ? 14 : 20;
  const x0 = padL, x1 = w - padR, tY0 = padT, tY1 = padT + (h - padT - padB - gap) * 0.70, bY0 = tY1 + gap, bY1 = h - padB;
  const yP = (v) => tY1 - (tY1 - tY0) * Math.min(Math.max(v, 0), len) / len;
  const yA = (v) => bY1 - (bY1 - bY0) * (Math.min(Math.max(v, -lim), lim) + lim) / (2 * lim);
  // sfondo dei due riquadri
  g.fillStyle = C.plot; roundRect(g, x0, tY0, x1 - x0, tY1 - tY0, 10); g.fill(); roundRect(g, x0, bY0, x1 - x0, bY1 - bY0, 10); g.fill();
  g.font = "11.5px system-ui, sans-serif"; g.textBaseline = "middle";
  // griglia orizzontale (posizione)
  const st = niceStep(len / 5); g.lineWidth = 1;
  for (let v = 0; v <= len + 1e-6; v += st) { const y = yP(v); g.strokeStyle = C.grid; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.fillStyle = C.axis; g.textAlign = "right"; g.fillText(v.toFixed(0), x0 - 8, y); }
  g.save(); g.translate(12, (tY0 + tY1) / 2); g.rotate(-Math.PI / 2); g.textAlign = "center"; g.fillStyle = C.axis; g.fillText("cm", 0, 0); g.restore();
  // angolo
  for (const v of [-lim, 0, lim]) { const y = yA(v); g.strokeStyle = v === 0 ? C.axis : C.grid; g.setLineDash(v === 0 ? [4, 4] : []); g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]); g.fillStyle = C.axis; g.textAlign = "right"; g.fillText((v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v) + "°", x0 - 8, y); }
  const last = hist[hist.length - 1];
  if (!last) {
    g.fillStyle = C.axis; g.textAlign = "center"; g.font = "15px system-ui, sans-serif";
    g.fillText(connected ? "In attesa dei dati dalla scheda…" : "Collegati alla scheda (USB o Wi-Fi) oppure prova la simulazione", (x0 + x1) / 2, (tY0 + tY1) / 2); return;
  }
  const win = chartWin * 1000, t1 = last.t, xT = (t) => x0 + (x1 - x0) * (1 - (t1 - t) / win);
  // griglia verticale + tempo
  const tick = chartWin <= 10 ? 1 : chartWin <= 30 ? 5 : 10; g.textAlign = "center";
  for (let s = 0; s <= chartWin; s += tick) {
    const x = x1 - (x1 - x0) * s / chartWin; g.strokeStyle = C.grid; g.beginPath(); g.moveTo(x, tY0); g.lineTo(x, tY1); g.moveTo(x, bY0); g.lineTo(x, bY1); g.stroke();
    g.fillStyle = C.axis; g.fillText(s === 0 ? "ora" : "−" + s + " s", x, bY1 + 14);
  }
  g.save(); g.beginPath(); g.rect(x0, tY0 - 2, x1 - x0, bY1 - tY0 + 4); g.clip();
  const vis = hist.filter((p) => t1 - p.t <= win);
  // palla non vista
  let s0 = null;
  for (let i = 0; i <= vis.length; i++) {
    const bad = i < vis.length && !vis[i].ok;
    if (bad && s0 === null) s0 = vis[i].t; else if (!bad && s0 !== null) { const xa = xT(s0), xb = xT(vis[i - 1].t); g.fillStyle = rgba(C.bad, 0.13); g.fillRect(xa, tY0, Math.max(3, xb - xa), tY1 - tY0); s0 = null; }
  }
  // banda ±1.5 cm intorno all'obiettivo e linea obiettivo
  const pv = vis.filter((p) => p.pid);
  if (pv.length > 1) {
    g.beginPath(); pv.forEach((p, i) => { const x = xT(p.t), y = yP(p.sp + 1.5); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    for (let i = pv.length - 1; i >= 0; i--) g.lineTo(xT(pv[i].t), yP(pv[i].sp - 1.5));
    g.closePath(); g.fillStyle = rgba(C.sp, 0.13); g.fill();
    g.beginPath(); g.strokeStyle = C.sp; g.lineWidth = 2; g.setLineDash([9, 6]); let pen = false;
    for (const p of vis) { if (!p.pid) { pen = false; continue; } const x = xT(p.t), y = yP(p.sp); if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y); }
    g.stroke(); g.setLineDash([]);
  }
  // posizione: area + linea
  const pts = vis.filter((p) => p.ok);
  if (pts.length > 1) {
    const grad = g.createLinearGradient(0, tY0, 0, tY1); grad.addColorStop(0, rgba(C.pos, 0.28)); grad.addColorStop(1, rgba(C.pos, 0));
    g.beginPath(); pts.forEach((p, i) => { const x = xT(p.t), y = yP(p.x); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.lineTo(xT(pts[pts.length - 1].t), tY1); g.lineTo(xT(pts[0].t), tY1); g.closePath(); g.fillStyle = grad; g.fill();
    g.beginPath(); g.strokeStyle = C.pos; g.lineWidth = 2.6; g.lineJoin = "round"; let pen = false;
    for (const p of vis) { if (!p.ok) { pen = false; continue; } const x = xT(p.t), y = yP(p.x); if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y); }
    g.stroke();
  }
  // angolo
  g.beginPath(); g.strokeStyle = C.ang; g.lineWidth = 2.2; g.lineJoin = "round";
  vis.forEach((p, i) => { const x = xT(p.t), y = yA(p.a); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  g.restore();
  // etichette in fondo alle linee
  const tag = (txt, y, col) => { g.font = "600 12.5px ui-monospace, Consolas, monospace"; const tw = g.measureText(txt).width + 14; g.fillStyle = col; roundRect(g, x1 + 8, y - 11, tw, 22, 11); g.fill(); g.fillStyle = "#fff"; g.textAlign = "left"; g.fillText(txt, x1 + 15, y); };
  if (last.ok) { const y = yP(last.x); g.fillStyle = C.pos; g.beginPath(); g.arc(x1, y, 5, 0, 7); g.fill(); g.strokeStyle = C.plot; g.lineWidth = 2; g.stroke(); tag(last.x.toFixed(1), y, C.pos); }
  if (last.pid) tag("▸ " + last.sp.toFixed(1), Math.min(Math.max(yP(last.sp), tY0 + 11), tY1 - 11) + (last.ok && Math.abs(yP(last.sp) - yP(last.x)) < 24 ? (yP(last.sp) < yP(last.x) ? -13 : 13) : 0), C.sp);
  g.fillStyle = C.ang; g.beginPath(); g.arc(x1, yA(last.a), 4.5, 0, 7); g.fill(); tag(last.a.toFixed(1) + "°", yA(last.a), C.ang);
  if (!last.ok) { g.fillStyle = C.bad; g.font = "600 13px system-ui, sans-serif"; g.textAlign = "left"; g.fillText("palla non vista", x0 + 12, tY0 + 16); }
}

// ---------------- vista animata della trave ----------------
const bv = $("beamView");
function drawBeam() {
  const f = fitCanvas(bv); if (!f) return;
  const { g, w, h } = f, last = hist[hist.length - 1];
  const C = { pos:cssv("--pos"), sp:cssv("--sp"), ink:cssv("--ink"), muted:cssv("--muted"), axis:cssv("--axis") };
  let theta = 0, x = null, len = Math.max(10, +$("cLen").value || 70), sp = null;
  if (sim) { const v = sim.view(); theta = v.theta; x = v.x; len = v.length; if (last && last.pid) sp = last.sp; }
  else if (connected && last) { theta = last.a; x = last.ok ? last.x : null; sp = last.pid ? last.sp : null; if (x !== null && x > len) len = x; }
  // il perno è sul lato sinistro (sensore); la lunghezza è limitata così che alla massima inclinazione la trave resti nel riquadro
  const maxA = Math.max(5, +$("cLimit").value || 20) * Math.PI / 180;
  const L = Math.min(w - 90, (h / 2 - 30) / Math.sin(maxA)), cxm = (w - L) / 2 + 8, cy = h * 0.5, th = Math.max(-35, Math.min(35, theta)) * Math.PI / 180, k = (v) => -L / 2 + (v / len) * L;
  // supporto
  const sg = g.createLinearGradient(0, cy, 0, h); sg.addColorStop(0, "#a5b4fc"); sg.addColorStop(1, "#6366f1");
  g.fillStyle = sg; g.beginPath(); g.moveTo(cxm, cy + 6); g.lineTo(cxm - 16, h - 8); g.lineTo(cxm + 16, h - 8); g.closePath(); g.fill();
  g.fillStyle = C.axis; g.globalAlpha = 0.4; roundRect(g, cxm - 60, h - 9, 120, 5, 2.5); g.fill(); g.globalAlpha = 1;
  g.save(); g.translate(cxm, cy); g.rotate(th); g.translate(L / 2, 0);     // ruota attorno all'estremo sinistro
  // trave
  const bg = g.createLinearGradient(0, 0, 0, 10); bg.addColorStop(0, "#e2e8f0"); bg.addColorStop(1, "#94a3b8");
  g.fillStyle = bg; roundRect(g, -L / 2, 0, L, 10, 5); g.fill();
  g.strokeStyle = "rgba(15,23,42,.45)"; g.lineWidth = 1; g.font = "10px system-ui"; g.textAlign = "center"; g.fillStyle = "rgba(15,23,42,.65)"; g.textBaseline = "alphabetic";
  const ts = len > 100 ? 20 : 10;
  for (let v = 0; v <= len; v += ts) { g.beginPath(); g.moveTo(k(v), 0); g.lineTo(k(v), 4); g.stroke(); g.fillText(v, k(v), 17); }
  // sensore (posizione 0)
  const sgr = g.createLinearGradient(0, -16, 0, 6); sgr.addColorStop(0, "#334155"); sgr.addColorStop(1, "#0f172a");
  g.fillStyle = sgr; roundRect(g, -L / 2 - 16, -17, 16, 26, 4); g.fill(); g.fillStyle = "#38bdf8"; g.beginPath(); g.arc(-L / 2 - 4, -6, 3, 0, 7); g.fill();
  if (x !== null) {
    g.strokeStyle = rgba(C.pos, 0.35); g.setLineDash([4, 4]); g.beginPath(); g.moveTo(-L / 2 - 4, -6); g.lineTo(k(x) - 10, -14); g.stroke(); g.setLineDash([]);
  }
  if (sp !== null) {                                       // bandierina dell'obiettivo
    g.strokeStyle = C.sp; g.lineWidth = 2; g.beginPath(); g.moveTo(k(sp), 0); g.lineTo(k(sp), -34); g.stroke();
    g.fillStyle = C.sp; g.beginPath(); g.moveTo(k(sp), -34); g.lineTo(k(sp) + 14, -29); g.lineTo(k(sp), -24); g.closePath(); g.fill();
  }
  if (x !== null) {                                        // palla
    const bx = k(x), r = 11;
    g.fillStyle = "rgba(0,0,0,.22)"; g.beginPath(); g.ellipse(bx + 2, 1, r * 0.9, 3, 0, 0, 7); g.fill();
    const rg = g.createRadialGradient(bx - 4, -r - 4, 2, bx, -r, r + 2); rg.addColorStop(0, "#bfdbfe"); rg.addColorStop(0.45, C.pos); rg.addColorStop(1, "#1e3a8a");
    g.fillStyle = rg; g.beginPath(); g.arc(bx, -r, r, 0, 7); g.fill();
  }
  g.restore();
  g.fillStyle = C.muted; g.font = "11px system-ui"; g.textAlign = "right"; g.textBaseline = "alphabetic";
  g.fillText(!connected ? "Collegati o avvia la simulazione" : x === null ? "palla non vista dal sensore" : "inclinazione reale", w - 10, h - 8);
}
(function loop() { drawChart(); drawBeam(); requestAnimationFrame(loop); })();

// ---------------- pulsanti −/+ , scorciatoie ----------------
for (const b of document.querySelectorAll(".step")) b.onclick = () => {
  const sl = $(b.dataset.t), st = +sl.step || 1;
  let v = Math.max(+sl.min, Math.round((+sl.value + (+b.dataset.d) * st) / st) * st); v = +v.toFixed(6);
  if (v > +sl.max) sl.max = v; sl.value = v; sl.oninput();
};
window.addEventListener("keydown", (e) => {                // Esc (o Spazio in modalità PID) = STOP
  if (!connected || compOn() || /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || "")) return;
  if (e.key === "Escape" || (e.key === " " && mode === "pid")) { e.preventDefault(); stopPid(); }
});

// =====================================================================
//  AZIONI
// =====================================================================
function cfgObj() { return { c:"cfg", center:+$("cCenter").value, limit:+$("cLimit").value, inv:$("cInv").checked ? 1 : 0 }; }
async function run() {
  let prog; try { prog = buildProgram(); } catch (e) { say(e.message, true); return; }
  if (!prog.length) { say("Il programma è vuoto: aggiungi blocchi sotto “quando premo AVVIA”.", true); return; }
  const line = JSON.stringify({ c:"prog", p:prog });
  if (jsonDepth({ c:"prog", p:prog }) > 40) { say("Ci sono troppi blocchi uno dentro l'altro (al massimo circa 18 livelli): semplifica il programma.", true); return; }
  if (line.length > 11000) { say("Il programma è troppo grande per la scheda (" + line.length + " byte su 11000): usa meno blocchi.", true); return; }
  say(""); hist.length = 0;
  runStart = performance.now(); runUsesServo = line.includes('"o":"servo"');
  const lim = Math.min(35, Math.max(1, +$("cLimit").value || 20)), over = [];
  (function walk(x) { if (x && typeof x === "object") { if (x.o === "servo" && typeof x.v === "number" && Math.abs(x.v) > lim) over.push(x.v); for (const k in x) walk(x[k]); } })(prog);
  if (over.length) logLine("Nota: la trave non supera ±" + lim + "° (limite di sicurezza): " + over.join(", ") + " verrà ridotto.", "info");
  await send(cfgObj()); await new Promise((r) => setTimeout(r, 100));
  await sendRaw(line + "\n"); await new Promise((r) => setTimeout(r, 150));
  await send({ c:"run" }); logLine("Avvio programma (" + line.length + " byte)", "info");
}
$("btnConnect").onclick = () => (connected ? disconnect() : connect());
$("btnWifi").onclick = () => {
  if (connected) return disconnect();
  let host = "ballbeam.local"; try { host = localStorage.getItem("bb_host") || host; } catch (e) {}
  host = (prompt("Indirizzo della scheda (Wi-Fi):", host) || "").trim(); if (!host) return;
  try { localStorage.setItem("bb_host", host); } catch (e) {}
  connectWs(host);
};
$("btnSim").onclick = () => (sim ? disconnect() : connectSim());
$("simBall").oninput = (e) => { if (sim) sim.setBall((e.target.value / 100) * (+$("cLen").value || 70)); };
$("simGone").onchange = (e) => { if (sim) sim.setBallPresent(!e.target.checked); };
$("simMount").onchange = (e) => { if (sim) sim.setMountInverted(e.target.checked); };
// ---------------- modalità PID: parametri regolati dal browser, controllo sull'ESP32 ----------------
const pidVals = () => ({ sp:+$("sSp").value, kp:+$("sKp").value, ki:+$("sKi").value, kd:+$("sKd").value });
const PIDF = { sSp:["oSp", 1], sKp:["oKp", 2], sKi:["oKi", 3], sKd:["oKd", 3] };   // slider -> [casella numerica, decimali]
function pidShow() {
  for (const [sl, [num, dec]] of Object.entries(PIDF)) if (document.activeElement !== $(num)) $(num).value = (+$(sl).value).toFixed(dec);
  fillSliders();
}
function fillSliders() { for (const sl of Object.keys(PIDF)) { const e = $(sl), p = (+e.value - +e.min) / ((+e.max - +e.min) || 1) * 100; e.style.setProperty("--fill", Math.max(0, Math.min(100, p)) + "%"); } }
function pidChanged() { fillSliders(); pidDirty = true; try { localStorage.setItem("bb_pid", JSON.stringify(pidVals())); } catch (e) {} }
for (const [sl, [num]] of Object.entries(PIDF)) {
  $(sl).oninput = () => { pidShow(); pidChanged(); };
  $(num).oninput = () => {                                 // valore scritto a mano: allarga lo slider se serve
    const v = parseFloat($(num).value); if (!isFinite(v) || v < 0) return;
    if (v > +$(sl).max) $(sl).max = v;
    $(sl).value = v; pidChanged();
  };
  $(num).onblur = pidShow;
}
try { const v = JSON.parse(localStorage.getItem("bb_pid") || "null"); if (v) for (const [sl, k] of [["sSp","sp"],["sKp","kp"],["sKi","ki"],["sKd","kd"]]) {
  if (isFinite(v[k])) { if (v[k] > +$(sl).max) $(sl).max = v[k]; $(sl).value = v[k]; } } } catch (e) {}
function syncSpRange() { $("sSp").max = Math.max(10, +$("cLen").value || 70); pidShow(); }
syncSpRange();
async function runPid() {
  if (!connected) return;
  const launch = Math.min(20, Math.max(1, +$("launchDeg").value || 6));
  say(""); hist.length = 0;
  await send(cfgObj()); await new Promise((r) => setTimeout(r, 100));
  pidOn = true; pidDirty = false; pidStartedAt = performance.now();
  await send({ c:"tune", on:1, ...pidVals(), launch:-launch });
  logLine("Lancio PID: 3, 2, 1... Obiettivo " + pidVals().sp + " cm", "info");
}
function stopPid() {
  if (compOn() && !confirm("Interrompere la competizione? Resteranno solo i punti già fatti.")) return;
  pidOn = false; send({ c:"stop" }); say(""); highlight(null);
}
// ---------------- competizione: punteggio e conto alla rovescia calcolati dalla scheda ----------------
var compState = 0, compWin = [], compCur = 0, compPtsLive = 0, compLeftMs = 0, tuneLaunchLeftMs = 0, tuneLaunchViaUntil = 0, compSuccessTimer = 0;
function compOn() { return compState === 1 || compState === 2; }
function hideCompSuccess() {
  if (compSuccessTimer) { clearTimeout(compSuccessTimer); compSuccessTimer = 0; }
  $("compSuccess").hidden = true;
}
function showCompSuccess() {
  hideCompSuccess();
  const overlay = $("compSuccess");
  overlay.hidden = false;
  compSuccessTimer = setTimeout(() => { overlay.hidden = true; compSuccessTimer = 0; }, 4000);
}
function boxes(el, vals, cur) {
  if (el.children.length !== 10) { el.innerHTML = ""; for (let i = 0; i < 10; i++) { const s = document.createElement("span"); s.appendChild(document.createElement("i")); el.appendChild(s); } }
  for (let i = 0; i < 10; i++) { const s = el.children[i]; s.firstChild.style.width = (vals[i] === undefined ? 0 : Math.round(vals[i] * 100)) + "%"; s.classList.toggle("cur", i === cur); }
}
function compDraw() {
  const tuneLaunching = tuneLaunchLeftMs > 0;
  const tuneVia = !tuneLaunching && performance.now() < tuneLaunchViaUntil;
  const tuneLaunchVisible = tuneLaunching || tuneVia;
  const secs = Math.ceil(compLeftMs / 1000);
  $("compBar").hidden = !(compState === 1 || compState === 2 || tuneLaunchVisible);
  $("compBar").classList.toggle("pid-launch", tuneLaunchVisible);
  const starting = compState === 2 && compLeftMs > 59000;
  $("compPhase").textContent = compState === 1 ? "Si parte tra" : tuneLaunching ? "Lancio PID" : tuneVia ? "Addestramento" : starting ? "VIA!" : "Tempo rimasto";
  $("compTime").textContent = compState === 1 ? Math.max(1, secs) : tuneLaunching ? Math.max(1, Math.ceil(tuneLaunchLeftMs / 1000)) : tuneVia ? "VIA!" : secs;
  $("compPts").textContent = compPtsLive.toFixed(1);
  $("compMsg").textContent = tuneLaunching ? "Lancio: la trave mantiene l'inclinazione selezionata; il PID parte allo scadere."
    : tuneVia ? "PID attivo." : compState === 1 ? "Metti la palla in fondo alla trave (lato opposto al sensore) e lasciala!"
    : "Tieni la palla vicino all'obiettivo (±6 cm): ogni sbarra vale fino a 2,5 punti, totale massimo 10.";
  boxes($("compWins"), compWin, compState === 2 ? compCur : -1);
}
function compTele(o) {
  const cs = o.cs || 0, was = compState;
  if (cs === 3) { return; }                                // fine gara: ci pensa l'evento comp_end
  const wasTuneLaunching = tuneLaunchLeftMs > 0;
  tuneLaunchLeftMs = +o.tl || 0;
  if (wasTuneLaunching && !tuneLaunchLeftMs && o.run) tuneLaunchViaUntil = performance.now() + 1000;
  if (!o.run) tuneLaunchViaUntil = 0;
  compState = cs; compLeftMs = +o.ct || 0; compPtsLive = +o.cp || 0; compCur = o.cw | 0;
  if (cs === 1 && was !== 1) { compWin = []; $("compRes").hidden = true; refreshUi(); }
  if (cs === 0 && was !== 0) refreshUi();
  compDraw();
}
function compEnd(o) {
  compState = 0; compPtsLive = +o.pts; refreshUi(); $("compBar").hidden = true;
  $("rPts").textContent = (+o.pts).toFixed(1);
  $("rInfo").innerHTML = (o.abort ? "<b>Competizione interrotta</b> dopo " + Math.round(o.ticks * 0.05) + " s. " : "") +
    "Obiettivo " + (+o.sp).toFixed(1) + " cm · Kp " + (+o.kp) + " · Ki " + (+o.ki) + " · Kd " + (+o.kd) + "<br>Errore medio " + (+o.mae).toFixed(2) + " cm (a parità di punti vince l'errore più basso)";
  boxes($("rWins"), o.wf || o.w, -1); $("compRes").hidden = false;
  if (o.early) showCompSuccess();
  logLine("Competizione " + (o.abort ? "interrotta" : "finita") + ": " + (+o.pts).toFixed(2) + " punti", "info");
}
async function runComp() {
  if (!connected || running || compOn()) return;
  const v = pidVals(), launch = Math.min(20, Math.max(1, +$("launchDeg").value || 6));
  if (!confirm("Competizione: conto alla rovescia 3, 2, 1, VIA! (metti la palla in fondo alla trave, lato opposto al sensore), poi 60 s di gara.\nObiettivo " + v.sp + " cm. Durante la gara potrai modificare i parametri PID. Parto?")) return;
  hideCompSuccess(); say(""); hist.length = 0; pidOn = false; pidDirty = false; compWin = []; $("compRes").hidden = true;
  await send(cfgObj()); await new Promise((r) => setTimeout(r, 100));
  await send({ c:"comp", on:1, ...v, launch:-launch });
}
$("compGo").onclick = runComp; $("compAbort").onclick = stopPid; $("rClose").onclick = () => { $("compRes").hidden = true; send({ c:"comp", on:0 }); };
let pidTick = 0;
setInterval(() => {                                        // aggiorna i parametri sulla scheda, più lentamente del controllo
  if (!connected || (!pidOn && !compOn())) return;
  if (pidDirty || ++pidTick % 5 === 0) { pidDirty = false; send({ c:"tune", ...pidVals() }); }
}, 100);
$("pidRun").onclick = runPid; $("pidStop").onclick = stopPid;
function setMode(m) {
  if (m !== mode && (running || pidOn)) { pidOn = false; send({ c:"stop" }); }
  mode = m;
  $("pidPanel").hidden = m !== "pid"; $("blocklyDiv").hidden = m === "pid"; $("levelWrap").hidden = m === "pid"; $("progCard").hidden = m === "pid";
  $("modePid").classList.toggle("on", m === "pid"); $("modeBlk").classList.toggle("on", m !== "pid");
  (m === "pid" ? $("chartSlot") : $("asideChartSlot")).appendChild($("chartCard"));
  try { localStorage.setItem("bb_mode", m); } catch (e) {}
  if (m !== "pid") setTimeout(() => Blockly.svgResize(ws), 0);
  say("");
}
$("modePid").onclick = () => setMode("pid"); $("modeBlk").onclick = () => setMode("blocks");
$("btnRun").onclick = () => (mode === "pid" ? runPid() : run());
$("btnStop").onclick = () => { stopPid(); };
$("tryAngle").oninput = (e) => { $("tryVal").textContent = e.target.value; if (!running) send({ c:"angle", v:+e.target.value }); };
for (const id of ["cCenter", "cLimit", "cInv"]) $(id).onchange = () => {
  const l = Math.min(35, Math.max(1, +$("cLimit").value || 20)); $("cLimit").value = l; $("tryAngle").min = -l; $("tryAngle").max = l;
  try { localStorage.setItem("bb_cfg", JSON.stringify({ c:$("cCenter").value, l:$("cLimit").value, i:$("cInv").checked, n:$("cLen").value, m:2 })); } catch (e) {}
  if (connected && !running) send(cfgObj());
};
$("cLen").onchange = () => { $("cCenter").onchange(); syncSpRange(); if (sim) sim.setLength(+$("cLen").value || 70); };
try { const s = JSON.parse(localStorage.getItem("bb_cfg") || "null"); if (s) { $("cCenter").value = (s.m !== 2 && String(s.c) === "90") ? "91" : s.c;   // il centro misurato è 91 (vecchi salvataggi: 90)
  $("cCenter").value = $("cCenter").value; $("cLimit").value = s.l; $("cInv").checked = s.i; $("cLen").value = s.n; $("tryAngle").min = -s.l; $("tryAngle").max = s.l; } } catch (e) {}

$("level").onchange = (e) => ws.updateToolbox(toolboxFor(+e.target.value));
(function fillExamples() {
  const sel = $("examples"); sel.add(new Option("Scegli un esempio…", ""));
  EXAMPLES.forEach((e, i) => sel.add(new Option(e.name + (e.level > 1 ? "  (livello " + e.level + ")" : ""), String(i))));
  sel.onchange = () => {
    const e = EXAMPLES[+sel.value]; sel.value = ""; if (!e) return;
    if (+$("level").value < e.level) { $("level").value = String(e.level); ws.updateToolbox(toolboxFor(e.level)); }
    loadState(e.state); highlight(null); say(e.note);
  };
})();
$("btnNew").onclick = () => { if (confirm("Cancellare il programma attuale?")) loadState(startWith([])); };
$("btnSave").onclick = () => {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(Blockly.serialization.workspaces.save(ws))], { type:"application/json" }));
  a.download = "ball-beam-programma.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("btnLoad").onclick = () => $("fileIn").click();
$("fileIn").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { loadState(JSON.parse(await f.text())); } catch (err) { say("File non valido.", true); } e.target.value = ""; };
window.addEventListener("resize", () => Blockly.svgResize(ws));
window.addEventListener("beforeunload", () => { if (connected) send({ c:"stop" }); });
refreshUi();

let m0 = "pid"; try { m0 = localStorage.getItem("bb_mode") || "pid"; } catch (e) {}
setMode(m0 === "blocks" ? "blocks" : "pid");
if (served) setTimeout(() => connectWs(location.hostname), 300);   // pagina servita dall'ESP32: si collega da sola
