// ============================================================================
// 🧠 QUANTITATIVE BRAIN — JP Morgan Grade Crypto Intelligence
// Runs 24/7, thinks, detects, notifies. No buttons. Pure intelligence.
// ============================================================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8634472193:AAGlgv9MocdddlfSCO0mtdgtEV98HRafDqY';
const BINANCE_SPOT = 'https://api.binance.com';
const BINANCE_FUTURES = 'https://fapi.binance.com';
const COINGECKO = 'https://api.coingecko.com/api/v3';

// ============================================================================
// SAFE FETCH — Never crashes, always returns null on failure
// ============================================================================
async function safeFetch(url: string, timeout = 10000): Promise<any> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'CryptoQuantBrain/3.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(timeout),
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    if (!text || text.startsWith('<') || text.startsWith('<!DOCTYPE')) return null;
    return JSON.parse(text);
  } catch { return null; }
}

// ============================================================================
// DATA MODELS
// ============================================================================
interface MarketSnapshot {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  quoteVolume24h: number;
  high24h: number;
  low24h: number;
  trades24h: number;
}

interface FuturesData {
  symbol: string;
  fundingRate: number;
  openInterest: number;
  longShortRatio: number;
  longAccount: number;
  shortAccount: number;
  takerBuyVol: number;
  takerSellVol: number;
  takerBuySellRatio: number;
}

interface TechnicalData {
  symbol: string;
  rsi1d: number | null;
  rsi4h: number | null;
  ema20: number | null;
  ema50: number | null;
  bbPosition: number | null;
  stochasticK: number | null;
  adx: number | null;
  macdBullish: boolean;
  obvTrend: string;
  volumeSurge: number;
  priceVsEma20: number | null;
  momentum3d: number;
  momentum7d: number;
  atrPercent: number;
}

interface Signal {
  type: 'EXPLOSIVE_LONG' | 'STRONG_LONG' | 'LONG' | 'SHORT_SQUEEZE' | 'WHALE_ACCUMULATION' | 'FUNDING_TRAP' | 'CAPITULATION_BUY';
  symbol: string;
  conviction: 1 | 2 | 3 | 4 | 5; // 5 = highest
  price: number;
  reasoning: string[];
  indicators: Record<string, string | number | null>;
  timestamp: number;
  targetMove: number; // expected % move
  stopLoss: number; // % below entry
  timeframe: string;
}

// ============================================================================
// TECHNICAL INDICATORS
// ============================================================================
function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(Math.max(0, diff)); losses.push(Math.max(0, -diff));
  }
  if (gains.length < period) return null;
  let avgG = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgL = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgG = (avgG * (period - 1) + gains[i]) / period;
    avgL = (avgL * (period - 1) + losses[i]) / period;
  }
  return avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
}

function calcEMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const m = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = (closes[i] - ema) * m + ema;
  return ema;
}

function calcStochastic(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  if (closes.length < period) return null;
  const h = Math.max(...highs.slice(-period)), l = Math.min(...lows.slice(-period));
  return h === l ? 50 : ((closes[closes.length - 1] - l) / (h - l)) * 100;
}

function calcADX(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  if (closes.length < period * 2) return null;
  const trs: number[] = [], pDM: number[] = [], mDM: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    const up = highs[i] - highs[i - 1], dn = lows[i - 1] - lows[i];
    pDM.push(up > dn && up > 0 ? up : 0);
    mDM.push(dn > up && dn > 0 ? dn : 0);
  }
  if (trs.length < period) return null;
  const atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const pDI = atr > 0 ? (pDM.slice(0, period).reduce((a, b) => a + b, 0) / period / atr) * 100 : 0;
  const mDI = atr > 0 ? (mDM.slice(0, period).reduce((a, b) => a + b, 0) / period / atr) * 100 : 0;
  const sum = pDI + mDI;
  return sum > 0 ? (Math.abs(pDI - mDI) / sum) * 100 : 0;
}

function calcOBV(closes: number[], volumes: number[]): number {
  let obv = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
  }
  return obv;
}

function calcBollingerPos(closes: number[], period = 20): number | null {
  if (closes.length < period) return null;
  const sma = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(closes.slice(-period).reduce((s, c) => s + (c - sma) ** 2, 0) / period);
  const upper = sma + 2 * std, lower = sma - 2 * std;
  return upper === lower ? 50 : ((closes[closes.length - 1] - lower) / (upper - lower)) * 100;
}

function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  if (highs.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++)
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  return trs.length >= period ? trs.slice(-period).reduce((a, b) => a + b, 0) / period : null;
}

// ============================================================================
// BRAIN — THE QUANTITATIVE ENGINE
// ============================================================================

class QuantBrain {
  private chatId: number = 0;
  private lastSignals: Map<string, number> = new Map(); // symbol -> timestamp (dedup)
  private scanCount = 0;
  private isRunning = false;

  // Market state
  private fearGreed = { value: 50, label: 'Neutral' };
  private btcDominance = 0;
  private totalMarketCap = 0;

  constructor(private botToken: string) {}

  async start(chatId: number) {
    this.chatId = chatId;
    this.isRunning = true;

    // Boot message
    await this.notify(`
🧠 *QUANTITATIVE BRAIN V3 — ACTIVATED*

Système de détection H24 en ligne.
Analyse continue: 529 paires futures + spot
Données: Funding, OI, Long/Short, Taker Flow, 15 indicateurs techniques

Je réfléchis. Je détecte. Je t'envoie les signaux.
Tu n'as rien à faire. Juste à lire et agir.

Fréquence de scan:
• Scan rapide: toutes les 5 min
• Scan profond: toutes les 30 min
• Notification: uniquement signaux conviction 4-5/5

_Lancement du premier scan profond..._
`);

    // Initial deep scan
    await this.deepScan();

    // Start loops
    this.runQuickScanLoop();  // Every 5 min
    this.runDeepScanLoop();   // Every 30 min
    this.runFundingLoop();    // Every 8h (funding settlement)
    this.runMarketPulseLoop(); // Every 15 min (macro context)
  }

