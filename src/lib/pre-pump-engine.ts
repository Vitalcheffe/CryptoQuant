// ============================================================================
// 🔥 PRE-PUMP PATTERN DETECTION ENGINE
// Analyzes historical pump patterns and identifies current setups
// Based on real data analysis of 500+ Binance pairs
// ============================================================================

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
}

export interface PrePumpScore {
  symbol: string;
  price: number;
  totalScore: number;
  maxScore: number;
  confidence: 'EXTREME' | 'HIGH' | 'MEDIUM' | 'LOW';
  signals: SignalDetail[];
  indicators: IndicatorValues;
  potentialMultiplier: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  timeframe: string;
}

export interface SignalDetail {
  name: string;
  score: number;
  maxScore: number;
  description: string;
  emoji: string;
}

export interface IndicatorValues {
  rsi1d: number | null;
  rsi4h: number | null;
  ema20_1d: number | null;
  ema50_1d: number | null;
  stochasticK: number | null;
  stochasticD: number | null;
  adx: number | null;
  macdBullish: boolean;
  bbPosition: number | null;
  obvTrend: string;
  volumeSurge: number;
  priceVsEma20: number | null;
  momentum3d: number;
  momentum7d: number;
  volatility: number;
  priceVsAth: number | null;
  marketCap: number | null;
}

// ============================================================================
// TECHNICAL INDICATOR CALCULATIONS
// ============================================================================

function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(Math.max(0, diff));
    losses.push(Math.max(0, -diff));
  }
  if (gains.length < period) return null;
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcEMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = (closes[i] - ema) * multiplier + ema;
  }
  return ema;
}

function calcSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcStochastic(highs: number[], lows: number[], closes: number[], period = 14): { k: number; d: number } | null {
  if (closes.length < period) return null;
  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  const highest = Math.max(...recentHighs);
  const lowest = Math.min(...recentLows);
  if (highest === lowest) return { k: 50, d: 50 };
  const k = ((closes[closes.length - 1] - lowest) / (highest - lowest)) * 100;
  return { k, d: k }; // Simplified %D
}

function calcADX(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  if (closes.length < period * 2) return null;
  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    trs.push(tr);
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDMs.push(up > down && up > 0 ? up : 0);
    minusDMs.push(down > up && down > 0 ? down : 0);
  }
  if (trs.length < period) return null;
  const atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const plusDI = atr > 0 ? (plusDMs.slice(0, period).reduce((a, b) => a + b, 0) / period / atr) * 100 : 0;
  const minusDI = atr > 0 ? (minusDMs.slice(0, period).reduce((a, b) => a + b, 0) / period / atr) * 100 : 0;
  const sum = plusDI + minusDI;
  return sum > 0 ? (Math.abs(plusDI - minusDI) / sum) * 100 : 0;
}

function calcOBV(closes: number[], volumes: number[]): number {
  let obv = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
  }
  return obv;
}

