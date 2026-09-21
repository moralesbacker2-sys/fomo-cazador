require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS || 60000);

// Memoria para no repetir alertas de la misma moneda
const alertedTokens = new Map();

async function sendTelegramMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("[Telegram] Faltan credenciales. Configura el .env");
    return;
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: text, parse_mode: 'HTML' })
    });
  } catch (e) {
    console.error("[Telegram] Error enviando mensaje:", e.message);
  }
}

async function scanFomo() {
  console.log(`[Scan] Buscando memecoins en BNB Chain... ${new Date().toISOString()}`);
  
  try {
    // Usamos la API pública de DexScreener para buscar los pares más recientes en BSC (PancakeSwap)
    const response = await fetch('https://api.dexscreener.com/latest/dex/search?q=BNB');
    const data = await response.json();

    if (!data || !data.pairs) return;

    for (const pair of data.pairs) {
      // 1. FILTRO DE RED: Solo BNB Chain (BSC) y PancakeSwap
      if (pair.chainId !== 'bsc') continue;
      if (!pair.dexId.includes('pancakeswap')) continue;

      const symbol = pair.baseToken.symbol;
      const price = parseFloat(pair.priceUsd);
      const liquidity = pair.liquidity ? pair.liquidity.usd : 0;
      const fdv = pair.fdv || 0; // Fully Diluted Valuation (proxy del Cap. de Mercado)
      const createdAt = pair.pairCreatedAt || Date.now(); // Antigüedad en ms
      const ageMinutes = (Date.now() - createdAt) / 60000;

      // 2. TUS FILTROS DE FOMO
      // - Cap. de mercado entre $5K y $100K (Usamos FDV como proxy)
      // - Liquidez mayor a $3K
      // - Antigüedad mayor a 15 minutos (para evitar bots de primer segundo)
      // - Volumen 24h mayor a $10K (para asegurar que hay movimiento)
      const vol24h = pair.volume ? pair.volume.h24 : 0;
      
      const cumpleFiltros = 
        fdv >= 5000 && fdv <= 150000 &&
        liquidity >= 3000 &&
        ageMinutes >= 15 &&
        vol24h >= 10000;

      if (!cumpleFiltros) continue;

      // 3. CONTROL DE ANTIDUPLICADO (No avisar de la misma moneda en los próximos 30 min)
      const lastAlert = alertedTokens.get(symbol) || 0;
      if (Date.now() - lastAlert < 30 * 60 * 1000) continue;

      // 4. ¡ENVIAR ALERTA!
      alertedTokens.set(symbol, Date.now());
      
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

// Iniciar el bucle infinito
console.log("=== FOMO CAZADOR INICIADO ===");
console.log(`Escaneando cada ${SCAN_INTERVAL_MS / 1000} segundos...`);

// Primer escaneo inmediato
scanFomo();
// Luego cada X segundos
setInterval(scanFomo, SCAN_INTERVAL_MS);
