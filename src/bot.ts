// ============================================================================
// 🔥 CryptoQuant Telegram Bot - Pre-Pump Detection Engine
// Finds cheap cryptos about to explode using real data analysis
// Quality over quantity — only high-conviction signals
// ============================================================================

import TelegramBot from 'node-telegram-bot-api';
import { scanFullMarket, analyzePrePumpSetup, type PrePumpScore, type Kline } from './lib/pre-pump-engine';
import { getFearGreed, getTrending, getTopGainers, binanceToCoingecko, getCoinDetail, type CoinDetail } from './lib/market-data';
import { createPrediction, getStats, getPendingPredictions, getRecentPredictions, verifyPredictions, type Prediction } from './lib/prediction';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8634472193:AAGlgv9MocdddlfSCO0mtdgtEV98HRafDqY';
const BINANCE_BASE = 'https://api.binance.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Cache for scan results (refresh every 30 min)
let lastScan: any = null;
let lastScanTime = 0;
const SCAN_CACHE_MS = 30 * 60 * 1000;

// ============================================================================
// HELPER: Format price nicely
// ============================================================================
function fmtPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  if (price >= 0.0001) return `$${price.toFixed(6)}`;
  return `$${price.toFixed(8)}`;
}

function fmtPercent(pct: number): string {
  const emoji = pct > 0 ? '🟢' : pct < 0 ? '🔴' : '⚪';
  return `${emoji} ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function confidenceEmoji(c: string): string {
  switch (c) {
    case 'EXTREME': return '🔥🔥🔥';
    case 'HIGH': return '🔥🔥';
    case 'MEDIUM': return '🔥';
    default: return '📊';
  }
}

function riskEmoji(r: string): string {
  switch (r) {
    case 'LOW': return '🟢';
    case 'MEDIUM': return '🟡';
    default: return '🔴';
  }
}

// ============================================================================
// FORMAT ANALYSIS MESSAGE
// ============================================================================
function formatPrePumpAnalysis(analysis: PrePumpScore): string {
  const ind = analysis.indicators;
  let msg = '';
  msg += `${confidenceEmoji(analysis.confidence)} *${analysis.symbol.replace('USDT', '')}* — Score: *${analysis.totalScore}/${analysis.maxScore}*\n`;
  msg += `Confiance: *${analysis.confidence}* | Risque: ${riskEmoji(analysis.riskLevel)} ${analysis.riskLevel}\n`;
  msg += `💰 Prix: ${fmtPrice(analysis.price)} | Potentiel: ×${analysis.potentialMultiplier.toFixed(0)}\n\n`;

  msg += `📊 *Indicateurs:*\n`;
  if (ind.rsi1d !== null) msg += `  RSI 1D: ${ind.rsi1d.toFixed(1)} | RSI 4H: ${ind.rsi4h?.toFixed(1) ?? 'N/A'}\n`;
  if (ind.stochasticK !== null) msg += `  Stoch: K=${ind.stochasticK.toFixed(1)} D=${ind.stochasticD?.toFixed(1) ?? '-'}\n`;
  if (ind.adx !== null) msg += `  ADX: ${ind.adx.toFixed(1)} | MACD: ${ind.macdBullish ? '✅ Bullish' : '❌ Bearish'}\n`;
  if (ind.bbPosition !== null) msg += `  Bollinger: ${ind.bbPosition.toFixed(0)}% | OBV: ${ind.obvTrend}\n`;
  msg += `  Vol Surge: ${ind.volumeSurge.toFixed(0)}% | vs EMA20: ${ind.priceVsEma20?.toFixed(1) ?? 'N/A'}%\n`;
  msg += `  Momentum 3j: ${fmtPercent(ind.momentum3d)} | 7j: ${fmtPercent(ind.momentum7d)}\n`;
  if (ind.priceVsAth !== null) msg += `  Distance ATH: ${ind.priceVsAth.toFixed(1)}% (potentiel ×${(100 / ind.priceVsAth).toFixed(0)})\n`;

  msg += `\n🎯 *Signaux détectés:*\n`;
  for (const sig of analysis.signals) {
    msg += `  ${sig.emoji} ${sig.name} (${sig.score}/${sig.maxScore}) — ${sig.description}\n`;
  }

  return msg;
}

// ============================================================================
// FORMAT PREDICTION
// ============================================================================
function formatPrediction(pred: Prediction): string {
  const statusEmoji = pred.status === 'PENDING' ? '⏳' :
    pred.status === 'CORRECT' ? '✅' :
    pred.status === 'PARTIAL' ? '🔶' : '❌';

  let msg = `${statusEmoji} *${pred.symbol.replace('USDT', '')}*\n`;
  msg += `  Direction: ${pred.predictedDirection === 'UP' ? '🟢 HAUSSE' : '🔴 BAISSE'} | Prédit: ${fmtPercent(pred.predictedChange)}\n`;
  msg += `  Prix entrée: ${fmtPrice(pred.price)} | Confiance: ${pred.confidence}/100\n`;
  msg += `  Status: ${pred.status}`;

  if (pred.actualChange !== undefined) {
    msg += ` | Réel: ${fmtPercent(pred.actualChange)}`;
  }

  const daysLeft = Math.ceil((pred.targetDate - Date.now()) / (24 * 60 * 60 * 1000));
  if (pred.status === 'PENDING') {
    msg += ` | Vérification dans ${daysLeft}j`;
  }

  return msg;
}

// ============================================================================
// QUICK ANALYSIS (single symbol)
// ============================================================================
async function safeFetchJSON(url: string): Promise<any> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'CryptoQuantBot/2.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    if (!text || text.startsWith('<')) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function quickAnalyze(symbol: string): Promise<PrePumpScore | null> {
  try {
    if (!symbol.endsWith('USDT')) symbol = symbol + 'USDT';
    const [raw1d, raw4h] = await Promise.all([
      safeFetchJSON(`${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=1d&limit=60`),
      safeFetchJSON(`${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=4h&limit=60`)
    ]);

    if (!raw1d || !raw4h) return null;
    if (!Array.isArray(raw1d) || !Array.isArray(raw4h)) return null;
    if (raw1d.length < 25 || raw4h.length < 25) return null;

    const klines1d: Kline[] = raw1d.map((k: any[]) => ({
      openTime: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
      low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
      closeTime: k[6], quoteVolume: parseFloat(k[7])
    }));

    const klines4h: Kline[] = raw4h.map((k: any[]) => ({
      openTime: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
      low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
      closeTime: k[6], quoteVolume: parseFloat(k[7])
    }));

    return analyzePrePumpSetup(symbol, klines1d, klines4h);
  } catch {
    return null;
  }
}

// Fetch current price from Binance
async function fetchCurrentPrice(symbol: string): Promise<number | null> {
  try {
    if (!symbol.endsWith('USDT')) symbol = symbol + 'USDT';
    const data = await safeFetchJSON(`${BINANCE_BASE}/api/v3/ticker/price?symbol=${symbol}`);
    if (!data || !data.price) return null;
    return parseFloat(data.price);
  } catch {
    return null;
  }
}

// ============================================================================
// BOT COMMANDS
// ============================================================================

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcome = `
🔥 *CryptoQuant — Pre-Pump Detection Engine* 🔥

Je suis ton bot de détection de cryptos qui vont exploser.
Pas du bruit. Que de la QUALITÉ.

*Comment je fonctionne:*
1️⃣ J'analyse l'historique des cryptos qui ont déjà fait +200%
2️⃣ J'identifie les patterns avant l'explosion
3️⃣ Je scanne le marché pour les mêmes patterns
4️⃣ Je ne te donne que les signaux HAUTE CONVICTION

*Commandes:*
/explosive — 🚀 Top cryptos prêtes à exploser
/analyze SYMBOLE — 🔬 Analyse profonde d'une crypto
/market — 📊 État du marché (Fear\\&Greed, trending)
/predict — 🔮 Prédictions actives + score
/verify — ✅ Vérifier les prédictions passées
/score — 📈 Mon score de précision
/gainers — 📈 Top cryptos qui montent
/help — ❓ Aide

⚠️ *Règle #1:* Qualité > Quantité. Pas de signaux faibles.
`;
  bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
});

// /explosive — THE main command: find cryptos about to explode
bot.onText(/\/explosive/, async (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, '🔍 Scan du marché en cours... Analyse de 400+ paires Binance, ça prend 1-2 min...');

  try {
    // Use cache or fresh scan
    if (!lastScan || Date.now() - lastScanTime > SCAN_CACHE_MS) {
      const scan = await scanFullMarket();
      lastScan = scan;
      lastScanTime = Date.now();
    }

    const scan = lastScan;

    // Fear & Greed context
    let fngEmoji = '😐';
    if (scan.fearAndGreed <= 25) fngEmoji = '😱';
    else if (scan.fearAndGreed <= 45) fngEmoji = '😨';
    else if (scan.fearAndGreed <= 55) fngEmoji = '😐';
    else if (scan.fearAndGreed <= 75) fngEmoji = '😊';
    else fngEmoji = '🤑';

    let message = `🔥🔥🔥 *CRYPTOS PRÊTES À EXPLOSER* 🔥🔥🔥\n\n`;
    message += `${fngEmoji} Fear & Greed: *${scan.fearAndGreed}/100* (${scan.fearAndGreedLabel})\n`;
    message += `📊 Paires scannées: ${scan.totalScanned}\n`;
    message += `💎 Signaux haute conviction: ${scan.highConviction.length}\n\n`;

    if (scan.topPicks.length === 0) {
      message += `⚠️ Aucun signal haute conviction trouvé en ce moment.\nC'est normal — la qualité prime. Patiente.`;
    } else {
      // Show top picks with quality threshold
      const qualityPicks = scan.topPicks.filter(p => p.totalScore >= 50);

      if (qualityPicks.length === 0) {
        message += `⚠️ Pas de signaux qui atteignent le seuil de qualité (50/155).\nLes meilleurs candidats actuels:\n\n`;
        for (const pick of scan.topPicks.slice(0, 3)) {
          message += formatPrePumpAnalysis(pick) + '\n─────────\n';
        }
      } else {
        for (const pick of qualityPicks.slice(0, 5)) {
          message += formatPrePumpAnalysis(pick) + '\n─────────\n';
        }
      }
    }

    // Split long messages
    if (message.length > 4000) {
      const parts = message.split('─────────');
      let currentPart = message.split('─────────')[0];
      for (let i = 1; i < parts.length; i++) {
        if (currentPart.length + parts[i].length > 3500) {
          bot.sendMessage(chatId, currentPart, { parse_mode: 'Markdown' });
          currentPart = parts[i];
        } else {
          currentPart += '─────────' + parts[i];
        }
      }
      if (currentPart.trim()) {
        bot.sendMessage(chatId, currentPart, { parse_mode: 'Markdown' });
      }
    } else {
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }

  } catch (error: any) {
    bot.sendMessage(chatId, `❌ Erreur pendant le scan: ${error.message}`);
  }
});