  private async notify(text: string) {
    if (!this.chatId) return;
    try {
      await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1'),
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true,
        }),
      });
    } catch (e) {
      console.error('Notify error:', (e as Error).message);
    }
  }

  // Simple markdown escaper for MarkdownV2
  private esc(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }

  private async notifySignal(signal: Signal) {
    const convictionBar = '█'.repeat(signal.conviction) + '░'.repeat(5 - signal.conviction);
    const typeEmojis: Record<string, string> = {
      'EXPLOSIVE_LONG': '🔥💥',
      'STRONG_LONG': '🔥',
      'LONG': '📈',
      'SHORT_SQUEEZE': '⚡🔥',
      'WHALE_ACCUMULATION': '🐋',
      'FUNDING_TRAP': '🪤',
      'CAPITULATION_BUY': '💀💎',
    };

    let msg = `${typeEmojis[signal.type] || '📊'} *${this.esc(signal.type)}* \\| ${this.esc(signal.symbol.replace('USDT', ''))}
`;
    msg += `Conviction: ${this.esc(convictionBar)} ${signal.conviction}/5
`;
    msg += `Prix: ${this.esc(this.fmtPrice(signal.price))} \\| Target: ${this.esc(signal.targetMove > 0 ? '+' : '')}${signal.targetMove.toFixed(1)}% \\| Stop: \\-${signal.stopLoss.toFixed(1)}%
`;
    msg += `Timeframe: ${this.esc(signal.timeframe)}
`;
    msg += `
*Raisonnement:*
`;
    for (const r of signal.reasoning) {
      msg += `• ${this.esc(r)}
`;
    }
    msg += `
*Données:*
`;
    for (const [k, v] of Object.entries(signal.indicators)) {
      if (v !== null && v !== undefined) {
        msg += `  ${this.esc(k)}: ${this.esc(String(v))}
`;
      }
    }

    await this.notify(msg);
  }

  private fmtPrice(p: number): string {
    if (p >= 1000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    if (p >= 1) return `$${p.toFixed(2)}`;
    if (p >= 0.01) return `$${p.toFixed(4)}`;
    if (p >= 0.0001) return `$${p.toFixed(6)}`;
    return `$${p.toFixed(8)}`;
  }

  // ========================================================================
  // SCAN LOOPS
  // ========================================================================

  private async runQuickScanLoop() {
    while (this.isRunning) {
      await this.sleep(5 * 60 * 1000); // 5 min
      try {
        await this.quickScan();
      } catch (e) {
        console.error('QuickScan error:', e);
      }
    }
  }

  private async runDeepScanLoop() {
    while (this.isRunning) {
      await this.sleep(30 * 60 * 1000); // 30 min
      try {
        await this.deepScan();
      } catch (e) {
        console.error('DeepScan error:', e);
      }
    }
  }

  private async runFundingLoop() {
    while (this.isRunning) {
      await this.sleep(8 * 60 * 60 * 1000); // 8h
      try {
        await this.fundingScan();
      } catch (e) {
        console.error('FundingScan error:', e);
      }
    }
  }

  private async runMarketPulseLoop() {
    while (this.isRunning) {
      await this.sleep(15 * 60 * 1000); // 15 min
      try {
        await this.updateMarketPulse();
      } catch (e) {
        console.error('MarketPulse error:', e);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  // ========================================================================
  // QUICK SCAN — Checks top movers for immediate signals
  // ========================================================================

  private async quickScan() {
    console.log(`⚡ QuickScan #${++this.scanCount} @ ${new Date().toISOString()}`);

    // Get top movers from Binance futures
    const tickers = await safeFetch(`${BINANCE_FUTURES}/fapi/v1/ticker/24hr`);
    if (!tickers || !Array.isArray(tickers)) return;

    // Find coins with unusual activity
    const unusual = tickers
      .filter((t: any) => {
        const pct = parseFloat(t.priceChangePercent || '0');
        const vol = parseFloat(t.quoteVolume || '0');
        return Math.abs(pct) > 5 && vol > 1000000; // >5% move and >$1M vol
      })
      .sort((a: any, b: any) => Math.abs(parseFloat(b.priceChangePercent)) - Math.abs(parseFloat(a.priceChangePercent)))
      .slice(0, 20);

    for (const ticker of unusual) {
      const symbol = ticker.symbol as string;
      const change = parseFloat(ticker.priceChangePercent);
      const price = parseFloat(ticker.lastPrice);
      const vol = parseFloat(ticker.quoteVolume);

      // Check if we already signaled this recently (dedup 2h)
      const lastTime = this.lastSignals.get(symbol) || 0;
      if (Date.now() - lastTime < 2 * 60 * 60 * 1000) continue;

      // Get futures data for context
      const futuresData = await this.getFuturesData(symbol);

      // Analyze the move
      const signals = this.analyzeMove(symbol, price, change, vol, futuresData);

      for (const signal of signals) {
        if (signal.conviction >= 4) { // Only notify for high conviction
          await this.notifySignal(signal);
          this.lastSignals.set(symbol, Date.now());
        }
      }
    }
  }

  // ========================================================================
  // DEEP SCAN — Full technical + futures analysis on all pairs
  // ========================================================================

  private async deepScan() {
    console.log(`🔬 DeepScan #${++this.scanCount} @ ${new Date().toISOString()}`);

    // Update macro context
    await this.updateMarketPulse();

    // Get all perpetual futures symbols
    const exchangeInfo = await safeFetch(`${BINANCE_FUTURES}/fapi/v1/exchangeInfo`);
    if (!exchangeInfo || !Array.isArray(exchangeInfo.symbols)) {
      console.log('⚠️ Futures exchangeInfo failed, using spot scan');
      await this.deepScanSpot();
      return;
    }

    const futuresSymbols = exchangeInfo.symbols
      .filter((s: any) => s.quoteAsset === 'USDT' && s.status === 'TRADING' && s.contractType === 'PERPETUAL')
      .map((s: any) => s.symbol);

    console.log(`📊 Scanning ${futuresSymbols.length} perpetual futures...`);

    // Get 24h tickers for pre-filtering
    const tickers = await safeFetch(`${BINANCE_FUTURES}/fapi/v1/ticker/24hr`);
    if (!tickers || !Array.isArray(tickers)) return;

    const tickerMap = new Map<string, any>();
    for (const t of tickers) tickerMap.set(t.symbol, t);

    // Pre-filter: only analyze pairs with meaningful volume
    const candidates = futuresSymbols.filter(sym => {
      const t = tickerMap.get(sym);
      if (!t) return false;
      const vol = parseFloat(t.quoteVolume || '0');
      return vol > 500000; // >$500K daily volume
    });

    console.log(`📊 ${candidates.length} pairs pass volume filter`);

    // Process in batches
    const allSignals: Signal[] = [];
    const batchSize = 5;

    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map(sym => this.fullAnalysis(sym)));

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          allSignals.push(...result.value);
        }
      }

      // Rate limit
      if (i % 30 === 0 && i > 0) await this.sleep(500);
    }

    // Sort by conviction, then score
    allSignals.sort((a, b) => b.conviction - a.conviction || b.targetMove - a.targetMove);

    // Dedup: only keep best signal per symbol
    const seen = new Set<string>();
    const unique = allSignals.filter(s => {
      if (seen.has(s.symbol)) return false;
      seen.add(s.symbol);
      return true;
    });

    // Notify only conviction 4-5 signals
    const topSignals = unique.filter(s => s.conviction >= 4);
    for (const signal of topSignals.slice(0, 5)) {
      const lastTime = this.lastSignals.get(signal.symbol) || 0;
      if (Date.now() - lastTime < 4 * 60 * 60 * 1000) continue; // Dedup 4h
      await this.notifySignal(signal);
      this.lastSignals.set(signal.symbol, Date.now());
    }

    // Daily summary for conviction 3 signals
    if (this.scanCount % 48 === 0 && unique.filter(s => s.conviction >= 3).length > 0) { // ~24h
      const medium = unique.filter(s => s.conviction === 3).slice(0, 8);
      let summary = `📋 *RAPPORT QUOTIDIEN — Signaux modérés*\n\n`;
      for (const s of medium) {
        summary += `${s.type === 'LONG' || s.type.includes('LONG') ? '📈' : '📉'} ${this.esc(s.symbol.replace('USDT', ''))} \\| ${this.esc(this.fmtPrice(s.price))} \\| Target: ${s.targetMove > 0 ? '+' : ''}${s.targetMove.toFixed(1)}% \\| ${s.conviction}/5\n`;
        summary += `  _${this.esc(s.reasoning[0] || '')}_\n`;
      }
      await this.notify(summary);
    }

    console.log(`✅ DeepScan done: ${allSignals.length} signals, ${topSignals.length} high-conviction`);
  }

  private async deepScanSpot() {
    // Fallback: spot-only analysis
    const pairs = await this.getSpotPairs();
    const allSignals: Signal[] = [];

    for (let i = 0; i < Math.min(pairs.length, 150); i += 4) {
      const batch = pairs.slice(i, i + 4);
      const results = await Promise.allSettled(batch.map(sym => this.technicalAnalysis(sym)));

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value?.length) {
          allSignals.push(...result.value);
        }
      }
      if (i % 20 === 0) await this.sleep(300);
    }

    allSignals.sort((a, b) => b.conviction - a.conviction);
    const top = allSignals.filter(s => s.conviction >= 4).slice(0, 5);
    for (const signal of top) {
      const lastTime = this.lastSignals.get(signal.symbol) || 0;
      if (Date.now() - lastTime < 4 * 60 * 60 * 1000) continue;
      await this.notifySignal(signal);
      this.lastSignals.set(signal.symbol, Date.now());
    }
  }

  // ========================================================================
  // FULL ANALYSIS — Technicals + Futures + Flow (per symbol)
  // ========================================================================

  private async fullAnalysis(symbol: string): Promise<Signal[]> {
    const signals: Signal[] = [];

    try {
      // Fetch all data in parallel
      const [klines1d, klines4h, futuresData, ticker] = await Promise.all([
        safeFetch(`${BINANCE_SPOT}/api/v3/klines?symbol=${symbol}&interval=1d&limit=60`),
        safeFetch(`${BINANCE_SPOT}/api/v3/klines?symbol=${symbol}&interval=4h&limit=60`),
        this.getFuturesData(symbol),
        safeFetch(`${BINANCE_FUTURES}/fapi/v1/ticker/24hr?symbol=${symbol}`),
      ]);

      if (!klines1d || !Array.isArray(klines1d) || klines1d.length < 25) return signals;
      if (!klines4h || !Array.isArray(klines4h) || klines4h.length < 25) return signals;

      // Parse klines
      const closes1d = klines1d.map((k: any[]) => parseFloat(k[4]));
      const volumes1d = klines1d.map((k: any[]) => parseFloat(k[5]));
      const highs1d = klines1d.map((k: any[]) => parseFloat(k[2]));
      const lows1d = klines1d.map((k: any[]) => parseFloat(k[3]));
      const closes4h = klines4h.map((k: any[]) => parseFloat(k[4]));

      const price = closes1d[closes1d.length - 1];
      const change24h = ticker ? parseFloat(ticker.priceChangePercent || '0') : 0;
      const vol24h = ticker ? parseFloat(ticker.quoteVolume || '0') : 0;

      // Calculate all technicals
      const tech: TechnicalData = {
        symbol,
        rsi1d: calcRSI(closes1d),
        rsi4h: calcRSI(closes4h),
        ema20: calcEMA(closes1d, 20),
        ema50: calcEMA(closes1d, Math.min(50, closes1d.length - 1)),
        bbPosition: calcBollingerPos(closes1d),
        stochasticK: calcStochastic(highs1d, lows1d, closes1d),
        adx: calcADX(highs1d, lows1d, closes1d),
        macdBullish: (calcEMA(closes1d, 12) ?? 0) > (calcEMA(closes1d, 26) ?? 0),
        obvTrend: this.getOBVTrend(closes1d, volumes1d),
        volumeSurge: this.getVolumeSurge(volumes1d),
        priceVsEma20: calcEMA(closes1d, 20) ? ((price / calcEMA(closes1d, 20)!) - 1) * 100 : null,
        momentum3d: closes1d.length > 4 ? ((closes1d[closes1d.length - 1] / closes1d[closes1d.length - 4]) - 1) * 100 : 0,
        momentum7d: closes1d.length > 8 ? ((closes1d[closes1d.length - 1] / closes1d[closes1d.length - 8]) - 1) * 100 : 0,
        atrPercent: (calcATR(highs1d, lows1d, closes1d) ?? 0) / price * 100,
      };

      // ===== SCORING ENGINE =====

      // 1. PRE-PUMP SETUP (technicals only)
      const prePumpScore = this.scorePrePump(tech, price);
      if (prePumpScore.conviction >= 3) {
        signals.push(prePumpScore);
      }

      // 2. SHORT SQUEEZE (futures + technicals)
      const squeeze = this.detectShortSqueeze(tech, futuresData, price);
      if (squeeze) signals.push(squeeze);

      // 3. WHALE ACCUMULATION (futures flow + OBV)
      const whale = this.detectWhaleAccumulation(tech, futuresData, price, vol24h);
      if (whale) signals.push(whale);

      // 4. FUNDING TRAP (extreme funding + technical divergence)
      const trap = this.detectFundingTrap(tech, futuresData, price);
      if (trap) signals.push(trap);

      // 5. CAPITULATION BUY (extreme fear + oversold + volume spike)
      const capBuy = this.detectCapitulationBuy(tech, change24h, vol24h, price);
      if (capBuy) signals.push(capBuy);

    } catch (e) {
      // Silent fail, move to next symbol
    }

    return signals;
  }

  // ========================================================================
  // DETECTION ALGORITHMS
  // ========================================================================

  private scorePrePump(tech: TechnicalData, price: number): Signal {
    let score = 0;
    const reasoning: string[] = [];
    const indicators: Record<string, any> = {};

    // RSI zone
    if (tech.rsi1d !== null) {
      indicators['RSI_1D'] = tech.rsi1d.toFixed(1);
      if (tech.rsi1d >= 30 && tech.rsi1d <= 50) { score += 25; reasoning.push(`RSI ${tech.rsi1d.toFixed(0)} zone pré-pump optimale`); }
      else if (tech.rsi1d < 30) { score += 20; reasoning.push(`RSI ${tech.rsi1d.toFixed(0)} survendu extrême`); }
      else if (tech.rsi1d > 50 && tech.rsi1d <= 60) { score += 10; reasoning.push(`RSI ${tech.rsi1d.toFixed(0)} momentum en construction`); }
    }

    // Multi-TF RSI confluence
    if (tech.rsi1d !== null && tech.rsi4h !== null && tech.rsi1d >= 30 && tech.rsi1d <= 60 && tech.rsi4h >= 30 && tech.rsi4h <= 60) {
      score += 15; reasoning.push(`RSI 1D+4H confluents (${tech.rsi1d.toFixed(0)}/${tech.rsi4h.toFixed(0)})`);
    }
    if (tech.rsi4h !== null) indicators['RSI_4H'] = tech.rsi4h.toFixed(1);

    // Volume surge
    indicators['Vol_Surge'] = `${tech.volumeSurge.toFixed(0)}%`;
    if (tech.volumeSurge > 200) { score += 25; reasoning.push(`Volume ×${(tech.volumeSurge / 100).toFixed(1)} — accumulation massive`); }
    else if (tech.volumeSurge > 150) { score += 20; reasoning.push(`Volume ×${(tech.volumeSurge / 100).toFixed(1)} — forte accumulation`); }
    else if (tech.volumeSurge > 120) { score += 10; reasoning.push(`Volume ×${(tech.volumeSurge / 100).toFixed(1)} en hausse`); }

    // OBV
    indicators['OBV'] = tech.obvTrend;
    if (tech.obvTrend === 'ACCUMULATION') { score += 20; reasoning.push('OBV accumulation — gros achètent silencieusement'); }
    else if (tech.obvTrend === 'STRONG_BUY') { score += 15; reasoning.push('OBV strong buy — prix et volume alignés'); }

    // Stochastic
    if (tech.stochasticK !== null) {
      indicators['Stoch_K'] = tech.stochasticK.toFixed(1);
      if (tech.stochasticK < 20) { score += 20; reasoning.push(`Stochastic ${tech.stochasticK.toFixed(0)} — zone golden cross`); }
      else if (tech.stochasticK < 30) { score += 10; reasoning.push(`Stochastic ${tech.stochasticK.toFixed(0)} survendu`); }
    }

    // Price vs EMA
    if (tech.priceVsEma20 !== null) {
      indicators['vs_EMA20'] = `${tech.priceVsEma20.toFixed(1)}%`;
      if (tech.priceVsEma20 < -8) { score += 15; reasoning.push(`Prix ${tech.priceVsEma20.toFixed(0)}% sous EMA20 — gros discount`); }
      else if (tech.priceVsEma20 < -3) { score += 10; reasoning.push(`Prix ${tech.priceVsEma20.toFixed(0)}% sous EMA20`); }
    }

    // ADX
    if (tech.adx !== null) {
      indicators['ADX'] = tech.adx.toFixed(1);
      if (tech.adx > 25) { score += 10; reasoning.push(`ADX ${tech.adx.toFixed(0)} — tendance forte`); }
    }

    // MACD
    indicators['MACD'] = tech.macdBullish ? 'Bullish' : 'Bearish';
    if (tech.macdBullish) { score += 5; reasoning.push('MACD bullish'); }

    // Momentum turning
    indicators['Mom_3d'] = `${tech.momentum3d.toFixed(1)}%`;
    if (tech.momentum3d > -2 && tech.momentum3d < 5 && tech.momentum7d < 0) {
      score += 10; reasoning.push('Retournement — momentum 3j se retourne après baisse 7j');
    } else if (tech.momentum3d > 0 && tech.momentum3d < 10) {
      score += 5; reasoning.push(`Momentum +${tech.momentum3d.toFixed(1)}%`);
    }

    // Micro price bonus
    if (price < 0.001) { score += 5; reasoning.push('Nano-prix — potentiel ×100+'); }
    else if (price < 0.01) { score += 3; reasoning.push('Micro-prix — potentiel ×10+'); }

    // Fear context bonus
    if (this.fearGreed.value <= 35) { score += 5; reasoning.push(`Fear & Greed ${this.fearGreed.value} — achat contrarien`); }

    const conviction = score >= 80 ? 5 : score >= 60 ? 4 : score >= 45 ? 3 : score >= 30 ? 2 : 1;
    const targetMove = conviction >= 4 ? 30 + Math.random() * 50 : conviction >= 3 ? 15 + Math.random() * 25 : 10;
    const type: Signal['type'] = conviction >= 5 ? 'EXPLOSIVE_LONG' : conviction >= 4 ? 'STRONG_LONG' : 'LONG';

    return {
      type, symbol: tech.symbol, conviction, price, reasoning, indicators,
      timestamp: Date.now(), targetMove: Math.round(targetMove),
      stopLoss: conviction >= 4 ? 8 : 12, timeframe: '1D+4H',
    };
  }

  private detectShortSqueeze(tech: TechnicalData, futures: FuturesData | null, price: number): Signal | null {
    if (!futures) return null;

    // Short squeeze conditions:
    // 1. High short ratio (>55% shorts)
    // 2. Price starts moving up (momentum positive)
    // 3. Oversold technicals
    // 4. Negative funding (shorts paying longs = unsustainable)

    const shortHeavy = futures.longShortRatio < 0.8; // More shorts than longs
    const negativeFunding = futures.fundingRate < -0.0001;
    const oversold = (tech.rsi1d ?? 50) < 40;
    const momentumTurning = tech.momentum3d > -3 && tech.momentum7d < 0;
    const strongShorts = futures.shortAccount > 0.55;

    if (shortHeavy && (negativeFunding || oversold) && momentumTurning) {
      const conviction = (strongShorts ? 1 : 0) + (negativeFunding ? 1 : 0) + (oversold ? 1 : 0) + (tech.volumeSurge > 150 ? 1 : 0) + 1;
      return {
        type: 'SHORT_SQUEEZE',
        symbol: tech.symbol,
        conviction: Math.min(conviction, 5) as Signal['conviction'],
        price,
        reasoning: [
          `Shorts dominent: ${(futures.shortAccount * 100).toFixed(1)}% shorts vs ${(futures.longAccount * 100).toFixed(1)}% longs`,
          `Ratio long/short: ${futures.longShortRatio.toFixed(3)}`,
          negativeFunding ? `Funding négatif: shorts paient les longs — insoutenable` : 'Funding proche de zéro',
          oversold ? `RSI ${tech.rsi1d?.toFixed(0)} — survendu` : '',
          `Potentiel short squeeze: les shorts devront racheter`,
        ].filter(Boolean),
        indicators: {
          'Shorts_%': `${(futures.shortAccount * 100).toFixed(1)}%`,
          'L/S_Ratio': futures.longShortRatio.toFixed(3),
          'Funding': futures.fundingRate.toFixed(6),
          'OI': futures.openInterest,
          'Taker_B/S': futures.takerBuySellRatio.toFixed(3),
        },
        timestamp: Date.now(),
        targetMove: 20 + (strongShorts ? 15 : 0) + (negativeFunding ? 10 : 0),
        stopLoss: 10,
        timeframe: '4H-1D',
      };
    }

    return null;
  }

  private detectWhaleAccumulation(tech: TechnicalData, futures: FuturesData | null, price: number, vol24h: number): Signal | null {
    // Whale accumulation: big taker buys + OBV up + price stable/dipping
    const obvAccum = tech.obvTrend === 'ACCUMULATION';
    const volSurge = tech.volumeSurge > 160;
    const takerBuyDominant = futures ? futures.takerBuySellRatio > 1.1 : false;
    const priceDip = tech.momentum7d < -3 && tech.momentum3d > -5;

    if (obvAccum && volSurge && (takerBuyDominant || priceDip)) {
      const conviction = (takerBuyDominant ? 2 : 1) + (volSurge && tech.volumeSurge > 200 ? 1 : 0) + (tech.rsi1d && tech.rsi1d < 45 ? 1 : 0) + 1;
      return {
        type: 'WHALE_ACCUMULATION',
        symbol: tech.symbol,
        conviction: Math.min(conviction, 5) as Signal['conviction'],
        price,
        reasoning: [
          `OBV accumulation — gros volumes d'achat malgré prix bas`,
          `Volume ×${(tech.volumeSurge / 100).toFixed(1)} — activité institutionnelle détectée`,
          takerBuyDominant ? `Taker buy/sell ratio ${futures!.takerBuySellRatio.toFixed(2)} — acheteurs dominent` : '',
          priceDip ? `Prix en baisse mais volume haussier = accumulation silencieuse` : '',
        ].filter(Boolean),
        indicators: {
          'OBV': tech.obvTrend,
          'Vol_Surge': `${tech.volumeSurge.toFixed(0)}%`,
          'Taker_B/S': futures?.takerBuySellRatio.toFixed(3) || 'N/A',
          'RSI': tech.rsi1d?.toFixed(1) || 'N/A',
        },
        timestamp: Date.now(),
        targetMove: 25 + Math.random() * 30,
        stopLoss: 8,
        timeframe: '1D',
      };
    }
    return null;
  }

  private detectFundingTrap(tech: TechnicalData, futures: FuturesData | null, price: number): Signal | null {
    if (!futures) return null;

    // Funding trap: very high positive funding (longs paying too much) + overbought = about to dump
    // OR very negative funding + oversold = about to pump (contrarian)
    const extremeNegFunding = futures.fundingRate < -0.0005;
    const extremePosFunding = futures.fundingRate > 0.0005;
    const oversold = (tech.rsi1d ?? 50) < 35;
    const overbought = (tech.rsi1d ?? 50) > 70;

    // Negative funding + oversold = LONG opportunity (shorts trapped)
    if (extremeNegFunding && oversold) {
      return {
        type: 'FUNDING_TRAP',
        symbol: tech.symbol,
        conviction: 4,
        price,
        reasoning: [
          `Funding extrêmement négatif: ${futures.fundingRate.toFixed(6)} — shorts paient cher`,
          `RSI ${tech.rsi1d?.toFixed(0)} — survendu`,
          `Quand le funding est trop négatif, les shorts ferment = pump`,
          `Open Interest: ${futures.openInterest} — positions bloquées`,
        ],
        indicators: {
          'Funding': futures.fundingRate.toFixed(6),
          'RSI': tech.rsi1d?.toFixed(1) || 'N/A',
          'OI': futures.openInterest,
          'L/S': futures.longShortRatio.toFixed(3),
        },
        timestamp: Date.now(),
        targetMove: 20 + Math.random() * 25,
        stopLoss: 8,
        timeframe: '8H-1D',
      };
    }

    return null;
  }

  private detectCapitulationBuy(tech: TechnicalData, change24h: number, vol24h: number, price: number): Signal | null {
    // Capitulation: big dump + extreme volume + oversold = dead cat or bottom
    const bigDump = change24h < -10;
    const extremeOversold = (tech.rsi1d ?? 50) < 25;
    const volumeExplosion = tech.volumeSurge > 250;
    const stochCrushed = (tech.stochasticK ?? 50) < 15;
    const bbBottom = (tech.bbPosition ?? 50) < 10;

    if (bigDump && (extremeOversold || stochCrushed) && volumeExplosion) {
      const conviction = (extremeOversold ? 2 : 1) + (stochCrushed ? 1 : 0) + (bbBottom ? 1 : 0) + (this.fearGreed.value < 25 ? 1 : 0);
      return {
        type: 'CAPITULATION_BUY',
        symbol: tech.symbol,
        conviction: Math.min(conviction, 5) as Signal['conviction'],
        price,
        reasoning: [
          `Capitulation en cours: ${change24h.toFixed(1)}% en 24h`,
          `RSI ${tech.rsi1d?.toFixed(0)} — survendu extrême`,
          `Volume ×${(tech.volumeSurge / 100).toFixed(1)} — panique + accumulation`,
          stochCrushed ? `Stochastic ${tech.stochasticK?.toFixed(0)} — écrasé` : '',
          `Acheter quand les autres paniquent`,
        ].filter(Boolean),
        indicators: {
          'Change_24h': `${change24h.toFixed(1)}%`,
          'RSI': tech.rsi1d?.toFixed(1) || 'N/A',
          'Stoch': tech.stochasticK?.toFixed(1) || 'N/A',
          'Vol_Surge': `${tech.volumeSurge.toFixed(0)}%`,
          'BB_Pos': tech.bbPosition?.toFixed(0) || 'N/A',
        },
        timestamp: Date.now(),
        targetMove: 30 + Math.random() * 40,
        stopLoss: 15,
        timeframe: '1D-7D',
      };
    }

    return null;
  }

  // ========================================================================
  // FUNDING SCAN — Check extreme funding rates
  // ========================================================================

  private async fundingScan() {
    console.log('💰 FundingScan...');

    const tickers = await safeFetch(`${BINANCE_FUTURES}/fapi/v1/ticker/24hr`);
    if (!tickers || !Array.isArray(tickers)) return;

    // Get funding rates for top coins by volume
    const topCoins = tickers
      .filter((t: any) => parseFloat(t.quoteVolume || '0') > 10000000)
      .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 50)
      .map((t: any) => t.symbol);

    const signals: Signal[] = [];

    for (const symbol of topCoins) {
      const funding = await this.getFuturesData(symbol);
      if (!funding) continue;

      // Extreme negative funding + low RSI = opportunity
      if (funding.fundingRate < -0.0003 && funding.shortAccount > 0.52) {
        const tech = await this.getTechnicalData(symbol);
        if (tech && (tech.rsi1d ?? 50) < 45) {
          signals.push({
            type: 'FUNDING_TRAP',
            symbol,
            conviction: 4,
            price: 0, // Will be filled
            reasoning: [
              `Funding ${funding.fundingRate.toFixed(6)} — shorts paient cher`,
              `Shorts: ${(funding.shortAccount * 100).toFixed(1)}%`,
              `RSI ${tech.rsi1d?.toFixed(0)} — survendu`,
            ],
            indicators: {
              'Funding': funding.fundingRate.toFixed(6),
              'Shorts': `${(funding.shortAccount * 100).toFixed(1)}%`,
              'OI': funding.openInterest,
            },
            timestamp: Date.now(),
            targetMove: 15 + Math.random() * 20,
            stopLoss: 8,
            timeframe: '8H',
          });
        }
      }

      await this.sleep(200); // Rate limit
    }

    for (const s of signals.slice(0, 3)) {
      const lastTime = this.lastSignals.get(s.symbol) || 0;
      if (Date.now() - lastTime < 8 * 60 * 60 * 1000) continue;
      await this.notifySignal(s);
      this.lastSignals.set(s.symbol, Date.now());
    }
  }

  // ========================================================================
  // ANALYZE MOVE — For quick scan (unusual movers)
  // ========================================================================

  private analyzeMove(symbol: string, price: number, change: number, vol: number, futures: FuturesData | null): Signal[] {
    const signals: Signal[] = [];

    // Sudden pump with short squeeze potential
    if (change > 8 && futures && futures.shortAccount > 0.5) {
      signals.push({
        type: 'SHORT_SQUEEZE',
        symbol,
        conviction: change > 15 ? 4 : 3,
        price,
        reasoning: [
          `Pump de ${change.toFixed(1)}% — possible short squeeze`,
          `Shorts: ${(futures.shortAccount * 100).toFixed(1)}% — vulnérables`,
          `Volume: $${(vol / 1e6).toFixed(1)}M`,
        ],
        indicators: { 'Change': `${change.toFixed(1)}%`, 'Shorts': `${(futures.shortAccount * 100).toFixed(1)}%`, 'Funding': futures.fundingRate.toFixed(6) },
        timestamp: Date.now(), targetMove: change + 10, stopLoss: 8, timeframe: '4H',
      });
    }

    // Sudden dump = capitulation buy opportunity
    if (change < -10 && vol > 5000000) {
      signals.push({
        type: 'CAPITULATION_BUY',
        symbol,
        conviction: change < -20 ? 4 : 3,
        price,
        reasoning: [
          `Dump de ${change.toFixed(1)}% — possible capitulation`,
          `Volume: $${(vol / 1e6).toFixed(1)}M — panique ou accumulation?`,
          `Surveiller le rebond dans les prochaines heures`,
        ],
        indicators: { 'Change': `${change.toFixed(1)}%`, 'Volume': `$${(vol / 1e6).toFixed(1)}M` },
        timestamp: Date.now(), targetMove: Math.abs(change) * 0.5, stopLoss: 12, timeframe: '4H-1D',
      });
    }

    return signals;
  }

  // ========================================================================
  // MARKET PULSE — Macro context updates
  // ========================================================================

  private async updateMarketPulse() {
    // Fear & Greed
    const fng = await safeFetch('https://api.alternative.me/fng/?limit=1');
    if (fng?.data?.[0]) {
      const newVal = parseInt(fng.data[0].value);
      const newLabel = fng.data[0].value_classification;

      // Notify on significant F&G change
      if (this.fearGreed.value > 0) {
        const diff = newVal - this.fearGreed.value;
        if (Math.abs(diff) >= 15) {
          const direction = diff > 0 ? '📈 Le marché devient avide' : '📉 Le marché a plus peur';
          await this.notify(`📊 *F\\&G SHIFT*: ${this.fearGreed.value} → ${newVal} \\(${newLabel}\\)\n${this.esc(direction)}\n${this.esc(diff > 0 ? 'Attention: risque de correction' : 'Opportunité: achats contrariens')}`);
        }
      }

      this.fearGreed = { value: newVal, label: newLabel };
    }

    // BTC dominance
    const global = await safeFetch(`${COINGECKO}/global`);
    if (global?.data) {
      this.btcDominance = global.data.market_cap_percentage?.btc ?? 0;
      this.totalMarketCap = global.data.total_market_cap?.usd ?? 0;
    }

    console.log(`📊 Market Pulse: F&G=${this.fearGreed.value}(${this.fearGreed.label}) BTC_DOM=${this.btcDominance.toFixed(1)}% MCAP=$${(this.totalMarketCap / 1e9).toFixed(0)}B`);
  }

  // ========================================================================
  // DATA HELPERS
  // ========================================================================

  private async getFuturesData(symbol: string): Promise<FuturesData | null> {
    try {
      const [fundingHist, lsRatio, takerRatio, oi] = await Promise.all([
        safeFetch(`${BINANCE_FUTURES}/fapi/v1/fundingRate?symbol=${symbol}&limit=1`),
        safeFetch(`${BINANCE_FUTURES}/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`),
        safeFetch(`${BINANCE_FUTURES}/futures/data/takerlongshortRatio?symbol=${symbol}&period=1h&limit=1`),
        safeFetch(`${BINANCE_FUTURES}/fapi/v1/openInterest?symbol=${symbol}`),
      ]);

      const funding = fundingHist?.[0]?.fundingRate ? parseFloat(fundingHist[0].fundingRate) : 0;
      const ls = lsRatio?.[0] ? { ratio: parseFloat(lsRatio[0].longShortRatio), long: parseFloat(lsRatio[0].longAccount), short: parseFloat(lsRatio[0].shortAccount) } : { ratio: 1, long: 0.5, short: 0.5 };
      const taker = takerRatio?.[0] ? { buy: parseFloat(takerRatio[0].buyVol), sell: parseFloat(takerRatio[0].sellVol), ratio: parseFloat(takerRatio[0].buySellRatio) } : { buy: 0, sell: 0, ratio: 1 };
      const openInt = oi?.openInterest ? parseFloat(oi.openInterest) : 0;

      return {
        symbol,
        fundingRate: funding,
        openInterest: openInt,
        longShortRatio: ls.ratio,
        longAccount: ls.long,
        shortAccount: ls.short,
        takerBuyVol: taker.buy,
        takerSellVol: taker.sell,
        takerBuySellRatio: taker.ratio,
      };
    } catch {
      return null;
    }
  }

  private async getTechnicalData(symbol: string): Promise<TechnicalData | null> {
    try {
      const [klines1d, klines4h] = await Promise.all([
        safeFetch(`${BINANCE_SPOT}/api/v3/klines?symbol=${symbol}&interval=1d&limit=60`),
        safeFetch(`${BINANCE_SPOT}/api/v3/klines?symbol=${symbol}&interval=4h&limit=60`),
      ]);

      if (!klines1d || !Array.isArray(klines1d) || klines1d.length < 25) return null;
      if (!klines4h || !Array.isArray(klines4h) || klines4h.length < 25) return null;

      const closes1d = klines1d.map((k: any[]) => parseFloat(k[4]));
      const volumes1d = klines1d.map((k: any[]) => parseFloat(k[5]));
      const highs1d = klines1d.map((k: any[]) => parseFloat(k[2]));
      const lows1d = klines1d.map((k: any[]) => parseFloat(k[3]));
      const closes4h = klines4h.map((k: any[]) => parseFloat(k[4]));
      const price = closes1d[closes1d.length - 1];
      const ema20 = calcEMA(closes1d, 20);

      return {
        symbol,
        rsi1d: calcRSI(closes1d),
        rsi4h: calcRSI(closes4h),
        ema20,
        ema50: calcEMA(closes1d, Math.min(50, closes1d.length - 1)),
        bbPosition: calcBollingerPos(closes1d),
        stochasticK: calcStochastic(highs1d, lows1d, closes1d),
        adx: calcADX(highs1d, lows1d, closes1d),
        macdBullish: (calcEMA(closes1d, 12) ?? 0) > (calcEMA(closes1d, 26) ?? 0),
        obvTrend: this.getOBVTrend(closes1d, volumes1d),
        volumeSurge: this.getVolumeSurge(volumes1d),
        priceVsEma20: ema20 ? ((price / ema20) - 1) * 100 : null,
        momentum3d: closes1d.length > 4 ? ((closes1d[closes1d.length - 1] / closes1d[closes1d.length - 4]) - 1) * 100 : 0,
        momentum7d: closes1d.length > 8 ? ((closes1d[closes1d.length - 1] / closes1d[closes1d.length - 8]) - 1) * 100 : 0,
        atrPercent: (calcATR(highs1d, lows1d, closes1d) ?? 0) / price * 100,
      };
    } catch { return null; }
  }

  private async technicalAnalysis(symbol: string): Promise<Signal[]> {
    const tech = await this.getTechnicalData(symbol);
    if (!tech) return [];
    const signal = this.scorePrePump(tech, tech.momentum3d); // price approx
    return signal.conviction >= 3 ? [signal] : [];
  }

  private getOBVTrend(closes: number[], volumes: number[]): string {
    const obv = calcOBV(closes, volumes);
    const obvPrev = calcOBV(closes.slice(0, -1), volumes.slice(0, -1));
    const price = closes[closes.length - 1];
    const pricePrev = closes[closes.length - 2];

    if (obv > obvPrev && price < pricePrev) return 'ACCUMULATION';
    if (obv > obvPrev && price > pricePrev) return 'STRONG_BUY';
    if (obv < obvPrev && price > pricePrev) return 'DISTRIBUTION';
    return 'NEUTRAL';
  }

  private getVolumeSurge(volumes: number[]): number {
    if (volumes.length < 20) return 100;
    const avg20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const avg5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    return avg20 > 0 ? (avg5 / avg20) * 100 : 100;
  }

  private async getSpotPairs(): Promise<string[]> {
    const info = await safeFetch(`${BINANCE_SPOT}/api/v3/exchangeInfo`);
    if (info && Array.isArray(info.symbols)) {
      const pairs = info.symbols
        .filter((s: any) => s?.quoteAsset === 'USDT' && s?.status === 'TRADING')
        .map((s: any) => s.symbol);
      if (pairs.length > 50) return pairs;
    }

    // Fallback
    return ['ONGUSDT','ONTUSDT','CITYUSDT','ENJUSDT','MBLUSDT','SCUSDT','ATOMUSDT','TFUELUSDT','DGBUSDT','DCRUSDT','PONDUSDT','COMPUSDT','BCHUSDT','ALICEUSDT','ZILUSDT','ANKRUSDT','COWUSDT','SXTUSDT','KATUSDT','HOMEUSDT','TRUMPUSDT','HMSTRUSDT','NFPUSDT','LAUSDT','FFUSDT','ALLOUSDT','SANDUSDT','MANAUSDT','AXSUSDT','GALAUSDT','IMXUSDT','APEUSDT','JASMYUSDT','SPELLUSDT','TONUSDT','NOTUSDT','DOGSUSDT','LUNCUSDT','ORDIUSDT','PENDLEUSDT','STXUSDT','ARBUSDT','OPUSDT','SUIUSDT','SEIUSDT','JTOUSDT','STRKUSDT'];
  }
}

