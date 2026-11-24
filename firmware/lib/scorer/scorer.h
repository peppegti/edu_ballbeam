// Punteggio della competizione — logica pura, usata dal firmware e dai test su PC.
// Deve restare identica a web/scorer.js (stessi casi: tests/scorer_cases.src.js).
//
// Regole: 60 s divisi in 10 finestre da 6 s. Ogni 50 ms si guarda un campione: conta come "dentro"
// se la misura è recente (valid) e l'errore |obiettivo - posizione| è <= BAND. Ogni finestra vale
// fino a 2.5 punti; il totale è limitato a 10.
#pragma once
#include <stdint.h>

namespace bb {

struct Scorer {
  static const int WINDOWS = 10;
  static const int TICKS_PER_WINDOW = 120;               // 120 campioni da 50 ms = 6 s
  static const int TOTAL_TICKS = WINDOWS * TICKS_PER_WINDOW;
  static constexpr float BAND = 6.0f;                    // ± cm dall'obiettivo
  static constexpr float POINTS_PER_WINDOW = 2.5f;
  static constexpr float MAX_POINTS = 10.0f;
  static constexpr float UNSEEN_ERR = 35.0f;             // errore attribuito ai campioni senza misura (solo per l'errore medio)

  uint16_t in[WINDOWS];
  uint32_t ticks;
  double absErr;

  Scorer() { reset(); }
  void reset() { for (int i = 0; i < WINDOWS; i++) in[i] = 0; ticks = 0; absErr = 0; }
  bool done() const { return ticks >= (uint32_t)TOTAL_TICKS; }

  // Un campione ogni 50 ms. err = |obiettivo - posizione| (>= 0). Ritorna l'indice della finestra
  // appena completata, altrimenti -1. Dopo l'ultimo campione non conta più nulla.
  int tick(bool valid, float err) {
    if (done()) return -1;
    int w = (int)(ticks / TICKS_PER_WINDOW);
    if (valid && err <= BAND) in[w]++;
    absErr += valid ? (double)err : (double)UNSEEN_ERR;
    ticks++;
    return (ticks % TICKS_PER_WINDOW == 0) ? w : -1;
  }

  float windowFill(int w) const { return (float)in[w] / (float)TICKS_PER_WINDOW; }
  float windowPoints(int w) const { return windowFill(w) * POINTS_PER_WINDOW; }
  float points() const {
    float s = 0;
    for (int w = 0; w < WINDOWS; w++) s += windowPoints(w);
    return s > MAX_POINTS ? MAX_POINTS : s;
  }
  float mae() const { return ticks ? (float)(absErr / (double)ticks) : 0.0f; }   // errore medio assoluto (cm)
};

}  // namespace bb
