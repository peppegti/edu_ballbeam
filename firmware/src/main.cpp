// Ball & Beam a blocchi — firmware ESP32 (VL53L4CD + servo)
// Protocollo: vedi PROTOCOLLO.md (JSON per riga su USB seriale, 115200).
#include <Arduino.h>
#include <Wire.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>
#include <vl53l4cd_class.h>
#include <interp.h>
#include <scorer.h>
#if __has_include("secrets.h")          // Wi-Fi: copia secrets.example.h in secrets.h
#include "secrets.h"
#define HAVE_WIFI 1
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <WebSocketsServer.h>
extern const uint8_t page_gz_start[] asm("_binary_embed_page_html_gz_start");   // pagina web compressa (embed_page.py)
extern const uint8_t page_gz_end[]   asm("_binary_embed_page_html_gz_end");
#endif

// ---------- Hardware ----------
#define PIN_SERVO 13
#define PIN_SDA   21
#define PIN_SCL   22
#define BAUD      115200
#define FW_VERSION "1.7"
#define COMP_COUNTDOWN_MS 3000   // conto alla rovescia "3, 2, 1, VIA!"
#define COMP_RUN_MS       60000  // durata della gara
#define COMP_TICK_MS      50     // un campione di punteggio ogni 50 ms
#define COMP_LAUNCH_DEG   -6.0f  // inclinazione durante il conto alla rovescia: la palla rotola verso il sensore
#define D_SAMPLES 4           // la derivata è calcolata su questi campioni (meno rumore del sensore)
#define D_TAU     0.07f       // costante di tempo del filtro sulla derivata (s)
#define HOLD_MS   3000        // palla fuori portata: per questo tempo il PID usa l'ultima posizione nota, poi raddrizza la trave
#define CTRL_MS   5           // periodo del ciclo di controllo (ms)
#define CTRL_DT   (CTRL_MS / 1000.0f)
#define RANGE_MS  20          // tempo di misura del sensore (ms): a 10 ms il VL53L4CD non dà misure valide a questa distanza

// ---------- Configurazione (modificabile da browser con "cfg") ----------
static float cfgCenter = 91.0f;  // angolo servo con trave orizzontale (misurato sulla trave reale)
static float cfgLimit  = 20.0f;  // escursione massima ± gradi
static bool  cfgInv    = false;  // inverte il verso del servo
static const float HARD_LIMIT = 35.0f;

// ---------- Stato condiviso ----------
static volatile float g_pos = 0;        // cm dal sensore
static volatile bool  g_posOk = false;
static volatile float g_sp = 20;        // setpoint cm
static volatile float g_angle = 0;      // gradi rispetto all'orizzontale
static volatile bool  g_pid = false;
static volatile float g_kp = 2, g_ki = 0, g_kd = 1;
static volatile bool  g_running = false;
static volatile bool  g_tune = false;     // modalità PID: parametri regolati dal browser, nessun programma
static volatile bool  g_tuneLaunchActive = false;
static volatile float g_tuneLaunch = COMP_LAUNCH_DEG;
static volatile uint32_t g_tuneLaunchLeft = 0;
static uint32_t tuneLaunchT0 = 0;
static volatile bool  g_stopReq = false;
static volatile bool  g_startReq = false;
static volatile uint32_t g_lastPing = 0;
static volatile uint32_t g_lastGood = 0;
static volatile int g_cur = -1;         // indice dell'istruzione in esecuzione (per evidenziare il blocco)

// ---------- Competizione ----------
static volatile int g_comp = 0;                 // 0 spenta, 1 conto alla rovescia, 2 gara, 3 finita
static volatile bool g_compAborted = false;
static volatile bool g_compEarly = false;
static volatile float g_compPts = 0;            // punti (live)
static volatile int g_compWin = 0;              // finestra in corso (0..9)
static volatile uint32_t g_compLeft = 0;        // ms rimasti nella fase corrente
static float g_compLaunch = COMP_LAUNCH_DEG;
static uint32_t compT0 = 0, compTick = 0;
static bool compArmed = false;                  // il PID parte quando il sensore vede la palla
static bb::Scorer scorer;
static inline bool compActive() { return g_comp == 1 || g_comp == 2; }

