# Protocollo USB — Ball & Beam a blocchi

Collegamento: USB seriale, 115200 baud, 8N1. Una riga = un messaggio JSON (terminato da `\n`). Max 12 KB per riga. Annidamento JSON massimo 40 livelli (circa 18 blocchi uno dentro l'altro): oltre, l'ESP32 risponde `JSON non valido`.

## Trasporti

Lo stesso protocollo viaggia su due canali (uno o più client contemporaneamente, i messaggi dell'ESP32 vanno a tutti):
- **USB seriale** (come sopra).
- **Wi-Fi**: l'ESP32 si collega alla rete (IP assegnato dalla rete via DHCP; fisso solo se `WIFI_IP` è definito in `firmware/src/secrets.h`; hostname `ballbeam.local`). `http://<ip>/` serve la pagina di controllo; **WebSocket `ws://<ip>:81/`**: ogni messaggio di testo è una riga JSON (senza `
` finale). `GET /health` risponde `ok`. Nessuna autenticazione: va usato solo su una rete di cui ci si fida.
- `hello` risponde anche con `wifi` (0/1), `ip` e `rssi` quando collegato.

## Browser → ESP32 (comandi, campo `c`)

| Comando | Esempio | Effetto |
|---|---|---|
| hello | `{"c":"hello"}` | L'ESP32 risponde con `hello` (versione, stato sensore) |
| ping | `{"c":"ping"}` | Heartbeat. Va inviato ogni 500 ms: se manca per 2 s con programma in esecuzione, trave a zero e stop |
| cfg | `{"c":"cfg","center":90,"limit":20,"inv":0}` | Centro servo (gradi), limite escursione ±gradi (max 35), inversione segno |
| prog | `{"c":"prog","p":[...]}` | Carica il programma (rifiutato se in esecuzione) |
| run | `{"c":"run"}` | Avvia il programma caricato |
| stop | `{"c":"stop"}` | Ferma programma e PID, trave a zero |
| angle | `{"c":"angle","v":5}` | Angolo manuale (solo a programma fermo), per calibrare |
| tune | `{"c":"tune","on":1,"sp":20,"kp":2,"ki":0,"kd":1,"launch":-6}` | **Modalità PID**: nessun programma, il PID gira sull'ESP32 (ciclo 5 ms). `sp` (0–100 cm), `kp` (0–50), `ki` (0–20), `kd` (0–20) sono opzionali e si possono mandare anche a PID acceso (la pagina li manda ~10 volte/s). Con `on:1`, se è presente `launch` (−35…0°), la trave mantiene quell'inclinazione per 3 s e poi parte il PID; senza `launch` il PID parte subito. L'avvio è rifiutato se il sensore non è valido. `on:0` spegne e porta la trave a zero. Durante la competizione si può usare `tune` senza `on` per aggiornare dinamicamente `sp/kp/ki/kd`. Valgono le stesse sicurezze del programma; `cfg` e `angle` sono ignorati/rifiutati mentre è attivo. Telemetria: `run:1` durante il lancio, `pid:1` quando il PID è attivo e `tl` con i ms rimasti della fase di lancio. |
| comp | `{"c":"comp","on":1,"sp":35,"kp":1.5,"ki":0,"kd":0.05,"launch":-6}` | **Competizione** (fw 1.7). Conto alla rovescia di 3 s («3, 2, 1, VIA!») con PID spento e trave inclinata di `launch` gradi (−35…0, sempre verso il sensore; default −6) perché la palla messa in fondo rotoli verso il sensore; poi 60 s di gara con PID: parte appena il sensore vede la palla (prima resta l'inclinazione di lancio). Durante la competizione `tune` senza `on` aggiorna dinamicamente `sp/kp/ki/kd`; `cfg`, `prog`, `run` e `tune` con `on` sono rifiutati (`err` "competizione in corso") e `angle` ignorato; `stop` (o ping perso per 2 s) interrompe la gara. `on:0` annulla, o chiude i risultati dopo la fine. Il punteggio è calcolato dalla scheda (firmware/lib/scorer, gemello web/scorer.js): 10 finestre da 6 s, ogni finestra assegna fino a 2,5 punti in proporzione ai campioni dentro (misura vista e |sp−x| ≤ 6 cm); il totale è limitato a 10. Palla non vista conta come errore 35 cm nell'errore medio (spareggio). |

## ESP32 → Browser

- Telemetria ogni 50 ms: `{"t":12345,"x":18.4,"sp":20,"a":-3.2,"run":1,"pid":1,"ok":1}`
  `x` = posizione palla in cm dal sensore, `sp` = setpoint cm, `a` = angolo trave in gradi (0 = orizzontale), `ok` = sensore valido.
  `s` (solo con programma in esecuzione e istruzione con `i`) = indice `i` dell'istruzione che l'interprete sta eseguendo.
  Durante la competizione (e fino a `comp:0` dopo la fine): `cs` fase (1 conto alla rovescia, 2 gara, 3 finita), `ct` ms rimasti nella fase, `cp` punti attuali, `cw` finestra in corso (0–9); `run:1` finché è attiva.
- Eventi (campo `e`): `hello`, `ok`, `err` (campo `m`), `log` (campo `v`, dal blocco "mostra"), `done` (programma terminato).
  Competizione: `comp_countdown`, `comp_start`, `comp_win` (`i` finestra chiusa, `p` punti 0–2,5, `f` riempimento 0–1), `comp_end` (`abort` 0/1, `pts` totale limitato a 10, `mae` cm, `ticks`, `w` = 10 punteggi di finestra, `wf` = 10 riempimenti, `sp,kp,ki,kd`).

## Programma (campo `p`): lista di istruzioni

Ogni istruzione ha `o` (operazione) e, opzionalmente, `i` (intero: indice dell'istruzione nel programma, scelto dal browser). Un'espressione è un numero oppure un oggetto con `o`.
L'interprete ignora `i` salvo per riportarlo nella telemetria (`s`), così il browser evidenzia il blocco in esecuzione.

Istruzioni:
- `{"o":"servo","v":E}` angolo trave (gradi, limitato dal firmware); disattiva il PID
- `{"o":"wait","v":E}` attendi E secondi
- `{"o":"repeat","n":E,"b":[...]}` ripeti n volte
- `{"o":"forever","b":[...]}` ripeti per sempre
- `{"o":"while","c":E,"b":[...]}` finché la condizione è vera
- `{"o":"until","c":E}` attendi finché la condizione diventa vera
- `{"o":"if","c":E,"t":[...],"f":[...]}` se / altrimenti
- `{"o":"set","n":"nome","v":E}` assegna variabile; `{"o":"change","n":"nome","v":E}` incrementa
- `{"o":"setpoint","v":E}` posizione obiettivo (cm)
- `{"o":"pid","kp":E,"ki":E,"kd":E}` attiva il PID verso il setpoint
- `{"o":"pid_off"}` disattiva il PID
- `{"o":"say","v":E}` invia un valore al browser

Espressioni:
- `{"o":"pos"}` posizione palla (cm), `{"o":"sp"}` setpoint, `{"o":"angle"}` angolo, `{"o":"time"}` secondi dall'avvio
- `{"o":"var","n":"nome"}`
- `{"o":"bin","op":"+|-|*|/|min|max","a":E,"b":E}`
- `{"o":"cmp","op":"<|>|<=|>=|==|!=","a":E,"b":E}`
- `{"o":"and","a":E,"b":E}`, `{"o":"or","a":E,"b":E}`, `{"o":"not","a":E}`
- `{"o":"abs","a":E}`

## Sicurezza (nel firmware, non aggirabile dai blocchi)

- Angolo sempre limitato a ±`limit` (default 20°, max 35°).
- Sensore senza misura valida per 500 ms: stop e trave a zero.
- Heartbeat perso, STOP, fine programma: trave a zero.
- Integrale del PID limitato (anti-windup).
