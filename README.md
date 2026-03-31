# 🌍 Processador de Estatísticas Sísmicas

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)
![Data Sources](https://img.shields.io/badge/Data-USGS%20%26%20EMSC-blue.svg)

Este projeto coleta e processa dados de **terremotos** em tempo real a partir de múltiplas fontes oficiais (USGS e EMSC), normaliza os resultados e gera estatísticas diárias e semanais para análise e visualização.

---

## ✨ Funcionalidades
- Integração com **USGS** (EUA) e **EMSC** (Europa).
- Normalização dos dados sísmicos (latitude, longitude, magnitude, profundidade).
- Estatísticas diárias:
  - Total de sismos nas últimas 24h.
  - Distribuição por faixas de magnitude.
  - Pontos para gráficos de dispersão e mapas.
- Estatísticas semanais:
  - Total de sismos nos últimos 7 dias.
  - Distribuição por magnitude (M3, M4, M5, etc.).
  - Dados para gráficos de barras e mapas.
- Exporta resultados em `stats_cache.json`.

---

## ⚙️ Como usar
1. Clone este repositório:
   ```bash
   git clone https://github.com/streamnewyt/stats.git
Instale as dependências:

bash
npm install node-fetch
Execute o script:

bash
node processar_stats.js
Os resultados serão salvos em:

Código
stats_cache.json

📂 Estrutura
Código
processar_stats.js   # Script principal
stats_cache.json     # Saída com estatísticas diárias e semanais

📜 Licença
Este projeto está licenciado sob a MIT License – você pode usar, modificar e distribuir livremente, desde que mantenha os créditos.


⚠️ Aviso
Os dados são obtidos de fontes abertas (USGS e EMSC).

Não há garantias de disponibilidade ou precisão absoluta.

Este projeto é apenas para fins de pesquisa e consulta.


🙌 Contribuições
Sinta-se à vontade para abrir issues e enviar pull requests. Toda ajuda é bem-vinda!