static Servo servo;
static VL53L4CD sensor(&Wire, -1);
static SemaphoreHandle_t txMutex;
static SemaphoreHandle_t servoMutex;   // serializza chi decide l'angolo (programma, PID, comandi)
static JsonDocument g_prog;
static bool g_progLoaded = false;

// ---------- Utilità ----------
static float clampf(float v, float lo, float hi) { return bb::clampf(v, lo, hi); }

// Coda dei messaggi per i client WebSocket (scritta da qualunque task, svuotata dal loop()).
#define WSQ_N 24
static String wsq[WSQ_N];
static int wsqHead = 0, wsqCount = 0;
static volatile int wsClients = 0;
static void wsEnqueue(const String& s) {            // da chiamare con txMutex preso
  if (!wsClients) return;
  if (wsqCount == WSQ_N) { wsqHead = (wsqHead + 1) % WSQ_N; wsqCount--; }   // coda piena: scarta il più vecchio
  wsq[(wsqHead + wsqCount) % WSQ_N] = s; wsqCount++;
}
static bool wsPop(String& out) {
  xSemaphoreTake(txMutex, portMAX_DELAY);
  bool ok = wsqCount > 0;
  if (ok) { out = wsq[wsqHead]; wsqHead = (wsqHead + 1) % WSQ_N; wsqCount--; }
  xSemaphoreGive(txMutex);
  return ok;
}

static void sendDoc(const JsonDocument& d) {        // USB seriale + Wi-Fi
  String line;
  serializeJson(d, line);
  xSemaphoreTake(txMutex, portMAX_DELAY);
  Serial.print(line);
  Serial.print('\n');
  wsEnqueue(line);
  xSemaphoreGive(txMutex);
}
static void sendErr(const char* m) { JsonDocument d; d["e"] = "err"; d["m"] = m; sendDoc(d); }
static void sendEv(const char* e)  { JsonDocument d; d["e"] = e; sendDoc(d); }

static void writeServo(float angle) {
  float limit = clampf(cfgLimit, 1, HARD_LIMIT);
  if (isnan(angle)) angle = 0;
  angle = clampf(angle, -limit, limit);
  g_angle = angle;
  float a = cfgCenter + (cfgInv ? -angle : angle);
  servo.write((int)lroundf(clampf(a, 0, 180)));
}

// Angolo manuale: spegne il PID e scrive il servo in modo atomico rispetto al task di controllo.
static void setManual(float angle) {
  xSemaphoreTake(servoMutex, portMAX_DELAY);
  g_pid = false;
  writeServo(angle);
  xSemaphoreGive(servoMutex);
}

static void stopAll() { setManual(0); }

// Fine gara (naturale o interrotta). Da chiamare con servoMutex preso.
static void compFinish(bool aborted, bool early = false) {
  g_comp = 3; g_compAborted = aborted; g_compEarly = early; g_pid = false; g_compLeft = 0;
  writeServo(0);
}
static void sendCompEnd() {
  JsonDocument d;
  d["e"] = "comp_end"; d["abort"] = g_compAborted ? 1 : 0; d["early"] = g_compEarly ? 1 : 0;
  d["pts"] = scorer.points(); d["mae"] = scorer.mae(); d["ticks"] = scorer.ticks;
  JsonArray w = d["w"].to<JsonArray>();
  JsonArray wf = d["wf"].to<JsonArray>();
  for (int i = 0; i < bb::Scorer::WINDOWS; i++) { w.add(scorer.windowPoints(i)); wf.add(scorer.windowFill(i)); }
  d["sp"] = g_sp; d["kp"] = g_kp; d["ki"] = g_ki; d["kd"] = g_kd;
  sendDoc(d);
}