// /analyze SYMBOL — Deep analysis of a specific coin
bot.onText(/\/analyze\s+(\S+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const symbol = (match?.[1] ?? '').toUpperCase().replace('USDT', '');

  bot.sendMessage(chatId, `🔬 Analyse approfondie de ${symbol}...`);

  try {
    const analysis = await quickAnalyze(symbol);

    if (!analysis) {
      bot.sendMessage(chatId, `❌ ${symbol} introuvable sur Binance ou pas assez de données.`);
      return;
    }

    let message = `🔬 *ANALYSE PROFONDE — ${symbol}*\n\n`;
    message += formatPrePumpAnalysis(analysis);

    // Add CoinGecko details if available
    const cgId = binanceToCoingecko(symbol + 'USDT');
    if (cgId) {
      const detail = await getCoinDetail(cgId);
      if (detail) {
        message += `\n📋 *Détails CoinGecko:*\n`;
        message += `  Nom: ${detail.name}\n`;
        message += `  Market Cap: $${(detail.marketCap ?? 0).toLocaleString()}\n`;
        message += `  Volume 24h: $${(detail.volume24h ?? 0).toLocaleString()}\n`;
        message += `  1h: ${fmtPercent(detail.change1h)} | 24h: ${fmtPercent(detail.change24h)}\n`;
        message += `  7j: ${fmtPercent(detail.change7d)} | 30j: ${fmtPercent(detail.change30d)}\n`;
        if (detail.ath > 0) {
          message += `  ATH: ${fmtPrice(detail.ath)} (${detail.athChangePercent.toFixed(1)}% sous)\n`;
        }
        if (detail.sentimentUp > 0) {
          message += `  Sentiment: ${detail.sentimentUp.toFixed(0)}% ↑ ${detail.sentimentDown.toFixed(0)}% ↓\n`;
        }
        if (detail.categories.length > 0) {
          message += `  Catégories: ${detail.categories.slice(0, 3).join(', ')}\n`;
        }
      }
    }

    // Auto-create prediction for high-confidence signals
    if (analysis.confidence === 'EXTREME' || analysis.confidence === 'HIGH') {
      const pred = createPrediction(analysis);
      message += `\n🔮 *Prédiction auto-créée:*\n`;
      message += `  ${pred.predictedDirection === 'UP' ? '🟢 HAUSSE' : '🔴 BAISSE'} ${fmtPercent(pred.predictedChange)} en 7j\n`;
      message += `  Je vérifierai dans 7 jours et je scorerai ma précision.`;
    }

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error: any) {
    bot.sendMessage(chatId, `❌ Erreur: ${error.message}`);
  }
});

