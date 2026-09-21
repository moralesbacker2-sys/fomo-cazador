require('dotenv').config();
const http = require('http');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS || 60000);
const PORT = process.env.PORT || 3000;

// ==========================================
// ESTADO GLOBAL (Para el Panel Web)
// ==========================================
const state = {
  lastScanTime: null,
  totalScanned: 0,
  passedTokens: [],
  recentTokens: [] // Guarda las últimas 50 monedas vistas
};

const alertedTokens = new Map();

// ==========================================
// TELEGRAM
// ==========================================
async function sendTelegramMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
  } catch (e) {
    console.error("[Telegram] Error:", e.message);
  }
}

// ==========================================
// ESCANEO (DexScreener)
// ==========================================
async function scanFomo() {
  console.log(`[Scan] Buscando memecoins en BNB Chain... ${new Date().toISOString()}`);
  state.lastScanTime = new Date().toISOString();
  
  try {
    const response = await fetch('https://api.dexscreener.com/latest/dex/search?q=WBNB');
    const data = await response.json();

    if (!data || !data.pairs) return;
    state.totalScanned = data.pairs.length;

    for (const pair of data.pairs) {
      // 1. FILTRO DE RED
      if (pair.chainId !== 'bsc') continue;
      if (!pair.dexId.includes('pancakeswap')) continue;

      const symbol = pair.baseToken.symbol;
      const price = parseFloat(pair.priceUsd) || 0;
      const liquidity = pair.liquidity ? pair.liquidity.usd : 0;
      const fdv = pair.fdv || 0;
      const createdAt = pair.pairCreatedAt || Date.now();
      const ageMinutes = (Date.now() - createdAt) / 60000;
      const vol24h = pair.volume ? pair.volume.h24 : 0;

      const tokenData = {
        symbol, price, fdv, liquidity, vol24h, ageMinutes,
        address: pair.pairAddress,
        tokenAddress: pair.baseToken.address
      };

      // Guardar en la lista de recientes para el panel (máximo 50)
      state.recentTokens.unshift(tokenData);
      if (state.recentTokens.length > 50) state.recentTokens.pop();

      // 2. TUS FILTROS DE FOMO
      const cumpleFiltros = 
        fdv >= 5000 && fdv <= 150000 &&
        liquidity >= 3000 &&
        ageMinutes >= 15 &&
        vol24h >= 10000;

      if (!cumpleFiltros) continue;

      // Guardar en la lista de aprobados
      state.passedTokens.unshift(tokenData);
      if (state.passedTokens.length > 20) state.passedTokens.pop();

      // 3. CONTROL DE ANTIDUPLICADO
      const lastAlert = alertedTokens.get(symbol) || 0;
      if (Date.now() - lastAlert < 30 * 60 * 1000) continue;
      alertedTokens.set(symbol, Date.now());

      // 4. ENVIAR ALERTA
      const mensaje = `
🚀 <b>¡NUEVA OPORTUNIDAD EN FOMO!</b> 🚀

🪙 <b>Token:</b> ${symbol}
💵 <b>Precio:</b> $${price}
📊 <b>Market Cap (FDV):</b> $${(fdv / 1000).toFixed(2)}K
💧 <b>Liquidez:</b> $${(liquidity / 1000).toFixed(2)}K
📈 <b>Volumen 24h:</b> $${(vol24h / 1000).toFixed(2)}K
⏱ <b>Antigüedad:</b> ${ageMinutes.toFixed(0)} minutos

🔗 <a href="https://dexscreener.com/bsc/${pair.pairAddress}">Ver en DexScreener</a>
🔗 <a href="https://fomo.biz/token/${pair.baseToken.address}">Comprar en Fomo</a>

⚠️ <i>Recuerda: Stop Loss en -20%. Vende 50% en 2x.</i>
      `;

      console.log(`[Alerta] Enviando ${symbol} a Telegram...`);
      await sendTelegramMessage(mensaje);
    }
  } catch (error) {
    console.error("[Scan] Error:", error.message);
  }
}

