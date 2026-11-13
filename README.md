# ClimaSense

Estação meteorológica IoT com ESP32 e BME280, com banco de dados em nuvem e dashboard web.
Projeto de TCC do curso Técnico em Desenvolvimento de Sistemas (também entregue na matéria de IoT).

```
ESP32 + BME280 → Wi-Fi → Firebase Realtime Database → dashboard web (+ Open-Meteo)
```

## O que o sistema faz

- Mede temperatura, umidade e pressão e grava cada leitura no Firebase com data e hora (NTP).
- Dashboard com leituras atuais, histórico com gráficos (zoom, exportação CSV) e estado da estação.
- Estima a chance de chuva nas próximas 3 horas pela tendência da pressão, umidade e ponto de orvalho,
  e compara com a previsão da API Open-Meteo.
- Recomenda atividades (educação física, eventos, irrigação, pulverização, colheita) com regras
  editáveis por contas de especialista. Envia avisos por Telegram ou WhatsApp.

## Estrutura

| Pasta/arquivo | Conteúdo |
|---|---|
| `sketch.ino` | Firmware do ESP32 (versão para simulação no Wokwi; `SIMULAR_BME280 = 0` usa o sensor real) |
| `dashboard/` | Site estático (HTML, CSS e JS puro + Chart.js), sem etapa de build |

## Como rodar o dashboard

Abra `dashboard/index.html` por um servidor estático, por exemplo:

```
cd dashboard
python3 -m http.server 8000
```

A URL do banco e as demais opções ficam em `CONFIG`, no início de `dashboard/script.js`.
Se `firebaseUrl` contiver `SEU-PROJETO`, o dashboard roda em modo demonstração com dados simulados.

## Observações

- Configure as regras de segurança do Realtime Database; não deixe o banco aberto para escrita.
- O token do bot do Telegram fica só no navegador de quem o configura. Use um bot de demonstração.
- Os limites das regras de atividades são exemplos e devem ser validados por professores e técnicos da área.
