// Casi di test del punteggio della competizione (C++ firmware/lib/scorer/scorer.h e JS web/scorer.js).
// runs: [[quanti_campioni, valid(1/0), errore_cm], ...] — un campione ogni 50 ms, 120 campioni = 1 finestra (6 s).
// expect: windows (10 valori), points (totale), mae (errore medio, cm), ticks, closed (finestre completate, in ordine).
// "Dentro" = misura recente E errore <= 6.0 cm; finestra = dentro/120 * 2.5, totale limitato a 10.
const all10 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const zeros = (n) => new Array(n).fill(0);

module.exports = [
  { name: "tutto_dentro", runs: [[1200, 1, 0]], expect: { windows: new Array(10).fill(2.5), points: 10, mae: 0, ticks: 1200, closed: all10 } },
  { name: "tutto_fuori_banda", runs: [[1200, 1, 7.5]], expect: { windows: zeros(10), points: 0, mae: 7.5, ticks: 1200, closed: all10 } },
  { name: "bordo_banda_incluso_6.0", runs: [[1200, 1, 6.0]], expect: { windows: new Array(10).fill(2.5), points: 10, mae: 6, ticks: 1200, closed: all10 } },
  { name: "appena_fuori_6.01", runs: [[1200, 1, 6.01]], expect: { windows: zeros(10), points: 0, mae: 6.01, ticks: 1200, closed: all10 } },
  { name: "palla_non_vista_conta_fuori", runs: [[1200, 0, 0]], expect: { windows: zeros(10), points: 0, mae: 35, ticks: 1200, closed: all10 } },
  { name: "finestra_a_meta", runs: [[60, 1, 0], [60, 1, 8], [1080, 1, 0]],
    expect: { windows: [1.25, ...new Array(9).fill(2.5)], points: 10, mae: 0.4, ticks: 1200, closed: all10 } },
  { name: "interrotta_dopo_150_campioni", runs: [[150, 1, 0]],
    expect: { windows: [2.5, 0.625, ...zeros(8)], points: 3.125, mae: 0, ticks: 150, closed: [0] } },
  { name: "oltre_i_60_secondi_non_conta", runs: [[1300, 1, 0]], expect: { windows: new Array(10).fill(2.5), points: 10, mae: 0, ticks: 1200, closed: all10 } },
  { name: "misto_validi_e_non_vista", runs: [[30, 1, 1], [30, 0, 0], [60, 1, 8]],
    expect: { windows: [0.625, ...zeros(9)], points: 0.625, mae: 13, ticks: 120, closed: [0] } },
  { name: "finestre_diverse", runs: [[120, 1, 0], [90, 1, 1], [30, 1, 9], [960, 1, 9]],
    expect: { windows: [2.5, 1.875, ...zeros(8)], points: 4.375, mae: 7.5, ticks: 1200, closed: all10 } },
  { name: "nessun_campione", runs: [], expect: { windows: zeros(10), points: 0, mae: 0, ticks: 0, closed: [] } },
];
