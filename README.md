ClimaSense

Estação meteorológica IoT com ESP32 e BME280, com banco de dados em nuvem e dashboard web. Projeto de TCC do curso Técnico em Desenvolvimento de Sistemas (também entregue na matéria de IoT).

ESP32 + BME280 → Wi-Fi → Firebase Realtime Database → dashboard web (+ Open-Meteo)
O que o sistema faz
Mede temperatura, umidade e pressão e grava cada leitura no Firebase com data e hora (NTP).
Dashboard com leituras atuais, histórico com gráficos (zoom, exportação CSV) e estado da estação.
A aba Histórico traz a tabela de validação Sensor × Open-Meteo: compara a última leitura da estação com a observação atual da API (temperatura até 1,5 °C, umidade até 6 pontos e pressão ao nível do mar até 3 hPa) e marca cada indicador como dentro ou fora da margem. As margens ficam em CONFIG.margens, no script.js.
Estima a chance de chuva nas próximas 3 horas pela tendência da pressão, umidade e ponto de orvalho, e compara com a previsão da API Open-Meteo.
Recomenda atividades (educação física, eventos, irrigação, pulverização, colheita) com regras que cada conta pode editar e criar (atividades novas valem só para a própria conta). Envia avisos por Telegram ou WhatsApp.
Estrutura
Pasta/arquivo	Conteúdo
sketch.ino	Firmware do ESP32 (versão para simulação no Wokwi; SIMULAR_BME280 = 0 usa o sensor real)
dashboard/	Site estático (HTML, CSS e JS puro + Chart.js), sem etapa de build
Como rodar o dashboard

Abra dashboard/index.html por um servidor estático, por exemplo:

cd dashboard
python3 -m http.server 8000

As opções (estações, coordenadas, margens) ficam em CONFIG, no início de dashboard/script.js. O navegador não fala com o Firebase: ele chama as funções da pasta dashboard/api (Vercel), que guardam a URL do banco e as chaves em variáveis de ambiente. Para testar sem o Vercel, abra a página com ?demo=1 (dados simulados).

## Agenda de atividades

A aba Agenda (dashboard/agenda.js) importa uma planilha .xlsx, .xls ou .csv (Data, Atividade, Responsável) ou aceita dados colados, cruza cada data com a previsão de 7 dias da Open-Meteo, marca o risco de chuva, salva a agenda na conta (Firebase) e avisa no Telegram. Os limites de risco ficam em RISCO, no início do agenda.js.

## Publicar no Vercel (sem expor chaves)

1. No Vercel, em Settings > General, deixe o Root Directory como dashboard (a pasta api precisa ficar dentro dela).
2. Em Settings > Environment Variables, crie: FIREBASE_DB_URL (URL do Realtime Database), FIREBASE_API_KEY (Web API Key) e FIREBASE_SERVICE_ACCOUNT (todo o JSON da conta de serviço, gerado em Firebase > Configurações do projeto > Contas de serviço). Nunca coloque esse JSON no Git.
3. Faça o push e confira o site (leituras, login).
4. Só depois, no console do Firebase, cole o conteúdo de firebase-rules.json em Realtime Database > Regras e publique. Isso fecha a leitura pública do banco.
5. No Google Cloud Console (APIs e serviços > Credenciais), restrinja a Web API Key ao seu domínio do Vercel e, se ela já esteve no GitHub, gere uma nova.

Estações e local

O dashboard acompanha uma estação por vez, escolhida no seletor da barra lateral ou ao criar a conta:

Id	Estação	Firmware	Envio
est01	Simulada (Wokwi), aceita comandos	SIMULAR_BME280 = 1	a cada 10 s
est02	Real (ESP32 + BME280 na sala)	SIMULAR_BME280 = 0	a cada 60 s

Cada estação grava em /estacoes/{id}/leituras, então o histórico de uma não se mistura com o da outra. Para acrescentar uma estação, grave o firmware com outro ESTACAO_ID e inclua o id em CONFIG.estacoes no script.js.

No cadastro, o CEP (opcional) é consultado na BrasilAPI (com ViaCEP de reserva) e na Open-Meteo, que devolve coordenadas e altitude. Esses dados ajustam a previsão e a pressão ao nível do mar, recalculada no dashboard a partir da pressão medida (pe). Só nome do local, coordenadas e altitude ficam na conta; o CEP e o endereço não são guardados. Use o CEP do local onde a estação está: a altitude errada desloca a pressão (cerca de 1 hPa a cada 8 m).

Comandos da estação simulada (monitor serial do Wokwi, com Enter): t (modo tempestade), temp 33.5, umid 85, pres 1003 (hPa ao nível do mar) e auto (volta ao automático).

Na estação real (BME280) temperatura, umidade e pressão são lidas do sensor e não há comandos no monitor serial. Biblioteca necessária: Adafruit BME280 (com a Adafruit Unified Sensor). Se o monitor mostrar "o módulo não é um BME280", o chip é um BMP280, que não mede umidade.

Wi-Fi da estação real: crie segredos.h ao lado do sketch.ino com WIFI_SSID_REAL e WIFI_SENHA_REAL (o arquivo está no .gitignore).

Observações
Configure as regras de segurança do Realtime Database; não deixe o banco aberto para escrita.
O token do bot do Telegram fica só no navegador de quem o configura. Use um bot de demonstração.
Os limites das regras de atividades são exemplos e devem ser validados por professores e técnicos da área.