// ---------- Interprete (lib/interp/interp.h) ----------
struct FwHost : bb::Host {
  uint32_t nowMs() override { return millis(); }
  void sleepMs(uint32_t ms) override { vTaskDelay(pdMS_TO_TICKS(ms)); }
  bool halted() override { return g_stopReq; }
  float pos() override { return g_pos; }
  float sp() override { return g_sp; }
  float angle() override { return g_angle; }
  void servo(float deg) override { setManual(deg); }
  void setpoint(float cm) override { g_sp = cm; }
  void pidOn(float kp, float ki, float kd) override {
    xSemaphoreTake(servoMutex, portMAX_DELAY);
    g_kp = kp; g_ki = ki; g_kd = kd; g_pid = true;
    xSemaphoreGive(servoMutex);
  }
  void pidOff() override {
    xSemaphoreTake(servoMutex, portMAX_DELAY);
    g_pid = false;
    xSemaphoreGive(servoMutex);
  }
  void say(float v) override { JsonDocument d; d["e"] = "log"; d["v"] = v; sendDoc(d); }
  void fail(const char* msg) override { sendErr(msg); g_stopReq = true; }
  void stmt(int id) override { g_cur = id; }
};
static FwHost fwHost;
static bb::Interp interp(fwHost);

static void programTask(void*) {
  for (;;) {
    if (g_startReq) {
      g_startReq = false;
      g_lastPing = millis();
      g_cur = -1;
      interp.run(g_prog["p"]);
      g_cur = -1;
      bool wasStopped = g_stopReq;
      g_running = false;
      g_stopReq = false;
      stopAll();
      if (!wasStopped) sendEv("done");
    }
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

// ---------- Loop di controllo (50 Hz) ----------
static void controlTask(void*) {
  float integ = 0, prevPos = 0, dFilt = 0;
  uint32_t prevSampleMs = 0;
  float hp[D_SAMPLES + 1]; uint32_t ht[D_SAMPLES + 1]; int hn = 0;   // ultime posizioni e istanti
  bool prevPid = false, wasLost = false;
  TickType_t last = xTaskGetTickCount();
  for (;;) {
    bool newSample = false;
    uint32_t sampleMs = 0;
    uint8_t ready = 0;
    sensor.VL53L4CD_CheckForDataReady(&ready);
    if (ready) {
      VL53L4CD_Result_t r;
      sensor.VL53L4CD_ClearInterrupt();
      sensor.VL53L4CD_GetResult(&r);
      if (r.range_status == 0 && r.distance_mm > 0) {
        g_pos = r.distance_mm / 10.0f;
        g_posOk = true;
        g_lastGood = millis();
        sampleMs = g_lastGood;
        newSample = true;
      }
    }
    if (millis() - g_lastGood > 500) g_posOk = false;

    // sicurezze. La palla fuori portata NON ferma il programma (g_posOk=false basta a segnalarlo alla pagina).
    if (g_running && !g_stopReq && millis() - g_lastPing > 2000) { sendErr("connessione persa: stop"); g_stopReq = true; }
    if (g_stopReq && !g_running) g_stopReq = false;

    // modalità PID: stesse sicurezze del programma
    bool tuneFail = false;
    if (g_tune && millis() - g_lastPing > 2000) { sendErr("connessione persa: stop"); tuneFail = true; }

    bool compFail = false;                               // competizione: connessione persa = gara interrotta
    if (compActive() && millis() - g_lastPing > 2000) { sendErr("connessione persa: stop"); compFail = true; }

    uint32_t age = millis() - g_lastGood;               // da quanto non vedo la palla
    int evWin = -1; bool evStart = false, evTuneStart = false, evEnd = false, compHold = false, tuneLaunchHold = false;
    xSemaphoreTake(servoMutex, portMAX_DELAY);
    if (tuneFail) { g_tune = false; g_pid = false; g_tuneLaunchActive = false; g_tuneLaunchLeft = 0; }
    if (compFail) { compFinish(true); evEnd = true; }
    uint32_t nowMs = millis();
    if (g_tuneLaunchActive && g_tune) {
      uint32_t el = nowMs - tuneLaunchT0;
      if (el >= COMP_COUNTDOWN_MS) {
        g_tuneLaunchActive = false; g_tuneLaunchLeft = 0; g_pid = true; evTuneStart = true;
      } else {
        g_tuneLaunchLeft = COMP_COUNTDOWN_MS - el; g_pid = false; tuneLaunchHold = true;
      }
    }
    if (g_comp == 1) {                                  // conto alla rovescia: trave inclinata verso il sensore, PID spento
      uint32_t el = nowMs - compT0;
      if (el >= COMP_COUNTDOWN_MS) {
        g_comp = 2; compT0 = nowMs; compTick = 0; compArmed = false; scorer.reset(); g_compPts = 0; g_compWin = 0; evStart = true;
      } else { g_compLeft = COMP_COUNTDOWN_MS - el; g_pid = false; compHold = true; }
    }
    if (g_comp == 2) {
      uint32_t el = nowMs - compT0;
      while (!scorer.done() && compTick < el / COMP_TICK_MS) {          // un campione ogni 50 ms di gara
        int w = scorer.tick(age <= 100, fabsf(g_sp - g_pos)); compTick++;
        if (w >= 0 && evWin < 0) evWin = w;
      }
      g_compPts = scorer.points(); g_compWin = (int)(scorer.ticks / bb::Scorer::TICKS_PER_WINDOW); if (g_compWin > 9) g_compWin = 9;
      g_compLeft = el >= COMP_RUN_MS ? 0 : COMP_RUN_MS - el;
      if (!compArmed) {                                  // finché il sensore non vede la palla resta l'inclinazione di lancio
        if (age <= 100) { compArmed = true; g_pid = true; } else { g_pid = false; compHold = true; }
      }
      if (g_compPts >= bb::Scorer::MAX_POINTS && el < COMP_RUN_MS) { compFinish(false, true); evEnd = true; }
      else if (el >= COMP_RUN_MS) { compFinish(false); evEnd = true; }
    }
    if (g_pid && age <= HOLD_MS) {
      float pos = g_pos;                                // se la palla è persa: ultima posizione nota
      float err = g_sp - pos;
      if (!prevPid || wasLost) { wasLost = false; integ = 0; prevPos = pos; prevSampleMs = sampleMs ? sampleMs : g_lastGood; dFilt = 0; hp[0] = pos; ht[0] = prevSampleMs; hn = 1; }
      if (newSample) {                              // PID aggiornato solo con campioni nuovi
        float dt = (sampleMs - prevSampleMs) / 1000.0f;
        if (dt < 0.004f) dt = CTRL_DT;
        integ = clampf(integ + err * dt, -50, 50);
        if (hn == D_SAMPLES + 1) {                  // finestra scorrevole di D_SAMPLES+1 posizioni
          memmove(hp, hp + 1, D_SAMPLES * sizeof(float)); memmove(ht, ht + 1, D_SAMPLES * sizeof(uint32_t)); hn = D_SAMPLES;
        }
        hp[hn] = pos; ht[hn] = sampleMs; hn++;
        float span = (ht[hn - 1] - ht[0]) / 1000.0f;
        float dRaw = span > 0.004f ? -(pos - hp[0]) / span : 0;   // derivata sulla misura (non sull'errore)
        dFilt += (dt / (D_TAU + dt)) * (dRaw - dFilt);            // poi passa-basso
        prevPos = pos;
        prevSampleMs = sampleMs;
      }
      if (age > 100) dFilt = 0;                         // niente campioni nuovi: la velocità non è più nota
      writeServo(g_kp * err + g_ki * integ + g_kd * dFilt);
    } else if (g_pid) {                                 // palla persa da più di HOLD_MS: trave orizzontale, riprende da sola
      writeServo(0);
      wasLost = true;
    }
    prevPid = g_pid;
    if (g_stopReq) { g_pid = false; writeServo(0); }
    if (tuneFail) writeServo(0);
    if (compHold && g_comp != 3) writeServo(g_compLaunch);
    if (tuneLaunchHold && g_tune) writeServo(g_tuneLaunch);
    xSemaphoreGive(servoMutex);
    if (evStart) sendEv("comp_start");
    if (evTuneStart) sendEv("tune_start");
    if (evWin >= 0) {
      JsonDocument w; w["e"] = "comp_win"; w["i"] = evWin;
      w["p"] = scorer.windowPoints(evWin); w["f"] = scorer.windowFill(evWin); sendDoc(w);
    }
    if (evEnd) sendCompEnd();

    vTaskDelayUntil(&last, pdMS_TO_TICKS(CTRL_MS));
  }
}

// ---------- Comandi seriali ----------
static char lineBuf[12288];
static size_t lineLen = 0;

static void handleLine(const char* line) {
  JsonDocument d;
  DeserializationError err = deserializeJson(d, line, DeserializationOption::NestingLimit(40));
  if (err) { sendErr("JSON non valido"); return; }
  const char* c = d["c"] | "";
  g_lastPing = millis();
  if (!strcmp(c, "hello")) {
    JsonDocument r; r["e"] = "hello"; r["v"] = 1; r["fw"] = FW_VERSION; r["ok"] = g_posOk ? 1 : 0;
    r["limit"] = cfgLimit;
#ifdef HAVE_WIFI
    r["wifi"] = WiFi.status() == WL_CONNECTED ? 1 : 0;
    if (WiFi.status() == WL_CONNECTED) { r["ip"] = WiFi.localIP().toString(); r["rssi"] = WiFi.RSSI(); }
#endif
    sendDoc(r);
  } else if (!strcmp(c, "ping")) {
    // heartbeat: g_lastPing già aggiornato
  } else if (!strcmp(c, "cfg")) {
    if (compActive()) { sendErr("competizione in corso"); return; }
    if (g_running || g_tune) { sendErr("ferma il programma prima"); return; }
    if (d["center"].is<float>()) cfgCenter = clampf(d["center"], 60, 120);
    if (d["limit"].is<float>())  cfgLimit  = clampf(d["limit"], 1, HARD_LIMIT);
    if (!d["inv"].isNull())      cfgInv    = d["inv"].as<int>() != 0;
    setManual(0);
    sendEv("ok");
  } else if (!strcmp(c, "prog")) {
    if (compActive()) { sendErr("competizione in corso"); return; }
    if (g_running) { sendErr("programma in esecuzione"); return; }   // g_running sale subito con "run"
    g_prog.clear();
    g_prog["p"] = d["p"];
    g_progLoaded = !g_prog["p"].isNull();
    if (g_progLoaded) sendEv("ok"); else sendErr("programma vuoto");
  } else if (!strcmp(c, "tune")) {
    // launch opzionale: inclinazione mantenuta 3 s, poi si attiva il PID.
    if (compActive() && !d["on"].isNull()) { sendErr("competizione in corso"); return; }
    if (g_running) { sendErr("ferma il programma prima"); return; }
    bool refuse = false;
    xSemaphoreTake(servoMutex, portMAX_DELAY);
    if (d["sp"].is<float>()) g_sp = clampf(d["sp"], 0, 100);
    if (d["kp"].is<float>()) g_kp = clampf(d["kp"], 0, 50);
    if (d["ki"].is<float>()) g_ki = clampf(d["ki"], 0, 20);
    if (d["kd"].is<float>()) g_kd = clampf(d["kd"], 0, 20);
    if (!d["on"].isNull()) {
      if (d["on"].as<int>() != 0) {
        if (!g_posOk) refuse = true;
        else {
          g_stopReq = false; g_tune = true;
          if (d["launch"].is<float>()) {
            g_tuneLaunch = clampf(d["launch"], -HARD_LIMIT, 0);
            tuneLaunchT0 = millis(); g_tuneLaunchLeft = COMP_COUNTDOWN_MS; g_tuneLaunchActive = true; g_pid = false;
            writeServo(g_tuneLaunch);
          } else {
            g_tuneLaunchActive = false; g_tuneLaunchLeft = 0; g_pid = true;
          }
        }
      } else { g_tune = false; g_pid = false; g_tuneLaunchActive = false; g_tuneLaunchLeft = 0; writeServo(0); }
    }
    xSemaphoreGive(servoMutex);
    if (refuse) sendErr("sensore non valido");
  } else if (!strcmp(c, "comp")) {
    // {"c":"comp","on":1,"sp":35,"kp":1.5,"ki":0,"kd":0.05,"launch":-6}: conto alla rovescia di 3 s (trave inclinata verso il sensore,
    // si mette la palla in fondo), poi 60 s di gara con PID regolabile via tune. {"c":"comp","on":0} annulla / chiude i risultati.
    if (!(d["on"] | 1)) {
      if (compActive()) { xSemaphoreTake(servoMutex, portMAX_DELAY); compFinish(true); xSemaphoreGive(servoMutex); sendCompEnd(); }
      g_comp = 0;
    } else {
      if (g_running) { sendErr("ferma il programma prima"); return; }
      if (compActive()) { sendErr("competizione in corso"); return; }
      xSemaphoreTake(servoMutex, portMAX_DELAY);
      if (d["sp"].is<float>()) g_sp = clampf(d["sp"], 0, 100);
      if (d["kp"].is<float>()) g_kp = clampf(d["kp"], 0, 50);
      if (d["ki"].is<float>()) g_ki = clampf(d["ki"], 0, 20);
      if (d["kd"].is<float>()) g_kd = clampf(d["kd"], 0, 20);
      g_compLaunch = d["launch"].is<float>() ? clampf(d["launch"], -HARD_LIMIT, 0) : COMP_LAUNCH_DEG;   // sempre verso il sensore
      g_tune = false; g_stopReq = false; g_pid = false;
      g_tuneLaunchActive = false; g_tuneLaunchLeft = 0;
      scorer.reset(); g_compPts = 0; g_compWin = 0; g_compAborted = false; g_compEarly = false; compTick = 0; compArmed = false;
      compT0 = millis(); g_compLeft = COMP_COUNTDOWN_MS; g_comp = 1;
      writeServo(g_compLaunch);
      xSemaphoreGive(servoMutex);
      sendEv("comp_countdown");
    }
  } else if (!strcmp(c, "run")) {
    if (compActive()) { sendErr("competizione in corso"); return; }
    if (g_running) { sendErr("già in esecuzione"); return; }
    if (!g_progLoaded) { sendErr("nessun programma"); return; }
    if (!g_posOk) { sendErr("sensore non valido"); return; }
    g_stopReq = false;
    g_tune = false;
    g_tuneLaunchActive = false; g_tuneLaunchLeft = 0;
    g_running = true;     // subito, così "prog" e "stop" successivi vedono lo stato corretto
    g_startReq = true;
  } else if (!strcmp(c, "stop")) {
    if (compActive()) { xSemaphoreTake(servoMutex, portMAX_DELAY); compFinish(true); xSemaphoreGive(servoMutex); sendCompEnd(); }
    g_stopReq = true;
    if (!g_running) { g_tune = false; g_tuneLaunchActive = false; g_tuneLaunchLeft = 0; stopAll(); g_stopReq = false; }
  } else if (!strcmp(c, "angle")) {
    if (!g_running && !g_tune && !compActive()) setManual(d["v"] | 0.0f);
  } else {
    sendErr("comando sconosciuto");
  }
}

#ifdef HAVE_WIFI
// ---------- Wi-Fi: pagina web (porta 80) + WebSocket (porta 81), stesso protocollo della seriale ----------
static WebServer http(80);
static WebSocketsServer wsServer(81);
static bool netStarted = false;
static uint32_t wifiLastTry = 0;
static char wsBuf[12288];

static void onWsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_CONNECTED) { wsClients = wsClients + 1; }
  else if (type == WStype_DISCONNECTED) { if (wsClients > 0) wsClients = wsClients - 1; }
  else if (type == WStype_TEXT) {
    if (length == 0) return;
    if (length >= sizeof(wsBuf)) { sendErr("riga troppo lunga"); return; }
    memcpy(wsBuf, payload, length); wsBuf[length] = 0;
    handleLine(wsBuf);
  }
}

