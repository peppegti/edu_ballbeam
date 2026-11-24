#!/usr/bin/env node
// Scenari sul dispositivo simulato (web/sim.js): protocollo, sicurezze, fisica, PID.
"use strict";
const path = require("path");
const { createSim } = require(path.join(__dirname, "..", "web", "sim.js"));
let fails = 0;
const ok = (c, msg) => { console.log((c ? "ok   " : "FAIL ") + msg); if (!c) fails++; };

function rig(opts) {
  const lines = [], tele = [];
  const sim = createSim({ noise: 0, ...opts, onLine: (s) => { const o = JSON.parse(s); (o.e ? lines : tele).push(o); } });
  const send = (o) => sim.write(JSON.stringify(o) + "\n");
  const prog = (p) => { send({ c: "prog", p }); send({ c: "run" }); };
  // avanza `ms` mandando un ping ogni 500 ms (come fa la pagina)
  const run = (ms, ping = true) => { for (let t = 0; t < ms; t += 100) { if (ping && t % 500 === 0) send({ c: "ping" }); sim.step(Math.min(100, ms - t)); } };
  const last = () => tele[tele.length - 1];
  return { sim, lines, tele, send, prog, run, last };
}
const evs = (r, e) => r.lines.filter((l) => l.e === e);

// 1. PID: la palla converge all'obiettivo e ci resta
{
  const r = rig({ x0: 5 });
  r.send({ c: "hello" });
  r.prog([{ o: "setpoint", v: 20 }, { o: "pid", kp: 2, ki: 0, kd: 1 }, { o: "forever", b: [{ o: "wait", v: 0.1 }] }]);
  r.run(10000);
  const tail = r.tele.slice(-40);
  const err = Math.max(...tail.map((p) => Math.abs(p.x - 20)));
  ok(evs(r, "hello").length === 1 && r.last().run === 1 && r.last().pid === 1, "PID attivo e programma in esecuzione");
  ok(err < 1.0, `PID: palla a 20 cm entro 1 cm dopo 10 s (errore max ${err.toFixed(2)} cm)`);
  ok(Math.max(...tail.map((p) => Math.abs(p.a))) < 3, "PID: trave quasi orizzontale a regime");
}

// 2. due posizioni: la palla raggiunge entrambe
{
  const r = rig({ x0: 20 });
  r.prog([{ o: "pid", kp: 2, ki: 0, kd: 1 }, { o: "forever", b: [{ o: "setpoint", v: 12 }, { o: "wait", v: 6 }, { o: "setpoint", v: 28 }, { o: "wait", v: 6 }] }]);
  r.run(5900); const a = r.last().x; r.run(6000); const b = r.last().x;
  ok(Math.abs(a - 12) < 1 && Math.abs(b - 28) < 1, `due posizioni: ${a} cm poi ${b} cm`);
}

// 3. verso: angolo positivo -> x cresce; montaggio invertito -> serve "inverti"
{
  const r = rig({ x0: 20 });
  r.prog([{ o: "servo", v: 8 }, { o: "wait", v: 1 }, { o: "servo", v: 0 }]);
  r.run(1500); ok(r.last().x > 22, `angolo positivo -> la palla va verso x grandi (x=${r.last().x})`);
  const q = rig({ x0: 20, mountInverted: true });
  q.prog([{ o: "servo", v: 8 }, { o: "wait", v: 1 }]); q.run(1200);
  ok(q.last().x < 18, `montaggio invertito: stesso programma, palla dall'altra parte (x=${q.last().x})`);
  const w = rig({ x0: 20, mountInverted: true });
  w.send({ c: "cfg", center: 90, limit: 20, inv: 1 });
  w.prog([{ o: "servo", v: 8 }, { o: "wait", v: 1 }]); w.run(1200);
  ok(w.last().x > 22, `con "inverti verso" torna corretto (x=${w.last().x})`);
}