// /market — Market overview
bot.onText(/\/market/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const [fng, trending, gainers] = await Promise.all([
      getFearGreed(),
      getTrending(),
      getTopGainers('7d', 0)
    ]);

    let fngEmoji = '😐';
    if (fng.value <= 25) fngEmoji = '😱';
    else if (fng.value <= 45) fngEmoji = '😨';
    else if (fng.value <= 55) fngEmoji = '😐';
    else if (fng.value <= 75) fngEmoji = '😊';
    else fngEmoji = '🤑';

    let message = `📊 *ÉTAT DU MARCHÉ*\n\n`;
    message += `${fngEmoji} *Fear & Greed: ${fng.value}/100* (${fng.label})\n`;
    if (fng.value <= 35) {
      message += `💡 Le marché a peur → C'est le meilleur moment pour acheter !\n`;
    } else if (fng.value >= 70) {
      message += `⚠️ Le marché est avide → Attention, risque de correction\n`;
    }

    message += `\n🔥 *Trending:*\n`;
    for (const t of trending.slice(0, 7)) {
      message += `  ${t.symbol} (${t.name}) — MCap #${t.marketCapRank}\n`;
    }

    message += `\n🚀 *Top Gainers 7j:*\n`;
    for (const g of gainers.slice(0, 7)) {
      message += `  ${g.symbol}: ${fmtPercent(g.change7d)} — ${fmtPrice(g.price)}\n`;
    }

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error: any) {
    bot.sendMessage(chatId, `❌ Erreur: ${error.message}`);
  }
});

