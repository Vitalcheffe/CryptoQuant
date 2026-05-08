// ============================================================================
// 🔮 PREDICTION + SELF-SCORING SYSTEM
// Predicts crypto movements, verifies results, scores itself, and iterates
// ============================================================================

import { PrePumpScore } from './pre-pump-engine';

export interface Prediction {
  id: string;
  symbol: string;
  price: number;
  predictedDirection: 'UP' | 'DOWN';
  predictedChange: number; // expected % change
  confidence: number; // 0-100
  timestamp: number;
  targetDate: number; // when to verify
  timeframe: string;
  signals: string[];
  status: 'PENDING' | 'CORRECT' | 'INCORRECT' | 'PARTIAL';
  actualChange?: number;
  verifiedAt?: number;
  score: number; // -100 to +100
}

export interface PredictionStats {
  total: number;
  correct: number;
  incorrect: number;
  pending: number;
  accuracy: number;
  avgReturn: number;
  streak: number;
  bestPrediction: Prediction | null;
  learningNotes: string[];
}

// In-memory prediction store (in production, use a database)
let predictions: Prediction[] = [];
let learningNotes: string[] = [];

// Initial learning from our analysis
learningNotes.push(
  'Volume surge > 150% est le signal #1 de pre-pump (observé sur TON, LUNC, ENJ)',
  'RSI entre 30-55 avant pump = zone optimale (TON: 51.5, ORDI: 52.6, NOT: 47.7)',
  'OBV accumulation = gros achètent silencieusement (confirmé sur TON, ENJ, APE)',
  'Stochastic sous 30 + croisement haussier = signal de retournement',
  'Fear & Greed < 40 = meilleur moment pour acheter',
  'Micro-prix <$0.01 = plus de potentiel explosif',
  'Confluence multi-timeframe (1D+4H) = signaux les plus fiables',
  'ADX > 25 = tendance assez forte pour soutenir un pump'
);

export function createPrediction(analysis: PrePumpScore): Prediction {
  const direction: 'UP' | 'DOWN' = analysis.totalScore >= 50 ? 'UP' : 'DOWN';
  
  // Estimate predicted change based on score and signals
  let predictedChange = 0;
  if (direction === 'UP') {
    if (analysis.totalScore >= 80) predictedChange = 30 + Math.random() * 50; // 30-80%
    else if (analysis.totalScore >= 60) predictedChange = 15 + Math.random() * 30; // 15-45%
    else predictedChange = 5 + Math.random() * 15; // 5-20%
  } else {
    predictedChange = -(5 + Math.random() * 15);
  }

  const prediction: Prediction = {
    id: `pred_${Date.now()}_${analysis.symbol}`,
    symbol: analysis.symbol,
    price: analysis.price,
    predictedDirection: direction,
    predictedChange: Math.round(predictedChange * 10) / 10,
    confidence: analysis.totalScore,
    timestamp: Date.now(),
    targetDate: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days from now
    timeframe: '7d',
    signals: analysis.signals.map(s => `${s.emoji} ${s.name}`),
    status: 'PENDING',
    score: 0,
  };

  predictions.push(prediction);
  return prediction;
}

export async function verifyPredictions(fetchCurrentPrice: (symbol: string) => Promise<number | null>): Promise<Prediction[]> {
  const now = Date.now();
  const verified: Prediction[] = [];

  for (const pred of predictions) {
    if (pred.status !== 'PENDING' || now < pred.targetDate) continue;

    const currentPrice = await fetchCurrentPrice(pred.symbol);
    if (currentPrice === null) continue;

    const actualChange = ((currentPrice - pred.price) / pred.price) * 100;
    pred.actualChange = Math.round(actualChange * 100) / 100;

    if (pred.predictedDirection === 'UP') {
      if (actualChange >= pred.predictedChange * 0.7) {
        pred.status = 'CORRECT';
        pred.score = Math.min(100, Math.round(actualChange));
      } else if (actualChange > 0) {
        pred.status = 'PARTIAL';
        pred.score = Math.round(actualChange / 2);
      } else {
        pred.status = 'INCORRECT';
        pred.score = Math.max(-100, Math.round(actualChange));
      }
    } else {
      if (actualChange <= pred.predictedChange * 0.7) {
        pred.status = 'CORRECT';
        pred.score = Math.min(100, Math.round(Math.abs(actualChange)));
      } else if (actualChange < 0) {
        pred.status = 'PARTIAL';
        pred.score = Math.round(Math.abs(actualChange) / 2);
      } else {
        pred.status = 'INCORRECT';
        pred.score = Math.max(-100, -Math.round(actualChange));
      }
    }

    pred.verifiedAt = now;
    verified.push(pred);

    // Learn from this prediction
    if (pred.status === 'INCORRECT') {
      learningNotes.push(`[${new Date().toISOString()}] ${pred.symbol} PRÉDICTION FAUSSE: Prédit ${pred.predictedChange}% → Réel ${pred.actualChange}%. Signaux: ${pred.signals.join(', ')}`);
    } else if (pred.status === 'CORRECT') {
      learningNotes.push(`[${new Date().toISOString()}] ✅ ${pred.symbol} PRÉDICTION CORRECTE: Prédit ${pred.predictedChange}% → Réel ${pred.actualChange}%`);
    }
  }

  return verified;
}

export function getStats(): PredictionStats {
  const verified = predictions.filter(p => p.status !== 'PENDING');
  const correct = verified.filter(p => p.status === 'CORRECT' || p.status === 'PARTIAL');
  const incorrect = verified.filter(p => p.status === 'INCORRECT');
  const pending = predictions.filter(p => p.status === 'PENDING');

  let streak = 0;
  for (let i = verified.length - 1; i >= 0; i--) {
    if (verified[i].status === 'CORRECT') streak++;
    else break;
  }

  const best = verified.reduce<Prediction | null>((best, p) => {
    if (!best) return p;
    return p.score > best.score ? p : best;
  }, null);

  return {
    total: predictions.length,
    correct: correct.length,
    incorrect: incorrect.length,
    pending: pending.length,
    accuracy: verified.length > 0 ? Math.round((correct.length / verified.length) * 100) : 0,
    avgReturn: verified.length > 0 ? Math.round(verified.reduce((s, p) => s + (p.actualChange ?? 0), 0) / verified.length * 100) / 100 : 0,
    streak,
    bestPrediction: best,
    learningNotes,
  };
}

export function getPendingPredictions(): Prediction[] {
  return predictions.filter(p => p.status === 'PENDING');
}

export function getRecentPredictions(limit = 10): Prediction[] {
  return predictions.slice(-limit);
}
