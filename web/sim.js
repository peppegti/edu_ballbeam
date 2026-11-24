// Dispositivo simulato: parla lo stesso protocollo dell'ESP32 (PROTOCOLLO.md) e fa girare lo stesso
// interprete (interp.js). Contiene un porting JS della logica di firmware/src/main.cpp
// (comandi, sicurezze, PID a 50 Hz) e una palla virtuale sulla trave.
//
// Uso:  const sim = createSim({ length: 40, onLine: (s) => ... });
//       sim.write('{"c":"hello"}\n');  sim.step(ms);   // fa avanzare il tempo simulato
(function (root) {
  "use strict";
  const { createInterp, clampf } = root.BBInterp || require("./interp.js");
  const { Scorer } = root.BBScorer || require("./scorer.js");
  const COMP_COUNTDOWN_MS = 3000, COMP_RUN_MS = 60000, COMP_TICK_MS = 50, COMP_LAUNCH_DEG = -6;   // come nel firmware
  const HOLD_MS = 3000, HARD_LIMIT = 35, G = 981 /* cm/s^2 */, K_BALL = 5 / 7 /* sfera piena che rotola */;

  function createSim(opts) {
    const o = Object.assign({ length: 40, x0: null, mountInverted: false, centerOffset: 0, noise: 0.1, friction: 0.5, dN: 4, dTau: 0.07, blindBeyond: null, autoPlace: false }, opts);
    // blindBeyond: oltre questa posizione (cm) il sensore non vede la palla (come in fondo alla trave reale)
    // autoPlace: nella competizione la palla viene messa in fondo da sola durante il conto alla rovescia      // come D_SAMPLES / D_TAU del firmware
    const emit = (obj) => { if (o.onLine) o.onLine(JSON.stringify(obj)); };

    // --- configurazione (come cfgCenter/cfgLimit/cfgInv nel firmware)
    const cfg = { center: 90, limit: 20, inv: false };
    // --- stato condiviso (come g_* nel firmware)
    const S = { t: 0, pos: 0, posOk: false, sp: 20, angle: 0, pid: false, kp: 2, ki: 0, kd: 1,
                ballPresent: true, running: false, tune: false, stopReq: false, lastPing: 0, lastGood: 0, cur: -1,
                tuneLaunchActive: false, tuneLaunchLeft: 0, comp: 0, compAborted: false, compPts: 0, compWin: 0, compLeft: 0, holdBall: false };
    let tuneLaunch = COMP_LAUNCH_DEG, tuneLaunchT0 = 0, compLaunch = COMP_LAUNCH_DEG, compT0 = 0, compTick = 0, compArmed = false;
    const scorer = new Scorer();
    const compActive = () => S.comp === 1 || S.comp === 2;
    let prog = null, gen = null, wakeAt = 0, progLoaded = false;
    // --- mondo fisico
    const P = { x: o.x0 === null ? o.length / 2 : o.x0, v: 0, servoDeg: 90, cmdDeg: 90, theta: 0 };
    // --- stato del task di controllo
    const C = { integ: 0, prevPos: 0, dFilt: 0, prevPid: false, hist: [] };

    // ---------- attuatore ----------
    function writeServo(angle) {
      const limit = clampf(cfg.limit, 1, HARD_LIMIT);
      if (Number.isNaN(angle)) angle = 0;
      angle = clampf(angle, -limit, limit);
      S.angle = angle;
      P.cmdDeg = Math.round(clampf(cfg.center + (cfg.inv ? -angle : angle), 0, 180));
    }
    function setManual(angle) { S.pid = false; writeServo(angle); }
    function compFinish(aborted, early) { S.comp = 3; S.compAborted = aborted; S.compEarly = !!early; S.pid = false; S.compLeft = 0; S.holdBall = false; writeServo(0); }
    function sendCompEnd() {
      emit({ e: "comp_end", abort: S.compAborted ? 1 : 0, early: S.compEarly ? 1 : 0, pts: scorer.points(), mae: scorer.mae(), ticks: scorer.ticks,
             w: Array.from({ length: 10 }, (_, i) => scorer.windowPoints(i)),
             wf: Array.from({ length: 10 }, (_, i) => scorer.windowFill(i)), sp: S.sp, kp: S.kp, ki: S.ki, kd: S.kd });
    }

    // ---------- interprete ----------
    const host = {
      nowMs: () => S.t, halted: () => S.stopReq,
      pos: () => S.pos, sp: () => S.sp, angle: () => S.angle,
      servo: setManual, setpoint: (v) => { S.sp = v; },
      pidOn: (kp, ki, kd) => { S.kp = kp; S.ki = ki; S.kd = kd; S.pid = true; },
      pidOff: () => { S.pid = false; },
      say: (v) => emit({ e: "log", v }),
      fail: (m) => { emit({ e: "err", m }); S.stopReq = true; },
      stmt: (id) => { S.cur = id; },
    };
    const interp = createInterp(host);

    function advanceProgram() {
      if (!gen || S.t < wakeAt) return;
      const r = gen.next();
      if (!r.done) { wakeAt = S.t + r.value; return; }
      gen = null; S.cur = -1;
      const wasStopped = S.stopReq;
      S.running = false; S.stopReq = false;
      setManual(0);
      if (!wasStopped) emit({ e: "done" });
    }

    // ---------- fisica (passo da 1 ms) ----------
    function physics() {
      const dt = 0.001, maxMove = 300 * dt;                       // servo: 300 gradi/s
      const d = P.cmdDeg - P.servoDeg;
      P.servoDeg += Math.abs(d) <= maxMove ? d : Math.sign(d) * maxMove;
      P.theta = (o.mountInverted ? -1 : 1) * (P.servoDeg - (90 + o.centerOffset));   // gradi; >0: la palla va verso x grandi
      if (S.holdBall) { P.v = 0; return; }                         // la palla è tenuta a mano (conto alla rovescia)
      const a = K_BALL * G * Math.sin(P.theta * Math.PI / 180) - o.friction * P.v;
      P.v += a * dt; P.x += P.v * dt;
      const lo = 1.5, hi = o.length - 1.5;
      if (P.x < lo) { P.x = lo; if (P.v < 0) P.v *= -0.2; }
      if (P.x > hi) { P.x = hi; if (P.v > 0) P.v *= -0.2; }
    }

    // ---------- controllo a 50 Hz (porting di controlTask) ----------
    function control() {
      const dt = 0.02;
      const seen = S.ballPresent && !(o.blindBeyond !== null && P.x > o.blindBeyond);
      if (seen) { S.pos = Math.max(0.1, Math.round((P.x + (Math.random() - 0.5) * 2 * o.noise) * 10) / 10); S.lastGood = S.t; }
      S.posOk = S.t - S.lastGood <= 500;                            // palla fuori portata: NON ferma il programma
      const age = S.t - S.lastGood;
      if (S.running && !S.stopReq && S.t - S.lastPing > 2000) { emit({ e: "err", m: "connessione persa: stop" }); S.stopReq = true; }
      if (S.stopReq && !S.running) S.stopReq = false;
      let tuneFail = false;                                         // modalità PID: stesse sicurezze del programma
      if (S.tune && S.t - S.lastPing > 2000) { emit({ e: "err", m: "connessione persa: stop" }); tuneFail = true; }
      if (tuneFail) { S.tune = false; S.pid = false; S.tuneLaunchActive = false; S.tuneLaunchLeft = 0; }
      let tuneLaunchHold = false;
      if (S.tuneLaunchActive && S.tune) {
        const el = S.t - tuneLaunchT0;
        if (el >= COMP_COUNTDOWN_MS) { S.tuneLaunchActive = false; S.tuneLaunchLeft = 0; S.pid = true; emit({ e: "tune_start" }); }
        else { S.tuneLaunchLeft = COMP_COUNTDOWN_MS - el; S.pid = false; tuneLaunchHold = true; }
      }
      let compHold = false;
      if (compActive() && S.t - S.lastPing > 2000) { emit({ e: "err", m: "connessione persa: stop" }); compFinish(true); sendCompEnd(); }
      if (S.comp === 1) {                                           // conto alla rovescia: trave inclinata verso il sensore, PID spento
        const el = S.t - compT0;
        if (o.autoPlace && el >= COMP_COUNTDOWN_MS - 1000) S.holdBall = false;   // la palla viene lasciata 1 s prima del via
        if (el >= COMP_COUNTDOWN_MS) {
          S.comp = 2; compT0 = S.t; compTick = 0; compArmed = false; scorer.reset(); S.compPts = 0; S.compWin = 0; S.holdBall = false; emit({ e: "comp_start" });
        } else { S.compLeft = COMP_COUNTDOWN_MS - el; S.pid = false; compHold = true; }
      }
      if (S.comp === 2) {
        const el = S.t - compT0, closed = [];
        while (!scorer.done() && compTick < Math.floor(el / COMP_TICK_MS)) {
          const w = scorer.tick(age <= 100, Math.abs(Math.fround(S.sp - S.pos))); compTick++;
          if (w >= 0) closed.push(w);
        }
        S.compPts = scorer.points(); S.compWin = Math.min(9, Math.floor(scorer.ticks / 120));
        S.compLeft = el >= COMP_RUN_MS ? 0 : COMP_RUN_MS - el;
        if (!compArmed) { if (age <= 100) { compArmed = true; S.pid = true; } else { S.pid = false; compHold = true; } }
        for (const w of closed) emit({ e: "comp_win", i: w, p: scorer.windowPoints(w), f: scorer.windowFill(w) });
        if (S.compPts >= 10 && el < COMP_RUN_MS) { compFinish(false, true); sendCompEnd(); }
        else if (el >= COMP_RUN_MS) { compFinish(false); sendCompEnd(); }
      }
      if (S.pid && age <= HOLD_MS) {                                // palla persa: ultima posizione nota per HOLD_MS
        const err = S.sp - S.pos;
        if (!C.prevPid || C.wasLost) { C.wasLost = false; C.integ = 0; C.prevPos = S.pos; C.dFilt = 0; C.hist = [S.pos]; }
        C.integ = clampf(C.integ + err * dt, -50, 50);
        C.hist.push(S.pos); if (C.hist.length > o.dN + 1) C.hist.shift();
        const dRaw = -(S.pos - C.hist[0]) / (dt * (C.hist.length - 1 || 1));   // derivata sulla misura, su dN campioni
        C.dFilt += (dt / (o.dTau + dt)) * (dRaw - C.dFilt);
        C.prevPos = S.pos;
        if (age > 100) C.dFilt = 0;                                 // niente campioni nuovi: velocità non nota
        writeServo(S.kp * err + S.ki * C.integ + S.kd * C.dFilt);
      } else if (S.pid) { writeServo(0); C.wasLost = true; }       // persa da più di HOLD_MS: trave orizzontale, riprende da sola
      C.prevPid = S.pid;
      if (S.stopReq) { S.pid = false; writeServo(0); }
      if (tuneFail) writeServo(0);
      if (compHold && S.comp !== 3) writeServo(compLaunch);
      if (tuneLaunchHold && S.tune) writeServo(tuneLaunch);
    }

    // ---------- comandi (porting di handleLine) ----------
    function depthOf(x, d) {
      if (x === null || typeof x !== "object") return d;
      let m = d + 1;
      for (const k in x) m = Math.max(m, depthOf(x[k], d + 1));
      return m;
    }
    function handleLine(line) {
      let d;
      try { d = JSON.parse(line); } catch (e) { return emit({ e: "err", m: "JSON non valido" }); }
      if (depthOf(d, 0) > 40) return emit({ e: "err", m: "JSON non valido" });   // NestingLimit(40) del firmware
      const c = d && typeof d.c === "string" ? d.c : "";
      S.lastPing = S.t;
      switch (c) {
        case "hello": emit({ e: "hello", v: 1, fw: "sim", ok: S.posOk ? 1 : 0, limit: cfg.limit }); break;
        case "ping": break;
        case "cfg":
          if (compActive()) return emit({ e: "err", m: "competizione in corso" });
          if (S.running || S.tune) return emit({ e: "err", m: "ferma il programma prima" });
          if (typeof d.center === "number") cfg.center = clampf(d.center, 60, 120);
          if (typeof d.limit === "number") cfg.limit = clampf(d.limit, 1, HARD_LIMIT);
          if (d.inv !== undefined && d.inv !== null) cfg.inv = Number(d.inv) !== 0;
          setManual(0); emit({ e: "ok" }); break;
        case "prog":
          if (compActive()) return emit({ e: "err", m: "competizione in corso" });
          if (S.running) return emit({ e: "err", m: "programma in esecuzione" });
          prog = d.p; progLoaded = prog !== undefined && prog !== null;
          if (progLoaded) emit({ e: "ok" }); else emit({ e: "err", m: "programma vuoto" });
          break;
        case "tune":                                                 // {"c":"tune","on":1,"sp":..,"kp":..,"ki":..,"kd":..}
          if (compActive() && d.on !== undefined && d.on !== null) return emit({ e: "err", m: "competizione in corso" });
          if (S.running) return emit({ e: "err", m: "ferma il programma prima" });
          if (typeof d.sp === "number") S.sp = clampf(d.sp, 0, 100);
          if (typeof d.kp === "number") S.kp = clampf(d.kp, 0, 50);
          if (typeof d.ki === "number") S.ki = clampf(d.ki, 0, 20);
          if (typeof d.kd === "number") S.kd = clampf(d.kd, 0, 20);
          if (d.on !== undefined && d.on !== null) {
            if (Number(d.on) !== 0) {
              if (!S.posOk) return emit({ e: "err", m: "sensore non valido" });
              S.stopReq = false; S.tune = true;
              if (typeof d.launch === "number") {
                tuneLaunch = clampf(d.launch, -HARD_LIMIT, 0);
                tuneLaunchT0 = S.t; S.tuneLaunchLeft = COMP_COUNTDOWN_MS; S.tuneLaunchActive = true; S.pid = false;
                writeServo(tuneLaunch);
              } else {
                S.tuneLaunchActive = false; S.tuneLaunchLeft = 0; S.pid = true;
              }
            } else { S.tune = false; S.pid = false; S.tuneLaunchActive = false; S.tuneLaunchLeft = 0; writeServo(0); }
          }
          break;
        case "comp":                                                 // {"c":"comp","on":1,"sp":..,"kp":..,"ki":..,"kd":..,"launch":-6}
          if (!(d.on === undefined || Number(d.on) !== 0)) {
            if (compActive()) { compFinish(true); sendCompEnd(); }
            S.comp = 0;
          } else {
            if (S.running) return emit({ e: "err", m: "ferma il programma prima" });
            if (compActive()) return emit({ e: "err", m: "competizione in corso" });
            if (typeof d.sp === "number") S.sp = clampf(d.sp, 0, 100);
            if (typeof d.kp === "number") S.kp = clampf(d.kp, 0, 50);
            if (typeof d.ki === "number") S.ki = clampf(d.ki, 0, 20);
            if (typeof d.kd === "number") S.kd = clampf(d.kd, 0, 20);
            compLaunch = typeof d.launch === "number" ? clampf(d.launch, -HARD_LIMIT, 0) : COMP_LAUNCH_DEG;   // sempre verso il sensore
            S.tune = false; S.stopReq = false; S.pid = false;
            S.tuneLaunchActive = false; S.tuneLaunchLeft = 0;
            scorer.reset(); S.compPts = 0; S.compWin = 0; S.compAborted = false; S.compEarly = false; compTick = 0; compArmed = false;
            compT0 = S.t; S.compLeft = COMP_COUNTDOWN_MS; S.comp = 1;
            if (o.autoPlace) { P.x = o.length - 1.5; P.v = 0; S.holdBall = true; }
            writeServo(compLaunch);
            emit({ e: "comp_countdown" });
          }
          break;
        case "run":
          if (compActive()) return emit({ e: "err", m: "competizione in corso" });
          if (S.running) return emit({ e: "err", m: "già in esecuzione" });
          if (!progLoaded) return emit({ e: "err", m: "nessun programma" });
          if (!S.posOk) return emit({ e: "err", m: "sensore non valido" });
          S.stopReq = false; S.tune = false; S.tuneLaunchActive = false; S.tuneLaunchLeft = 0; S.running = true; S.lastPing = S.t;
          S.cur = -1; gen = interp.run(prog); wakeAt = S.t;
          break;
        case "stop":
          if (compActive()) { compFinish(true); sendCompEnd(); }
          S.stopReq = true;
          if (!S.running) { S.tune = false; S.tuneLaunchActive = false; S.tuneLaunchLeft = 0; setManual(0); S.stopReq = false; }
          break;
        case "angle": if (!S.running && !S.tune && !compActive()) setManual(typeof d.v === "number" ? d.v : 0); break;
        default: emit({ e: "err", m: "comando sconosciuto" });
      }
    }

    let buf = "";
    function write(str) {                                           // come la seriale: arrivano pezzi di testo
      buf += str;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
        if (line.length > 12287) emit({ e: "err", m: "riga troppo lunga" });
        else if (line.length) handleLine(line);
      }
    }

    // ---------- tempo ----------
    function step(ms) {
      for (let i = 0; i < ms; i++) {
        S.t++;
        physics();
        if (S.t % 20 === 0) control();
        advanceProgram();
        if (S.t % 50 === 0) {
          const m = { t: S.t, x: +S.pos.toFixed(1), sp: S.sp, a: +S.angle.toFixed(1), run: (S.running || S.tune || compActive()) ? 1 : 0, pid: S.pid ? 1 : 0, ok: S.posOk ? 1 : 0 };
          if (S.running && S.cur >= 0) m.s = S.cur;
          if (S.tuneLaunchActive) m.tl = S.tuneLaunchLeft;
          if (S.comp) { m.cs = S.comp; m.ct = S.compLeft; m.cp = +S.compPts.toFixed(2); m.cw = S.compWin; }
          emit(m);
        }
      }
    }
    S.pos = P.x; S.lastGood = 0;
    control();   // prima misura (il sensore del firmware è pronto in pochi ms)

    return {
      write, step,
      view: () => ({ x: P.x, theta: P.theta, length: o.length }),
      setBall: (x) => { P.x = clampf(x, 1.5, o.length - 1.5); P.v = 0; },
      setLength: (l) => { o.length = l; P.x = clampf(P.x, 1.5, l - 1.5); },
      setBallPresent: (b) => { S.ballPresent = !!b; },
      setMountInverted: (b) => { o.mountInverted = !!b; },
    };
  }

  const api = { createSim };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.BBSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