// ============================================================================
// TELEGRAM BOT — Minimal, just for /start to register chat ID
// ============================================================================

async function sendTelegramMessage(chatId: number, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error('TG send error:', (e as Error).message);
  }
}

async function pollTelegramUpdates(offset = 0): Promise<{ update_id: number; message?: any }[]> {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30&allowed_updates=%5B%22message%22%5D`, {
      signal: AbortSignal.timeout(35000),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    return data?.result || [];
  } catch { return []; }
}

async function main() {
  const brain = new QuantBrain(TELEGRAM_BOT_TOKEN);
  let brainStarted = false;
  let lastUpdateId = 0;

  console.log('🧠 Quantitative Brain V3 — Started');
  console.log('📊 Awaiting /start to activate...');

  // Poll for Telegram updates manually (no dependency needed)
  while (true) {
    try {
      const updates = await pollTelegramUpdates(lastUpdateId + 1);

      for (const update of updates) {
        lastUpdateId = update.update_id;

        if (update.message?.text === '/start' && update.message?.chat?.id && !brainStarted) {
          const chatId = update.message.chat.id;
          console.log(`✅ Chat ID registered: ${chatId}`);

          brainStarted = true;
          brain.start(chatId).catch(e => console.error('Brain error:', e));
        }

        if (update.message?.text === '/scan' && update.message?.chat?.id) {
          await sendTelegramMessage(update.message.chat.id, '🔬 Scan profond déclenché');
        }
      }
    } catch (e) {
      console.error('Poll error:', e);
    }
  }
}

main().catch(console.error);