// /predict — Show current predictions
bot.onText(/\/predict/, (msg) => {
  const chatId = msg.chat.id;
  const pending = getPendingPredictions();
  const recent = getRecentPredictions(5);

  let message = `🔮 *PRÉDICTIONS*\n\n`;

  if (pending.length > 0) {
    message += `⏳ *En cours (${pending.length}):*\n`;
    for (const p of pending.slice(0, 5)) {
      message += formatPrediction(p) + '\n';
    }
  } else {
    message += `Aucune prédiction en cours. Utilise /explosive pour trouver des cryptos et créer des prédictions auto.\n`;
  }

  if (recent.length > 0) {
    message += `\n📜 *Récentes:*\n`;
    for (const p of recent.slice(0, 5)) {
      message += formatPrediction(p) + '\n';
    }
  }

  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// /verify — Verify pending predictions
bot.onText(/\/verify/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '✅ Vérification des prédictions en cours...');

  try {
    const verified = await verifyPredictions(fetchCurrentPrice);

    if (verified.length === 0) {
      bot.sendMessage(chatId, '⏳ Aucune prédiction à vérifier pour le moment.');
      return;
    }

    let message = `✅ *VÉRIFICATION DES PRÉDICTIONS*\n\n`;
    for (const p of verified) {
      message += formatPrediction(p) + '\n';
    }

    const stats = getStats();
    message += `\n📊 Précision actuelle: *${stats.accuracy}%* | Streak: ${stats.streak} ✅`;

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error: any) {
    bot.sendMessage(chatId, `❌ Erreur: ${error.message}`);
  }
});