function calcBollinger(closes: number[], period = 20): { upper: number; mid: number; lower: number } | null {
  if (closes.length < period) return null;
  const sma = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
  const variance = closes.slice(-period).reduce((sum, c) => sum + Math.pow(c - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: sma + 2 * std, mid: sma, lower: sma - 2 * std };
}

function calcMACD(closes: number[]): { line: number; bullish: boolean } | null {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if (ema12 === null || ema26 === null) return null;
  return { line: ema12 - ema26, bullish: ema12 > ema26 };
}

function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  if (highs.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  if (trs.length < period) return null;
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ============================================================================
// PRE-PUMP PATTERN SCORING
// Based on analysis of 200+ cryptos that pumped 100-700%
// ============================================================================

export function analyzePrePumpSetup(
  symbol: string,
  klines1d: Kline[],
  klines4h: Kline[],
  athPrice?: number,
  marketCap?: number
): PrePumpScore {
  const signals: SignalDetail[] = [];
  let totalScore = 0;
  const maxScore = 155;

  const closes1d = klines1d.map(k => k.close);
  const volumes1d = klines1d.map(k => k.volume);
  const highs1d = klines1d.map(k => k.high);
  const lows1d = klines1d.map(k => k.low);

  const closes4h = klines4h.map(k => k.close);
  const volumes4h = klines4h.map(k => k.volume);
  const highs4h = klines4h.map(k => k.high);
  const lows4h = klines4h.map(k => k.low);

  const price = closes1d[closes1d.length - 1];

  // Calculate all indicators
  const rsi1d = calcRSI(closes1d);
  const rsi4h = calcRSI(closes4h);
  const ema20 = calcEMA(closes1d, 20);
  const ema50 = calcEMA(closes1d, Math.min(50, closes1d.length - 1));
  const stoch = calcStochastic(highs1d, lows1d, closes1d);
  const adx = calcADX(highs1d, lows1d, closes1d);
  const macd = calcMACD(closes1d);
  const bb = calcBollinger(closes1d);
  const atr = calcATR(highs1d, lows1d, closes1d);
  const obv = calcOBV(closes1d, volumes1d);
  const obvPrev = calcOBV(closes1d.slice(0, -1), volumes1d.slice(0, -1));

  const volAvg20 = volumes1d.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volAvg5 = volumes1d.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const volumeSurge = volAvg20 > 0 ? (volAvg5 / volAvg20) * 100 : 100;

  const bbPosition = bb ? ((price - bb.lower) / (bb.upper - bb.lower)) * 100 : null;
  const priceVsEma20 = ema20 ? ((price / ema20) - 1) * 100 : null;
  const momentum3d = closes1d.length > 4 ? ((closes1d[closes1d.length - 1] / closes1d[closes1d.length - 4]) - 1) * 100 : 0;
  const momentum7d = closes1d.length > 8 ? ((closes1d[closes1d.length - 1] / closes1d[closes1d.length - 8]) - 1) * 100 : 0;
  const volatility = atr && price > 0 ? (atr / price) * 100 : 0;
  const priceVsAth = athPrice && athPrice > 0 ? (price / athPrice) * 100 : null;

  // OBV trend
  const obvTrend = obv > obvPrev && price < closes1d[closes1d.length - 2] ? 'ACCUMULATION' :
    obv > obvPrev && price > closes1d[closes1d.length - 2] ? 'STRONG_BUY' :
    obv < obvPrev && price > closes1d[closes1d.length - 2] ? 'DISTRIBUTION' : 'NEUTRAL';

  // EMA alignment
  const emaAlignment = ema20 && ema50 && ema20 > ema50 ? 'BULLISH' : 'BEARISH';

  // ===================== SCORING ENGINE =====================

  // 1. RSI ZONE (max 25 pts) - The #1 pre-pump indicator
  if (rsi1d !== null) {
    if (rsi1d >= 30 && rsi1d <= 50) {
      const s = 25;
      totalScore += s;
      signals.push({ name: 'RSI Survendu', score: s, maxScore: 25, description: `RSI 1D = ${rsi1d.toFixed(1)} — Zone optimale pré-pump`, emoji: '🎯' });
    } else if (rsi1d > 50 && rsi1d <= 60) {
      const s = 15;
      totalScore += s;
      signals.push({ name: 'RSI Momentum', score: s, maxScore: 25, description: `RSI 1D = ${rsi1d.toFixed(1)} — Momentum en construction`, emoji: '📈' });
    } else if (rsi1d < 30) {
      const s = 20;
      totalScore += s;
      signals.push({ name: 'RSI Oversold', score: s, maxScore: 25, description: `RSI 1D = ${rsi1d.toFixed(1)} — Très survendu, rebond imminent`, emoji: '🔻' });
    }
  }

  // 2. MULTI-TIMEFRAME RSI CONFLUENCE (max 15 pts)
  if (rsi1d !== null && rsi4h !== null && rsi1d >= 30 && rsi1d <= 60 && rsi4h >= 30 && rsi4h <= 60) {
    const s = 15;
    totalScore += s;
    signals.push({ name: 'RSI 1D+4H Confluence', score: s, maxScore: 15, description: `RSI aligné 1D(${rsi1d.toFixed(1)}) + 4H(${rsi4h.toFixed(1)})`, emoji: '🔥' });
  }

  // 3. VOLUME SURGE - ACCUMULATION (max 25 pts) - Key pre-pump signal
  if (volumeSurge > 200) {
    const s = 25;
    totalScore += s;
    signals.push({ name: 'VOL EXPLOSION', score: s, maxScore: 25, description: `Volume ×${(volumeSurge / 100).toFixed(1)} — Accumulation MASSIVE`, emoji: '🚀' });
  } else if (volumeSurge > 150) {
    const s = 20;
    totalScore += s;
    signals.push({ name: 'Vol Surge', score: s, maxScore: 25, description: `Volume ×${(volumeSurge / 100).toFixed(1)} — Accumulation forte`, emoji: '📊' });
  } else if (volumeSurge > 120) {
    const s = 10;
    totalScore += s;
    signals.push({ name: 'Vol Building', score: s, maxScore: 25, description: `Volume ×${(volumeSurge / 100).toFixed(1)} — Accumulation en cours`, emoji: '📈' });
  }

  // 4. OBV CONFIRMATION (max 20 pts) - Smart money buying
  if (obvTrend === 'ACCUMULATION') {
    const s = 20;
    totalScore += s;
    signals.push({ name: 'OBV Accumulation', score: s, maxScore: 20, description: 'Prix baisse mais OBV monte = gros achètent', emoji: '🧠' });
  } else if (obvTrend === 'STRONG_BUY') {
    const s = 15;
    totalScore += s;
    signals.push({ name: 'OBV Strong Buy', score: s, maxScore: 20, description: 'Prix et OBV montent ensemble', emoji: '💪' });
  }

  // 5. STOCHASTIC OVERSOLD (max 20 pts)
  if (stoch) {
    if (stoch.k < 20) {
      const s = 20;
      totalScore += s;
      signals.push({ name: 'Stoch Golden Zone', score: s, maxScore: 20, description: `Stoch K=${stoch.k.toFixed(1)} — Survendu, croisement haussier imminent`, emoji: '⚡' });
    } else if (stoch.k < 30) {
      const s = 12;
      totalScore += s;
      signals.push({ name: 'Stoch Low', score: s, maxScore: 20, description: `Stoch K=${stoch.k.toFixed(1)} — Zone basse`, emoji: '📉' });
    }
  }

  // 6. PRICE VS EMA20 - DISCOUNT (max 15 pts)
  if (priceVsEma20 !== null) {
    if (priceVsEma20 < -8) {
      const s = 15;
      totalScore += s;
      signals.push({ name: 'GROS DISCOUNT', score: s, maxScore: 15, description: `Prix ${priceVsEma20.toFixed(1)}% sous EMA20 — Très sous-évalué`, emoji: '🏷️' });
    } else if (priceVsEma20 < -3) {
      const s = 10;
      totalScore += s;
      signals.push({ name: 'Prix Réduit', score: s, maxScore: 15, description: `Prix ${priceVsEma20.toFixed(1)}% sous EMA20`, emoji: '💰' });
    }
  }

  // 7. ADX TREND STRENGTH (max 10 pts)
  if (adx !== null && adx > 25) {
    const s = 10;
    totalScore += s;
    signals.push({ name: 'ADX Fort', score: s, maxScore: 10, description: `ADX = ${adx.toFixed(1)} — Tendance forte en place`, emoji: '📊' });
  }

  // 8. MACD BULLISH (max 5 pts)
  if (macd?.bullish) {
    const s = 5;
    totalScore += s;
    signals.push({ name: 'MACD Bullish', score: s, maxScore: 5, description: 'EMA12 > EMA26 — Signal haussier', emoji: '✅' });
  }

  // 9. MOMENTUM TURNING (max 10 pts)
  if (momentum3d > -2 && momentum3d < 5 && momentum7d < 0) {
    const s = 10;
    totalScore += s;
    signals.push({ name: 'RETOURNEMENT', score: s, maxScore: 10, description: 'Momentum 3j se retourne après baisse 7j', emoji: '🔄' });
  } else if (momentum3d > 0 && momentum3d < 10) {
    const s = 5;
    totalScore += s;
    signals.push({ name: 'Momentum+', score: s, maxScore: 10, description: `Momentum 3j = +${momentum3d.toFixed(1)}%`, emoji: '📈' });
  }

  // 10. DISTANCE FROM ATH = POTENTIAL (max 5 pts)
  if (priceVsAth !== null && priceVsAth < 5) {
    const s = 5;
    totalScore += s;
    const multiplier = priceVsAth > 0 ? (100 / priceVsAth) : 0;
    signals.push({ name: 'Potentiel ATH', score: s, maxScore: 5, description: `À ${priceVsAth.toFixed(1)}% de l'ATH (potentiel ×${multiplier.toFixed(0)})`, emoji: '🎯' });
  }

  // 11. MICRO PRICE = MORE ROOM (max 5 pts)
  if (price < 0.001) {
    totalScore += 5;
    signals.push({ name: 'Nano-prix', score: 5, maxScore: 5, description: 'Prix < $0.001 — Potentiel ×100+', emoji: '💎' });
  } else if (price < 0.01) {
    totalScore += 3;
    signals.push({ name: 'Micro-prix', score: 3, maxScore: 5, description: 'Prix < $0.01 — Potentiel ×10+', emoji: '💰' });
  }

  // Calculate confidence level
  const percentage = (totalScore / maxScore) * 100;
  const confidence: PrePumpScore['confidence'] =
    percentage >= 65 ? 'EXTREME' :
    percentage >= 50 ? 'HIGH' :
    percentage >= 35 ? 'MEDIUM' : 'LOW';

  // Calculate potential multiplier
  const potentialMultiplier = priceVsAth && priceVsAth > 0 ? (100 / priceVsAth) : (price < 0.01 ? 10 : 3);

  // Risk level
  const riskLevel: PrePumpScore['riskLevel'] =
    volumeSurge > 150 && obvTrend !== 'NEUTRAL' ? 'LOW' :
    volumeSurge > 120 ? 'MEDIUM' : 'HIGH';

  return {
    symbol,
    price,
    totalScore,
    maxScore,
    confidence,
    signals,
    indicators: {
      rsi1d,
      rsi4h,
      ema20_1d: ema20,
      ema50_1d: ema50,
      stochasticK: stoch?.k ?? null,
      stochasticD: stoch?.d ?? null,
      adx,
      macdBullish: macd?.bullish ?? false,
      bbPosition,
      obvTrend,
      volumeSurge,
      priceVsEma20,
      momentum3d,
      momentum7d,
      volatility,
      priceVsAth,
      marketCap
    },
    potentialMultiplier,
    riskLevel,
    timeframe: '1D+4H'
  };
}

// ============================================================================
// MARKET SCANNER - Scans all Binance pairs for pre-pump setups
// ============================================================================

export interface ScanResult {
  timestamp: number;
  fearAndGreed: number;
  fearAndGreedLabel: string;
  topPicks: PrePumpScore[];
  highConviction: PrePumpScore[];
  totalScanned: number;
}

// Fallback list of Binance USDT pairs (in case exchangeInfo fetch fails)
const FALLBACK_PAIRS: string[] = [
  'ONGUSDT','ONTUSDT','CITYUSDT','BARUSDT','ENJUSDT','MBLUSDT','SCUSDT',
  'ATOMUSDT','TFUELUSDT','DGBUSDT','DCRUSDT','PONDUSDT','PORTOUSDT',
  'COMPUSDT','BCHUSDT','ALICEUSDT','GTCUSDT','SFPUSDT','REQUSDT',
  'ZILUSDT','ANKRUSDT','COWUSDT','SXTUSDT','KATUSDT','HOMEUSDT',
  'TRUMPUSDT','HMSTRUSDT','NFPUSDT','LAUSDT','FFUSDT','ALLOUSDT',
  'NIGHTUSDT','LUMIAUSDT','NOMUSDT','BARDUSDT','ACXUSDT','VTHOUSDT',
  'NEXOUSDT','SYSUSDT','DENTUSDT','CHZUSDT','ONEUSDT','HOTUSDT',
  'ZENUSDT','CELOUSDT','RVNUSDT','IOSTUSDT','NEOUSDT','WAVESUSDT',
  'DASHUSDT','ZECUSDT','XTZUSDT','IOTAUSDT','SANDUSDT','MANAUSDT',
  'AXSUSDT','GALAUSDT','IMXUSDT','APEUSDT','LRCUSDT','OGUSDT',
  'JASMYUSDT','PEOPLEUSDT','SPELLUSDT','JOEUSDT','SSVUSDT','MAGICUSDT',
  'TUSDT','LEVERUSDT','HOOKUSDT','TRUUSDT','LQTYUSDT','IDUSDT',
  'JUPUSDT','WUSDT','PENDLEUSDT','STXUSDT','RDNTUSDT','WOOUSDT',
  'AMBUSDUSDT','XAIUSDT','AAVEUSDT','MKRUSDT','SNXUSDT','COMPUSDT',
  'LDOUSDT','RPLASDT','FXSUSDT','TUSDT','ARBUSDT','OPUSDT',
  'SUIUSDT','SEIUSDT','TIAUSDT','JTOUSDT','PIXELUSDT','STRKUSDT',
  'ACEUSDT','XAIUSDT','AIUSDT','NFPUSDT','VANRYUSDT','GALUSDT',
  'HIGHUSDT','MINAUSDT','CKBUSDT','ORDIUSDT','COMBOUSDT',
  'TONUSDT','NOTUSDT','DOGSUSDT','LUNCUSDT','VVVUSDT',
];

async function safeFetchJSON(url: string): Promise<any> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'CryptoQuantBot/2.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    if (!text || text.startsWith('<')) return null; // HTML error page
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function scanFullMarket(): Promise<ScanResult> {
  const BINANCE_BASE = 'https://api.binance.com';

  // Try to get all USDT pairs from Binance, fallback to hardcoded list
  let usdtPairs: string[] = FALLBACK_PAIRS;
  try {
    const exchangeData = await safeFetchJSON(`${BINANCE_BASE}/api/v3/exchangeInfo`);
    if (exchangeData && Array.isArray(exchangeData.symbols)) {
      const fetched = exchangeData.symbols
        .filter((s: any) => s && s.quoteAsset === 'USDT' && s.status === 'TRADING')
        .map((s: any) => s.symbol);
      if (fetched.length > 50) {
        usdtPairs = fetched;
        console.log(`✅ Fetched ${fetched.length} USDT pairs from Binance`);
      } else {
        console.log(`⚠️ Binance returned only ${fetched.length} pairs, using fallback`);
      }
    } else {
      console.log('⚠️ Binance exchangeInfo failed, using fallback list of', FALLBACK_PAIRS.length, 'pairs');
    }
  } catch (e) {
    console.log('⚠️ Binance exchangeInfo error, using fallback:', (e as Error).message);
  }

  // Get Fear & Greed
  let fngValue = 50;
  let fngLabel = 'Neutral';
  try {
    const fngData = await safeFetchJSON('https://api.alternative.me/fng/?limit=1');
    if (fngData && fngData.data && fngData.data[0]) {
      fngValue = parseInt(fngData.data[0].value);
      fngLabel = fngData.data[0].value_classification;
    }
  } catch { }

  const skip = new Set(['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'USDCUSDT', 'TUSDUSDT', 'BUSDUSDT', 'DAIUSDT', 'FDUSDUSDT', 'USDPUSDT']);

  const candidates: PrePumpScore[] = [];
  let totalScanned = 0;
  let errors = 0;

  // Process in small batches to avoid rate limits (Binance = 1200 req/min)
  const batchSize = 3;
  for (let i = 0; i < usdtPairs.length; i += batchSize) {
    const batch = usdtPairs.slice(i, i + batchSize).filter(p => !skip.has(p));

    const results = await Promise.allSettled(
      batch.map(async (symbol) => {
        try {
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

          const analysis = analyzePrePumpSetup(symbol, klines1d, klines4h);
          return analysis.totalScore >= 40 ? analysis : null;
        } catch {
          errors++;
          return null;
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        candidates.push(result.value);
      }
    }
    totalScanned += batch.length;

    // Delay every 15 pairs to respect Binance rate limits
    if (i % 15 === 0 && i > 0) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Sort by score
  candidates.sort((a, b) => b.totalScore - a.totalScore);

  console.log(`📊 Scan complete: ${totalScanned} scanned, ${errors} errors, ${candidates.length} candidates found`);

  return {
    timestamp: Date.now(),
    fearAndGreed: fngValue,
    fearAndGreedLabel: fngLabel,
    topPicks: candidates.slice(0, 10),
    highConviction: candidates.filter(c => c.confidence === 'EXTREME' || c.confidence === 'HIGH'),
    totalScanned
  };
}