// 4. limite angolo: nessun programma supera ±limit
{
  const r = rig({});
  r.send({ c: "cfg", center: 90, limit: 12, inv: 0 });
  r.prog([{ o: "servo", v: 100 }, { o: "wait", v: 0.5 }, { o: "servo", v: -100 }, { o: "wait", v: 0.5 }]);
  r.run(1200);
  ok(Math.max(...r.tele.map((p) => Math.abs(p.a))) <= 12, "angolo limitato a ±12 anche chiedendo 100");
  const q = rig({}); q.send({ c: "cfg", center: 90, limit: 99, inv: 0 }); q.send({ c: "angle", v: 90 }); q.run(100);
  ok(q.last().a === 35, "il limite massimo assoluto è 35 gradi");
}

// 5. fine programma: done + trave a zero
{
  const r = rig({});
  r.prog([{ o: "servo", v: 10 }, { o: "wait", v: 0.3 }]);
  r.run(800);
  ok(evs(r, "done").length === 1 && r.last().run === 0 && r.last().a === 0, "fine programma: evento done, trave orizzontale");
}

// 6. STOP: trave a zero, nessun "done"
{
  const r = rig({});
  r.prog([{ o: "pid", kp: 2, ki: 0, kd: 1 }, { o: "forever", b: [] }]);
  r.run(2000); r.send({ c: "stop" }); r.run(300);
  ok(r.last().run === 0 && r.last().pid === 0 && r.last().a === 0 && evs(r, "done").length === 0, "STOP: programma fermo, PID spento, trave a zero");
}

// 7. heartbeat perso: stop automatico
{
  const r = rig({});
  r.prog([{ o: "servo", v: 10 }, { o: "forever", b: [] }]);
  r.run(3000, false);
  ok(evs(r, "err").some((e) => /connessione persa/.test(e.m)) && r.last().run === 0 && r.last().a === 0, "senza ping per 2 s: stop e trave a zero");
}

// 8. protocollo: errori
{
  const r = rig({});
  r.send({ c: "run" }); ok(evs(r, "err").pop().m === "nessun programma", "run senza programma rifiutato");
  r.sim.write("non è json\n"); ok(evs(r, "err").pop().m === "JSON non valido", "JSON non valido");
  r.send({ c: "boh" }); ok(evs(r, "err").pop().m === "comando sconosciuto", "comando sconosciuto");
  r.prog([{ o: "forever", b: [] }]); r.run(100);
  r.send({ c: "cfg", limit: 5 }); ok(evs(r, "err").pop().m === "ferma il programma prima", "cfg rifiutato a programma in esecuzione");
  r.send({ c: "run" }); ok(evs(r, "err").pop().m === "già in esecuzione", "doppio run rifiutato");
  const deep = { c: "prog", p: [] }; let n = deep.p; for (let i = 0; i < 25; i++) { const b = []; n.push({ o: "repeat", n: 1, b }); n = b; }
  r.send({ c: "stop" }); r.run(100); r.send(deep);
  ok(evs(r, "err").pop().m === "JSON non valido", "programma troppo annidato rifiutato come dal firmware (limite JSON 40)");
}

// 9. telemetria ~20 Hz e messaggio "mostra"
{
  const r = rig({});
  r.prog([{ o: "say", v: 3.5 }, { o: "wait", v: 1 }]); r.run(1000);
  ok(r.tele.length >= 19 && r.tele.length <= 21, `telemetria a 20 Hz (${r.tele.length} righe in 1 s)`);
  ok(evs(r, "log").length === 1 && evs(r, "log")[0].v === 3.5, "blocco mostra -> evento log");
}

