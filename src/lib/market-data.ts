// ============================================================================
// 📊 MARKET DATA FETCHER - Real data from Binance + CoinGecko + Alternative.me
// ============================================================================

const BINANCE_BASE = 'https://api.binance.com';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

export interface CoinDetail {
  id: string;
  symbol: string;
  name: string;
  price: number;
  marketCap: number;
  volume24h: number;
  change1h: number;
  change24h: number;
  change7d: number;
  change30d: number;
  ath: number;
  athChangePercent: number;
  atl: number;
  categories: string[];
  sentimentUp: number;
  sentimentDown: number;
}

export interface FearGreed {
  value: number;
  label: string;
  timestamp: number;
}

export interface TrendingCoin {
  id: string;
  symbol: string;
  name: string;
  marketCapRank: number;
  priceBtc: number;
  score: number;
}

export async function getCoinDetail(coingeckoId: string): Promise<CoinDetail | null> {
  try {
    const resp = await fetch(`${COINGECKO_BASE}/coins/${coingeckoId}?localization=false&tickers=false&community_data=true&developer_data=false`);
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const md = data.market_data;
    return {
      id: data.id,
      symbol: data.symbol?.toUpperCase() ?? '',
      name: data.name ?? '',
      price: md?.current_price?.usd ?? 0,
      marketCap: md?.market_cap?.usd ?? 0,
      volume24h: md?.total_volume?.usd ?? 0,
      change1h: md?.price_change_percentage_1h_in_currency?.usd ?? 0,
      change24h: md?.price_change_percentage_24h_in_currency?.usd ?? 0,
      change7d: md?.price_change_percentage_7d_in_currency?.usd ?? 0,
      change30d: md?.price_change_percentage_30d_in_currency?.usd ?? 0,
      ath: md?.ath?.usd ?? 0,
      athChangePercent: md?.ath_change_percentage?.usd ?? 0,
      atl: md?.atl?.usd ?? 0,
      categories: data.categories ?? [],
      sentimentUp: data.sentiment_votes_up_percentage ?? 0,
      sentimentDown: data.sentiment_votes_down_percentage ?? 0,
    };
  } catch {
    return null;
  }
}

export async function getFearGreed(): Promise<FearGreed> {
  try {
    const resp = await fetch('https://api.alternative.me/fng/?limit=1');
    const data = await resp.json() as any;
    return {
      value: parseInt(data.data[0].value),
      label: data.data[0].value_classification,
      timestamp: parseInt(data.data[0].timestamp) * 1000,
    };
  } catch {
    return { value: 50, label: 'Neutral', timestamp: Date.now() };
  }
}

export async function getTrending(): Promise<TrendingCoin[]> {
  try {
    const resp = await fetch(`${COINGECKO_BASE}/search/trending`);
    const data = await resp.json() as any;
    return (data.coins ?? []).slice(0, 10).map((c: any) => ({
      id: c.item.id,
      symbol: c.item.symbol?.toUpperCase(),
      name: c.item.name,
      marketCapRank: c.item.market_cap_rank,
      priceBtc: c.item.price_btc,
      score: c.item.score,
    }));
  } catch {
    return [];
  }
}

export async function getTopGainers(period: '7d' | '30d' = '30d', minMarketCap = 0): Promise<CoinDetail[]> {
  try {
    const resp = await fetch(`${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=1h%2C24h%2C7d%2C30d`);
    const data = await resp.json() as any[];
    const key = period === '30d' ? 'price_change_percentage_30d_in_currency' : 'price_change_percentage_7d_in_currency';

    return data
      .filter((c: any) => (c[key] ?? 0) > 20 && (c.market_cap ?? 0) >= minMarketCap)
      .sort((a: any, b: any) => (b[key] ?? 0) - (a[key] ?? 0))
      .slice(0, 20)
      .map((c: any) => ({
        id: c.id,
        symbol: c.symbol?.toUpperCase() ?? '',
        name: c.name ?? '',
        price: c.current_price ?? 0,
        marketCap: c.market_cap ?? 0,
        volume24h: c.total_volume ?? 0,
        change1h: c.price_change_percentage_1h_in_currency ?? 0,
        change24h: c.price_change_percentage_24h_in_currency ?? 0,
        change7d: c.price_change_percentage_7d_in_currency ?? 0,
        change30d: c.price_change_percentage_30d_in_currency ?? 0,
        ath: 0,
        athChangePercent: 0,
        atl: 0,
        categories: [],
        sentimentUp: 0,
        sentimentDown: 0,
      }));
  } catch {
    return [];
  }
}

// Map Binance symbol to CoinGecko ID (common ones)
const BINANCE_TO_COINGECKO: Record<string, string> = {
  'ONGUSDT': 'ong',
  'ONTUSDT': 'ontology',
  'CITYUSDT': 'manchester-city-fan-token',
  'BARUSDT': 'fc-barcelona-fan-token',
  'ENJUSDT': 'enjincoin',
  'MBLUSDT': 'moviebloc',
  'SCUSDT': 'siacoin',
  'ATOMUSDT': 'cosmos',
  'TFUELUSDT': 'theta-fuel',
  'DGBUSDT': 'digibyte',
  'DCRUSDT': 'decred',
  'PONDUSDT': 'marlin',
  'PORTOUSDT': 'fc-porto-fan-token',
  'COMPUSDT': 'compound-governance-token',
  'BCHUSDT': 'bitcoin-cash',
  'ALICEUSDT': 'my-neighbor-alice',
  'GTCUSDT': 'gitcoin',
  'SFPUSDT': 'safepal',
  'REQUSDT': 'request-network',
  'ZILUSDT': 'zilliqa',
  'ANKRUSDT': 'ankr',
  'COWUSDT': 'cow-protocol',
  'SXTUSDT': 'space-and-time',
  'KATUSDT': 'katana',
  'HOMEUSDT': 'home-3-0',
  'TRUMPUSDT': 'offical-trump',
  'HMSTRUSDT': 'hamster-coin',
};

export function binanceToCoingecko(symbol: string): string | null {
  return BINANCE_TO_COINGECKO[symbol] ?? null;
}