static void wifiStart() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname("ballbeam");
  WiFi.setSleep(false);                              // niente risparmio energetico: latenza minima
#ifdef WIFI_IP                                      // senza WIFI_IP in secrets.h: indirizzo assegnato dalla rete (DHCP), es. hotspot del telefono
  WiFi.config(IPAddress(WIFI_IP), IPAddress(WIFI_GW), IPAddress(WIFI_MASK), IPAddress(WIFI_GW));
#endif
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

static void netLoop() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!netStarted) {
      netStarted = true;
      MDNS.begin("ballbeam");                        // http://ballbeam.local
      http.on("/", HTTP_GET, []() {
        http.sendHeader("Content-Encoding", "gzip");
        http.sendHeader("Cache-Control", "no-cache");
        http.send_P(200, "text/html", (const char*)page_gz_start, (size_t)(page_gz_end - page_gz_start));
      });
      http.on("/health", HTTP_GET, []() { http.send(200, "text/plain", "ok"); });
      http.onNotFound([]() { http.send(404, "text/plain", "non trovato"); });
      http.begin();
      wsServer.begin();
      wsServer.onEvent(onWsEvent);
      JsonDocument w; w["e"] = "wifi"; w["ip"] = WiFi.localIP().toString(); sendDoc(w);
    }
    http.handleClient();
    wsServer.loop();
    String l; int n = 0;
    while (n++ < 8 && wsPop(l)) wsServer.broadcastTXT(l);
  } else if (millis() - wifiLastTry > 15000) {        // rete persa: riprova
    wifiLastTry = millis();
    WiFi.reconnect();
  }
}
#endif