// 10. modalità PID (tune): parametri cambiati al volo, il controllo resta sul dispositivo
{
  const r = rig({ x0: 55, length: 70 });
  r.send({ c: "tune", on: 1, sp: 20, kp: 2, ki: 0, kd: 1 });
  r.run(8000);
  ok(r.last().run === 1 && r.last().pid === 1 && Math.abs(r.last().x - 20) < 1, `tune: palla da 55 a 20 cm (x=${r.last().x})`);
  r.send({ c: "tune", sp: 45 }); r.run(8000);
  ok(Math.abs(r.last().x - 45) < 1 && r.last().sp === 45, `tune: nuovo obiettivo al volo (x=${r.last().x})`);
  r.send({ c: "tune", sp: 20, kp: 0 }); r.run(500);
  ok(Math.abs(r.last().a) < 0.5, "tune: con Kp=0 e Ki=0 il PID non spinge (a=" + r.last().a + ")");
  r.send({ c: "tune", on: 0 }); r.run(200);
  ok(r.last().run === 0 && r.last().pid === 0 && r.last().a === 0, "tune off: trave a zero");
  r.send({ c: "tune", on: 1, kp: 999, ki: 999, kd: 999 }); r.run(200);
  r.send({ c: "stop" }); r.run(200);
  ok(r.last().run === 0 && r.last().a === 0, "STOP ferma la modalità PID");
}
{
  const r = rig({ x0: 35, length: 70 });
  r.send({ c: "tune", on: 1, sp: 20, kp: 2, ki: 0, kd: 1, launch: -8 });
  r.run(1000);
  ok(r.last().run === 1 && r.last().pid === 0 && Math.abs(r.last().a + 8) < 0.5, "tune: mantiene l'inclinazione di lancio durante il conto alla rovescia");
  r.run(1900);
  ok(r.last().pid === 0, "tune: il PID resta spento fino alla fine dei 3 s");
  r.run(200);
  ok(r.last().run === 1 && r.last().pid === 1, "tune: PID avviato dopo la fase di lancio");
}
{
  const r = rig({ x0: 30 });
  r.send({ c: "tune", on: 1, sp: 20, kp: 2, ki: 0, kd: 1 }); r.run(1000);
  r.run(3000, false);
  ok(evs(r, "err").some((e) => /connessione persa/.test(e.m)) && r.last().run === 0 && r.last().a === 0, "tune: senza ping per 2 s -> stop e trave a zero");
  r.send({ c: "cfg", limit: 10 });
  const q = rig({}); q.send({ c: "tune", on: 1 }); q.send({ c: "cfg", limit: 10 }); ok(evs(q, "err").pop().m === "ferma il programma prima", "cfg rifiutato in modalità PID");
  q.send({ c: "angle", v: 15 }); q.run(100); ok(Math.abs(q.last().a) < 15, "angle manuale ignorato in modalità PID");
  q.prog([{ o: "wait", v: 0.1 }]); q.send({ c: "tune", sp: 5 }); ok(q.last() !== undefined, "tune durante programma gestito");
}
{
  const r = rig({});
  r.prog([{ o: "forever", b: [] }]); r.run(100);
  r.send({ c: "tune", on: 1 }); ok(evs(r, "err").pop().m === "ferma il programma prima", "tune rifiutato mentre gira un programma");
}
// 11. palla fuori portata: non è un errore, niente stop, riprende da sola
{
  const r = rig({ x0: 30, length: 70 });
  r.send({ c: "tune", on: 1, sp: 20, kp: 2, ki: 0, kd: 1 }); r.run(3000);
  r.sim.setBallPresent(false); r.run(1500);
  ok(r.last().run === 1 && r.last().ok === 0 && evs(r, "err").length === 0, "palla fuori 1,5 s: PID ancora attivo, nessun errore, ok=0");
  r.run(2500);   // totale 4 s: oltre i 3 s di attesa
  ok(r.last().run === 1 && r.last().a === 0 && evs(r, "err").length === 0, "palla fuori 4 s: trave orizzontale, PID ancora armato, nessun errore");
  r.sim.setBallPresent(true); r.sim.setBall(50); r.run(9000);
  ok(r.last().ok === 1 && r.last().run === 1 && Math.abs(r.last().x - 20) < 1, `palla di nuovo visibile: il PID riprende da solo (x=${r.last().x})`);
}
{
  const r = rig({ x0: 30, length: 70 });
  r.prog([{ o: "forever", b: [{ o: "say", v: { o: "pos" } }, { o: "wait", v: 0.2 }] }]); r.run(500);
  r.sim.setBallPresent(false); r.run(3000);
  ok(r.last().run === 1 && evs(r, "err").length === 0, "programma: palla fuori 3 s -> continua, nessun errore");
  r.sim.setBallPresent(true); r.run(500);
  ok(r.last().ok === 1 && r.last().run === 1, "programma: palla di nuovo visibile");
}
// Competizione: conto alla rovescia, PID regolabile, gara 60 s e punteggio
{
  const r = rig({ length: 70, x0: 35, blindBeyond: 62, autoPlace: true });
  r.send({ c: "hello" });
  r.send({ c: "comp", on: 1, sp: 30, kp: 2, ki: 0, kd: 1 });
  r.run(1000);
  ok(evs(r, "comp_countdown").length === 1 && r.last().cs === 1 && r.last().run === 1 && r.last().ct <= 2100, "competizione: conto alla rovescia partito");
  ok(r.last().ok === 0 && r.last().a < -3, `competizione: palla in fondo non vista, trave inclinata verso il sensore (a=${r.last().a})`);
  r.send({ c: "tune", on: 1, sp: 10 });
  ok(evs(r, "err").some((e) => e.m === "competizione in corso"), "competizione: tune con on rifiutato");
  r.send({ c: "tune", sp: 32, kp: 2.5, ki: 0.1, kd: 1 });
  r.run(100);
  ok(r.last().cs === 1 && r.last().sp === 32 && evs(r, "err").length === 1, "competizione: parametri PID regolabili durante il conto alla rovescia");
  r.send({ c: "run" }); r.send({ c: "cfg", center: 90 });
  ok(evs(r, "err").length === 3, "competizione: run e cfg rifiutati");
  r.run(1800);
  ok(evs(r, "comp_start").length === 0 && r.last().cs === 1, "competizione: conto alla rovescia dura almeno 3 s");
  r.run(200);
  ok(evs(r, "comp_start").length === 1 && r.last().cs === 2, "competizione: gara partita dopo 3 s");
  r.send({ c: "tune", sp: 31, kp: 1.8, ki: 0, kd: 1 });
  r.run(100);
  ok(r.last().cs === 2 && r.last().sp === 31 && evs(r, "err").length === 3, "competizione: obiettivo e PID aggiornabili durante la gara");
  r.sim.setBallPresent(false);
  r.run(61000);
  const end = evs(r, "comp_end")[0];
  ok(end && end.abort === 0 && end.ticks === 1200 && end.w.length === 10, "competizione: fine gara dopo 60 s con 1200 campioni");
  ok(evs(r, "comp_win").length === 10, "competizione: 10 eventi finestra");
  ok(end && end.pts < 10, `competizione: punteggio sotto il massimo se la palla non è visibile (${end && end.pts.toFixed(2)})`);
  ok(r.last().cs === 3 && r.last().run === 0 && Math.abs(r.last().a) < 1, "competizione: finita, trave livellata");
  r.send({ c: "comp", on: 0 }); r.run(200);
  ok(r.last().cs === undefined, "competizione: chiusura risultati");
}
{
  const r = rig({ length: 70, x0: 35, noise: 0 });
  r.send({ c: "comp", on: 1, sp: 35, kp: 2, ki: 0, kd: 1, launch: 0 });
  r.run(3000);
  r.run(30000);
  const end = evs(r, "comp_end");
  ok(end.length === 1 && end[0].abort === 0 && end[0].early === 1 && end[0].pts === 10,
    "competizione: raggiunti 10 punti, conclusione anticipata con punteggio invariato");
  ok(end.length === 1 && end[0].ticks < 1200 && r.last().cs === 3 && r.last().ct === 0 && r.last().run === 0 && r.last().a === 0,
    "competizione: timer fermato e normale procedura di fine gara eseguita prima dei 60 s");
}
{
  const r = rig({ length: 70, x0: 35 });
  r.send({ c: "comp", on: 1, sp: 35, kp: 2, ki: 0, kd: 1 }); r.run(8000);
  r.send({ c: "stop" }); r.run(300);
  const end = evs(r, "comp_end");
  ok(end.length === 1 && end[0].abort === 1 && r.last().run === 0, "competizione: STOP la interrompe (abort=1)");
}
{
  const r = rig({ length: 70, x0: 35 });
  r.send({ c: "comp", on: 1, sp: 35 }); r.run(7000, false);
  ok(evs(r, "comp_end").some((e) => e.abort === 1), "competizione: ping perso = interrotta");
}

console.log(fails ? `\n${fails} controlli falliti` : "\ntutti i controlli del simulatore passano");
process.exit(fails ? 1 : 0);
