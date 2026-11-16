/*
  ClimaSense: estação meteorológica IoT (ESP32 + BME280)
  Duas estações no mesmo código: simulada (Wokwi) e real (ESP32 com BME280 ou BMP280).

  Fluxo: ESP32 -> Firebase Realtime Database (HTTPS, JSON) -> dashboard web

  Como usar:
  1) Troque FIREBASE_URL pela URL do seu Realtime Database.
  2) Rode a simulação. Os dados do BME280 são simulados (SIMULAR_BME280 = 1).
  3) Para mudar os valores durante a simulação, digite no monitor serial (e Enter):
       t            liga/desliga o modo tempestade (a pressão cai, a umidade sobe)
       temp 33.5    fixa a temperatura em 33,5 °C (use ponto, não vírgula)
       umid 85      fixa a umidade em 85 %
       pres 1003    fixa a pressão ao nível do mar em 1003 hPa
       auto         volta aos valores automáticos
     O botão no GPIO 4 (ligado ao GND) também liga/desliga o modo tempestade.
  4) Com o sensor real, mude SIMULAR_BME280 para 0 (ligação: SDA no GPIO 21,
     SCL no GPIO 22, VCC no 3V3). A estação real usa o id "est02" e envia a cada 60 s.
       - Módulo BME280 (mede umidade): SENSOR_BMP280 = 0; biblioteca Adafruit BME280.
       - Módulo BMP280 (NÃO mede umidade): SENSOR_BMP280 = 1; biblioteca Adafruit BMP280.
         Temperatura e pressão são reais; a umidade é SIMULADA (digite "umid 85" no monitor
         serial para fixá-la e "auto" para voltar ao automático).
     Instale também a Adafruit Unified Sensor.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include <math.h>

#define SIMULAR_BME280 1   // 1 = tudo simulado (Wokwi), 0 = sensor real
#define SENSOR_BMP280  1   // só vale com SIMULAR_BME280 = 0: 1 = módulo BMP280 (umidade simulada), 0 = BME280 (tudo real)
#define UMIDADE_SIMULADA (SIMULAR_BME280 || SENSOR_BMP280)

#if !SIMULAR_BME280
  #include <Wire.h>
  #include <Adafruit_Sensor.h>
  #if SENSOR_BMP280
    #include <Adafruit_BMP280.h>
    Adafruit_BMP280 bmp;
  #else
    #include <Adafruit_BME280.h>
    Adafruit_BME280 bme;
  #endif
#endif

// ---------------- Configuração ----------------
// Duas estações com o mesmo código, escolhidas por SIMULAR_BME280:
//   1 = simulada (Wokwi):  id "est01", envio a cada 10 s, rede Wokwi-GUEST
//   0 = real (circuito):   id "est02", envio a cada 60 s, Wi-Fi 2,4 GHz da sala ou do celular
// O id precisa ser o mesmo de CONFIG.estacoes no dashboard/script.js.
#if SIMULAR_BME280
  const char* ESTACAO_ID = "est01";
  const char* WIFI_SSID  = "Wokwi-GUEST";
  const char* WIFI_SENHA = "";
  const int   WIFI_CANAL = 6;
  const unsigned long INTERVALO_MS = 10000;   // simulação: 10 s
#else
  // Senha do Wi-Fi fora do Git: crie segredos.h (já listado no .gitignore) com
  //   #define WIFI_SSID_REAL  "nome-da-rede"
  //   #define WIFI_SENHA_REAL "senha"
  #if __has_include("segredos.h")
    #include "segredos.h"
  #endif
  #ifndef WIFI_SSID_REAL
    #define WIFI_SSID_REAL  "SEU_WIFI"
    #define WIFI_SENHA_REAL "SUA_SENHA"
  #endif
  const char* ESTACAO_ID = "est02";
  const char* WIFI_SSID  = WIFI_SSID_REAL;
  const char* WIFI_SENHA = WIFI_SENHA_REAL;
  const int   WIFI_CANAL = 0;                 // 0 = qualquer canal
  const unsigned long INTERVALO_MS = 60000;   // prova de conceito: 60 s (operação: 300000)
#endif

const char* FIREBASE_URL = "https://estacao-metereologica-50584-default-rtdb.firebaseio.com/";

const float ALTITUDE_M = 211;            // altitude do local; o dashboard recalcula a pressão ao nível do mar a partir de "pe" com a altitude da conta
const unsigned long INTERVALO_MIN_ENVIO_MS = 3000; // trava anti-flood: nunca envia mais de 1 leitura a cada 3 s
const int   TENTATIVAS_ENVIO = 3;          // tentativas por requisição quando a rede falha (retorno negativo)
const unsigned long ESPERA_RETENTATIVA_MS = 1500;  // espera base entre tentativas (cresce a cada falha)
const unsigned long TIMEOUT_HTTP_MS = 8000;
const long FUSO_SEGUNDOS = -3 * 3600;      // Brasília (UTC-3)

const int PIN_BOTAO = 4;                   // botão entre GPIO 4 e GND (opcional)
const int PIN_LED   = 2;                   // acende no modo tempestade

unsigned long ultimoEnvio = 0;
bool jaEnviou = false;
bool primeiroEnvio = true;       // "envio pendente": pede uma leitura extra (boot ou comando manual)
unsigned long ultimoBotao = 0;
String bufferSerial = "";        // acumula os caracteres digitados sem bloquear o loop()

// ---------------- Hora ----------------
bool horaValida() {
  return time(nullptr) > 1700000000;
}

float horaLocal() {
  time_t agora = time(nullptr);
  struct tm info;
  localtime_r(&agora, &info);
  return info.tm_hour + info.tm_min / 60.0 + info.tm_sec / 3600.0;
}

void sincronizarHora() {
  configTime(FUSO_SEGUNDOS, 0, "pool.ntp.org", "time.nist.gov");
  unsigned long inicio = millis();
  while (!horaValida() && millis() - inicio < 15000) {
    delay(300);
  }
  Serial.println(horaValida() ? "Hora sincronizada (NTP)." : "Falha ao sincronizar a hora.");
}

// ---------------- Sensor simulado ----------------
#if SIMULAR_BME280
// Imita a interface da biblioteca Adafruit_BME280 (temperatura em °C,
// umidade em %, pressão em Pa). Gera um dia típico com ciclo diário e,
// no modo tempestade, uma queda de pressão com mais umidade e menos calor.
class SimBME280 {
 public:
  bool begin() {
    randomSeed(esp_random());
    return true;
  }

  void alternarTempestade() { tempestade = !tempestade; }
  void fixarTemperatura(float v) { fixT = true; vT = v; }
  void fixarUmidade(float v)     { fixU = true; vU = v; }
  void fixarPressao(float v)     { fixP = true; vP = v; }  // ao nível do mar, em hPa
  void voltarAoAutomatico()      { fixT = fixU = fixP = false; }
  bool emTempestade() const { return tempestade; }

  void atualizar(float hora) {
    if (tempestade && progresso < 1.0) progresso += 0.015;
    if (!tempestade && progresso > 0.0) progresso -= 0.008;
    progresso = constrain(progresso, 0.0, 1.0);

    float pNivelMar = 1012.2 + 0.85 * cos(2 * PI * (hora - 10) / 12.0)
                      - 8.0 * progresso + ruido(0.06);
    if (fixP) pNivelMar = vP + ruido(0.05);
    temp = 25.8 + 3.4 * sin(2 * PI * (hora - 9) / 24.0)
           - 4.0 * progresso + ruido(0.08);
    if (fixT) temp = vT + ruido(0.05);
    umid = 82.0 - 13.0 * sin(2 * PI * (hora - 9) / 24.0)
           + 14.0 * progresso + ruido(0.4);
    if (fixU) umid = vU + ruido(0.3);
    umid = constrain(umid, 30.0, 99.0);
    // o sensor mede a pressão na altitude do local (menor que a do nível do mar)
    pres = pNivelMar * pow(1.0 - ALTITUDE_M / 44330.0, 5.255) * 100.0;
  }

  float readTemperature() { return temp; }
  float readHumidity()    { return umid; }
  float readPressure()    { return pres; }

 private:
  bool tempestade = false;
  float progresso = 0.0;
  bool fixT = false, fixU = false, fixP = false;
  float vT = 0, vU = 0, vP = 0;
  float temp = 26.0, umid = 70.0, pres = 98500.0;

  float ruido(float amplitude) {
    return (random(-1000, 1001) / 1000.0) * amplitude;
  }
};

SimBME280 sensor;
#endif

// ---------------- Umidade simulada (módulo BMP280 real) ----------------
#if !SIMULAR_BME280 && SENSOR_BMP280
class UmidadeSimulada {
 public:
  void fixar(float v) { fixa = true; valor = v; }
  void automatico()   { fixa = false; }
  float ler(float hora) {
    float u = fixa ? valor + ruido(0.3) : 75.0 - 10.0 * sin(2 * PI * (hora - 9) / 24.0) + ruido(0.4);
    return constrain(u, 0.0, 100.0);
  }
 private:
  bool fixa = false;
  float valor = 70.0;
  float ruido(float amplitude) { return (random(-1000, 1001) / 1000.0) * amplitude; }
};
UmidadeSimulada umidadeSim;
#endif

// ---------------- Leitura ----------------
bool iniciarSensor() {
#if SIMULAR_BME280
  return sensor.begin();
#elif SENSOR_BMP280
  Wire.begin(21, 22);
  uint8_t enderecos[] = {0x76, 0x77};
  uint8_t ids[] = {0x58, 0x56, 0x57};     // IDs do BMP280 (produção e amostras)
  for (uint8_t a : enderecos) for (uint8_t id : ids) if (bmp.begin(a, id)) {
    Serial.printf("BMP280 encontrado (0x%02X). Temperatura e pressão são reais; a umidade é SIMULADA.\n", a);
    return true;
  }
  if (bmp.sensorID() == 0x60) {
    Serial.println("ERRO: o módulo é um BME280 (mede umidade). Mude SENSOR_BMP280 para 0 no sketch.");
  } else {
    Serial.println("ERRO: BMP280 não encontrado (0x76 e 0x77). Confira SDA no GPIO 21, SCL no GPIO 22 e o VCC. Nenhuma leitura será enviada.");
  }
  return false;
#else
  Wire.begin(21, 22);
  if (!bme.begin(0x76) && !bme.begin(0x77)) {
    Serial.println("ERRO: BME280 não encontrado (0x76 e 0x77). Confira SDA no GPIO 21, SCL no GPIO 22 e o VCC. Nenhuma leitura será enviada.");
    return false;
  }
  if (bme.sensorID() != 0x60) {   // 0x60 = BME280; 0x56 a 0x58 = BMP280 (não mede umidade)
    Serial.printf("ERRO: o módulo não é um BME280 (ID 0x%02X). Provavelmente é um BMP280, que não mede umidade.\n", bme.sensorID());
    return false;
  }
  return true;
#endif
}

void lerSensor(float &t, float &u, float &pEstacaoHpa) {
#if SIMULAR_BME280
  sensor.atualizar(horaLocal());
  t = sensor.readTemperature();
  u = sensor.readHumidity();
  pEstacaoHpa = sensor.readPressure() / 100.0;
#else
  #if SENSOR_BMP280
    t = bmp.readTemperature();
    u = umidadeSim.ler(horaLocal());
    pEstacaoHpa = bmp.readPressure() / 100.0;
  #else
    t = bme.readTemperature();
    u = bme.readHumidity();
    pEstacaoHpa = bme.readPressure() / 100.0;
  #endif
#endif
}

float pressaoNivelDoMar(float pEstacaoHpa) {
  return pEstacaoHpa / pow(1.0 - ALTITUDE_M / 44330.0, 5.255);
}

// ---------------- Wi-Fi ----------------
void conectarWifi() {
  Serial.print("Conectando ao Wi-Fi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_SENHA, WIFI_CANAL);
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 15000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Conectado. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Sem Wi-Fi. Tentando de novo no próximo ciclo.");
  }
}

// ---------------- Firebase ----------------
bool enviarFirebase(const String &caminho, const char *json) {
  String url = String(FIREBASE_URL) + caminho + ".json";
  for (int tentativa = 1; tentativa <= TENTATIVAS_ENVIO; tentativa++) {
    int codigo;
    {
      WiFiClientSecure cliente;      // criado e destruído a cada tentativa (libera a conexão TLS)
      cliente.setInsecure();         // simulação: não valida o certificado
      cliente.setTimeout(TIMEOUT_HTTP_MS / 1000);
      HTTPClient http;
      http.setConnectTimeout(TIMEOUT_HTTP_MS);
      http.setTimeout(TIMEOUT_HTTP_MS);
      http.setReuse(false);
      if (!http.begin(cliente, url)) {
        Serial.println("Não foi possível iniciar a conexão HTTP.");
        return false;
      }
      http.addHeader("Content-Type", "application/json");
      codigo = http.PUT(json);
      http.end();
    }
    Serial.printf("PUT %s -> %d (tentativa %d/%d)\n", caminho.c_str(), codigo, tentativa, TENTATIVAS_ENVIO);
    if (codigo >= 200 && codigo < 300) return true;
    if (codigo > 0) return false;    // resposta HTTP de erro (401, 404...): repetir não resolve
    // codigo <= 0 (-1, -5...): falha de rede. Espera um pouco mais a cada tentativa e tenta de novo.
    if (tentativa < TENTATIVAS_ENVIO) {
      if (WiFi.status() != WL_CONNECTED) return false;   // sem Wi-Fi: o próximo ciclo reconecta
      delay(ESPERA_RETENTATIVA_MS * tentativa);
    }
  }
  return false;
}

void enviarLeitura() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi caiu, reconectando...");
    conectarWifi();
    if (WiFi.status() != WL_CONNECTED) return;
  }
  if (!horaValida()) sincronizarHora();
  if (!horaValida()) return;

  float t, u, pe;
  lerSensor(t, u, pe);
  if (isnan(t) || isnan(u) || isnan(pe)) {
    Serial.println("Leitura inválida do sensor.");
    return;
  }
  float p = pressaoNivelDoMar(pe);
  unsigned long ts = (unsigned long)time(nullptr);

  char json[200];
  snprintf(json, sizeof(json),
           "{\"ts\":%lu,\"t\":%.2f,\"u\":%.1f,\"pe\":%.2f,\"p\":%.2f}",
           ts, t, u, pe, p);
  Serial.printf("T=%.1f C  U=%.0f %%  P=%.1f hPa (nivel do mar)\n", t, u, p);

  String base = String("/estacoes/") + ESTACAO_ID;
  if (enviarFirebase(base + "/leituras/" + String(ts), json)) {
    char status[170];
    snprintf(status, sizeof(status),
             "{\"ultima_leitura\":%lu,\"simulado\":%s,\"umidSimulada\":%s,\"rssi\":%d}",
             ts, SIMULAR_BME280 ? "true" : "false", UMIDADE_SIMULADA ? "true" : "false", WiFi.RSSI());
    enviarFirebase(base + "/status", status);
  }
}

// ---------------- Modo tempestade (só na simulação) ----------------
void alternarTempestade() {
#if SIMULAR_BME280
  sensor.alternarTempestade();
  digitalWrite(PIN_LED, sensor.emTempestade() ? HIGH : LOW);
  Serial.println(sensor.emTempestade() ? ">> Modo tempestade LIGADO (a pressão vai cair)"
                                       : ">> Modo tempestade DESLIGADO (volta ao normal)");
#endif
}

void interpretarComando(String c) {
  c.trim();
  c.toLowerCase();
  if (c.length() == 0) return;
#if SIMULAR_BME280
  if (c == "t") { alternarTempestade(); return; }
#endif
#if UMIDADE_SIMULADA
  if (c == "auto") {
  #if SIMULAR_BME280
    sensor.voltarAoAutomatico();
  #else
    umidadeSim.automatico();
  #endif
    Serial.println(">> Valores automaticos");
    primeiroEnvio = true;   // envia já uma leitura nova
    return;
  }
  int espaco = c.indexOf(' ');
  if (espaco > 0) {
    String nome = c.substring(0, espaco);
    float valor = c.substring(espaco + 1).toFloat();
  #if SIMULAR_BME280
    if (nome == "temp") sensor.fixarTemperatura(valor);
    else if (nome == "umid") sensor.fixarUmidade(valor);
    else if (nome == "pres") sensor.fixarPressao(valor);
    else { Serial.println("Comando desconhecido."); return; }
  #else
    if (nome == "umid") umidadeSim.fixar(valor);
    else { Serial.println("Com o sensor real, só a umidade pode ser fixada: umid 85"); return; }
  #endif
    Serial.printf(">> %s fixada em %.1f\n", nome.c_str(), valor);
    primeiroEnvio = true;   // envia já uma leitura nova
    return;
  }
#endif
#if SIMULAR_BME280
  Serial.println("Comandos: t, auto, temp 30, umid 90, pres 1005");
#elif SENSOR_BMP280
  Serial.println("Comandos: umid 85, auto");
#else
  Serial.println("Sensor BME280 real: não há comandos.");
#endif
}

// Lê a serial sem bloquear: acumula caracteres e só interpreta quando chega Enter (\n ou \r).
// (Serial.readStringUntil travava o loop até 1 s por comando e reprocessava linhas parciais.)
void lerSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (bufferSerial.length() > 0) {
        String comando = bufferSerial;
        bufferSerial = "";
        interpretarComando(comando);
      }
    } else if (bufferSerial.length() < 40) {
      bufferSerial += c;
    }
  }
}

void verificarEntradas() {
  if (digitalRead(PIN_BOTAO) == LOW && millis() - ultimoBotao > 400) {
    ultimoBotao = millis();
    alternarTempestade();
  }
  lerSerial();
}

// ---------------- Arduino ----------------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BOTAO, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  Serial.println("\n=== ClimaSense: estação meteorológica IoT ===");
  if (String(FIREBASE_URL).indexOf("SEU-PROJETO") >= 0) {
    Serial.println("ATENÇÃO: troque FIREBASE_URL pela URL do seu Realtime Database.");
  }
  if (!iniciarSensor()) {
    while (true) delay(1000);
  }
  conectarWifi();
  sincronizarHora();
}

void loop() {
  verificarEntradas();
  unsigned long agora = millis();
  bool vencido = !jaEnviou || agora - ultimoEnvio >= INTERVALO_MS;                 // envio periódico (RNF01)
  bool pedido  = primeiroEnvio && (!jaEnviou || agora - ultimoEnvio >= INTERVALO_MIN_ENVIO_MS);  // envio extra, com trava
  if (vencido || pedido) {
    primeiroEnvio = false;
    ultimoEnvio = millis();          // marcado ANTES de enviar: as retentativas não contam como novo ciclo
    jaEnviou = true;
    enviarLeitura();
    ultimoEnvio = millis();          // e de novo depois: o intervalo conta a partir do fim do envio
  }
  delay(20);
}