static void pollSerial() {
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\n') {
      lineBuf[lineLen] = 0;
      if (lineLen > 0) handleLine(lineBuf);
      lineLen = 0;
    } else if (ch != '\r') {
      if (lineLen < sizeof(lineBuf) - 1) lineBuf[lineLen++] = ch;
      else { lineLen = 0; sendErr("riga troppo lunga"); }
    }
  }
}

void setup() {
  Serial.setRxBufferSize(8192);   // i programmi arrivano in un'unica riga lunga
  Serial.begin(BAUD);
  txMutex = xSemaphoreCreateMutex();
  servoMutex = xSemaphoreCreateMutex();
  servo.setPeriodHertz(50);
  servo.attach(PIN_SERVO, 500, 2400);
  setManual(0);

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
  sensor.begin();
  sensor.VL53L4CD_SensorInit();
  sensor.VL53L4CD_SetRangeTiming(RANGE_MS, 0);   // misura continua
  sensor.VL53L4CD_StartRanging();

  g_lastGood = millis();
  xTaskCreatePinnedToCore(controlTask, "ctrl", 4096, nullptr, 3, nullptr, 1);
  xTaskCreatePinnedToCore(programTask, "prog", 8192, nullptr, 2, nullptr, 0);
#ifdef HAVE_WIFI
  wifiStart();
#endif
}

void loop() {
  pollSerial();
#ifdef HAVE_WIFI
  netLoop();
#endif
  static uint32_t lastTel = 0;
  if (millis() - lastTel >= 50) {
    lastTel = millis();
    JsonDocument t;
    t["t"] = millis();
    t["x"] = serialized(String(g_pos, 1));
    t["sp"] = g_sp;
    t["a"] = serialized(String(g_angle, 1));
    t["run"] = (g_running || g_tune || compActive()) ? 1 : 0;
    t["pid"] = g_pid ? 1 : 0;
    t["ok"] = g_posOk ? 1 : 0;
    if (g_running && g_cur >= 0) t["s"] = (int)g_cur;
    if (g_comp) { t["cs"] = (int)g_comp; t["ct"] = (uint32_t)g_compLeft; t["cp"] = serialized(String((float)g_compPts, 2)); t["cw"] = (int)g_compWin; }
    if (g_tuneLaunchActive) t["tl"] = (uint32_t)g_tuneLaunchLeft;
    sendDoc(t);
  }
  delay(2);
}