// ==========================================
// PANEL WEB (Servidor HTTP)
// ==========================================
const HTML_PANEL = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fomo Cazador — Panel en vivo</title>
<style>
  body { background: #0a0e17; color: #e6e8ec; font-family: sans-serif; margin: 0; padding: 20px; font-size: 14px; }
  h1 { color: #fff; font-size: 20px; display: flex; align-items: center; gap: 10px; }
  .dot { width: 10px; height: 10px; background: #10b981; border-radius: 50%; box-shadow: 0 0 10px #10b981; animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .stats { display: flex; gap: 20px; margin-bottom: 20px; background: #111827; padding: 15px; border-radius: 8px; border: 1px solid #1e2a44; }
  .stat-box { flex: 1; }
  .stat-label { color: #7d8ca8; font-size: 11px; text-transform: uppercase; }
  .stat-value { font-size: 18px; font-weight: bold; color: #fff; margin-top: 5px; }
  table { width: 100%; border-collapse: collapse; background: #111827; border-radius: 8px; overflow: hidden; border: 1px solid #1e2a44; }
  th, td { text-align: left; padding: 12px; border-bottom: 1px solid #1e2a44; }
  th { background: #1a2235; color: #7d8ca8; font-size: 11px; text-transform: uppercase; }
  tr:hover { background: rgba(56,189,248,0.05); }
  .up { color: #10b981; }
  .down { color: #ef4444; }
  .badge { padding: 3px 8px; border-radius: 4px; font-size: 11px; background: rgba(56,189,248,0.15); color: #38bdf8; }
  .badge.hot { background: rgba(239,68,68,0.15); color: #ef4444; }
  a { color: #38bdf8; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <h1><span class="dot"></span> FOMO CAZADOR — Panel en vivo</h1>
  
  <div class="stats">
    <div class="stat-box"><div class="stat-label">Último escaneo</div><div class="stat-value" id="lastScan">—</div></div>
    <div class="stat-box"><div class="stat-label">Pares analizados</div><div class="stat-value" id="totalScanned">—</div></div>
    <div class="stat-box"><div class="stat-label">Oportunidades (Filtros OK)</div><div class="stat-value up" id="passedCount">—</div></div>
  </div>

  <h2 style="color:#fff; font-size:16px;">🎯 Oportunidades que cumplen tus filtros</h2>
  <table>
    <thead>
      <tr><th>Token</th><th>Precio</th><th>Cap. Mercado</th><th>Liquidez</th><th>Vol 24h</th><th>Antigüedad</th><th>Acciones</th></tr>
    </thead>
    <tbody id="passedRows"><tr><td colspan="7" style="text-align:center; color:#7d8ca8;">Esperando datos...</td></tr></tbody>
  </table>

  <h2 style="color:#fff; font-size:16px; margin-top:30px;">👀 Últimas monedas vistas (sin filtrar)</h2>
  <table>
    <thead>
      <tr><th>Token</th><th>Precio</th><th>Cap. Mercado</th><th>Liquidez</th><th>Vol 24h</th><th>Antigüedad</th><th>Acciones</th></tr>
    </thead>
    <tbody id="recentRows"><tr><td colspan="7" style="text-align:center; color:#7d8ca8;">Esperando datos...</td></tr></tbody>
  </table>

  <script>
    function fmtUsd(v) { return '$' + (v >= 1000 ? (v/1000).toFixed(2) + 'K' : v.toFixed(2)); }
    function renderRows(tokens) {
      if (tokens.length === 0) return '<tr><td colspan="7" style="text-align:center; color:#7d8ca8;">Sin resultados aún...</td></tr>';
      return tokens.map(t => \`
        <tr>
          <td><b>\${t.symbol}</b></td>
          <td>$\${t.price}</td>
          <td>\${fmtUsd(t.fdv)}</td>
          <td>\${fmtUsd(t.liquidity)}</td>
          <td>\${fmtUsd(t.vol24h)}</td>
          <td>\${t.ageMinutes.toFixed(0)}m</td>
          <td>
            <a href="https://dexscreener.com/bsc/\${t.address}" target="_blank">Dex</a> | 
            <a href="https://fomo.biz/token/\${t.tokenAddress}" target="_blank">Fomo</a>
          </td>
        </tr>
      \`).join('');
    }

    async function refresh() {
      try {
        const res = await fetch('/api/status');
        const d = await res.json();
        document.getElementById('lastScan').textContent = d.lastScanTime ? new Date(d.lastScanTime).toLocaleTimeString() : '—';
        document.getElementById('totalScanned').textContent = d.totalScanned || 0;
        document.getElementById('passedCount').textContent = d.passedTokens ? d.passedTokens.length : 0;
        
        document.getElementById('passedRows').innerHTML = renderRows(d.passedTokens || []);
        document.getElementById('recentRows').innerHTML = renderRows(d.recentTokens || []);
      } catch (e) { console.error(e); }
    }
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>
`;

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
      return;
    }
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML_PANEL);
      return;
    }
    res.writeHead(404); res.end('Not found');
  });
  server.listen(PORT, () => {
    console.log(`[Server] Panel web escuchando en el puerto ${PORT}`);
  });
}

// ==========================================
// INICIO
// ==========================================
console.log("=== FOMO CAZADOR INICIADO ===");
startServer();
scanFomo();
setInterval(scanFomo, SCAN_INTERVAL_MS);
