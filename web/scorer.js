// Punteggio della competizione — gemello di firmware/lib/scorer/scorer.h (stesse regole, stessi test).
// 60 s = 10 finestre da 6 s; un campione ogni 50 ms vale "dentro" se la misura è recente e |errore| <= 6 cm.
// Ogni finestra vale fino a 2.5 punti; il totale è limitato a 10.
(function (root) {
  "use strict";
  const f = Math.fround;
  const WINDOWS = 10, TICKS_PER_WINDOW = 120, TOTAL_TICKS = WINDOWS * TICKS_PER_WINDOW, BAND = f(6.0), UNSEEN_ERR = 35;

  class Scorer {
    constructor() { this.reset(); }
    reset() { this.inW = new Array(WINDOWS).fill(0); this.ticks = 0; this.absErr = 0; }
    done() { return this.ticks >= TOTAL_TICKS; }
    // ritorna l'indice della finestra appena completata, altrimenti -1
    tick(valid, err) {
      if (this.done()) return -1;
      const w = Math.floor(this.ticks / TICKS_PER_WINDOW);
      err = f(err);
      if (valid && err <= BAND) this.inW[w]++;
      this.absErr += valid ? err : UNSEEN_ERR;
      this.ticks++;
      return this.ticks % TICKS_PER_WINDOW === 0 ? w : -1;
    }
    windowFill(w) { return f(this.inW[w] / TICKS_PER_WINDOW); }
    windowPoints(w) { return f(this.windowFill(w) * 2.5); }
    points() { let s = 0; for (let w = 0; w < WINDOWS; w++) s = f(s + this.windowPoints(w)); return Math.min(10, s); }
    mae() { return this.ticks ? f(this.absErr / this.ticks) : 0; }
  }

  const api = { Scorer, WINDOWS, TICKS_PER_WINDOW, TOTAL_TICKS, BAND, UNSEEN_ERR };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.BBScorer = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