// /score — Show prediction accuracy
bot.onText(/\/score/, (msg) => {
  const chatId = msg.chat.id;
  const stats = getStats();

  let message = `📈 *SCORE DU SYSTÈME*\n\n`;
  message += `  Total prédictions: ${stats.total}\n`;
  message += `  ✅ Correctes: ${stats.correct}\n`;
  message += `  ❌ Incorrectes: ${stats.incorrect}\n`;
  message += `  ⏳ En attente: ${stats.pending}\n`;
  message += `  🎯 Précision: *${stats.accuracy}%*\n`;
  message += `  📊 Rendement moyen: ${fmtPercent(stats.avgReturn)}\n`;
  message += `  🔥 Streak: ${stats.streak} ✅\n`;

  if (stats.bestPrediction) {
    message += `\n🏆 Meilleure prédiction: ${stats.bestPrediction.symbol} → ${fmtPercent(stats.bestPrediction.actualChange ?? 0)}\n`;
  }

  if (stats.learningNotes.length > 0) {
    message += `\n🧠 *Apprentissage récent:*\n`;
    for (const note of stats.learningNotes.slice(-5)) {
      message += `  ${note}\n`;
    }
  }

  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// /gainers — Top gainers
bot.onText(/\/gainers/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const gainers = await getTopGainers('7d', 0);

    let message = `🚀 *TOP GAINERS 7 JOURS*\n\n`;
    for (let i = 0; i < Math.min(gainers.length, 15); i++) {
      const g = gainers[i];
      const volMc = g.marketCap > 0 ? ((g.volume24h / g.marketCap) * 100).toFixed(1) : '0';
      message += `${i + 1}. *${g.symbol}* — ${fmtPercent(g.change7d)}\n`;
      message += `   Prix: ${fmtPrice(g.price)} | MC: $${(g.marketCap / 1e6).toFixed(1)}M | Vol/MC: ${volMc}%\n`;
    }

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error: any) {
    bot.sendMessage(chatId, `❌ Erreur: ${error.message}`);
  }
});

// /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const help = `
❓ *AIDE CryptoQuant*

🔥 */explosive* — Top cryptos prêtes à exploser
   Scan 400+ paires, analyse multi-timeframe, signaux haute conviction

🔬 */analyze SYMBOLE* — Analyse profonde d'une crypto
   Ex: /analyze ONT, /analyze ENJ

📊 */market* — État du marché
   Fear & Greed, trending, top gainers

🔮 */predict* — Prédictions actives
   Signaux auto-créés pour les cryptos haute conviction

✅ */verify* — Vérifier les prédictions passées
   Compare les prédictions avec les résultats réels

📈 */score* — Score de précision du système
   Taux de réussite, streak, apprentissage

🚀 */gainers* — Top cryptos qui montent

*Comment ça marche:*
1. Le bot analyse les cryptos qui ont déjà fait +200%
2. Il identifie les patterns pré-explosion (RSI, Volume, OBV...)
3. Il scanne le marché actuel pour les mêmes patterns
4. Seuls les signaux haute conviction sont affichés

⚠️ Ce bot ne fait pas de conseils financiers. Trade à tes risques.
`;
  bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

console.log('🔥 CryptoQuant Bot started!');
console.log('📊 Pre-Pump Detection Engine active');
console.log('🎯 Quality > Quantity mode: ON');

// ============================================================================
// AUTO-VERIFY every 6 hours
// ============================================================================
setInterval(async () => {
  try {
    const verified = await verifyPredictions(fetchCurrentPrice);
    if (verified.length > 0) {
      console.log(`✅ Auto-verified ${verified.length} predictions`);
    }
  } catch (e) {
    console.error('Auto-verify error:', e);
  }
}, 6 * 60 * 60 * 1000);
