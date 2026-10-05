// Nifty 750 Total Market — stock data from CSV
// Loaded once at module import time. Provides:
//   - Full universe of 750 symbols (vs 276 hardcoded before)
//   - Market cap (₹ Cr) per stock — eliminates slow .info calls
//   - Sector/industry per stock
//   - Latest close price per stock
//
// CSV format (from NSE Nifty Total Market export):
//   Company Name, Industry, Symbol, Market Capital (₹ Cr), Series, ISIN Code, Share, Close Price

import { promises as fs } from "fs";
import path from "path";

export interface Nifty750Stock {
  symbol: string;
  longName: string;
  sector: string;
  industry: string;
  marketCapCr: number;
  closePrice: number;
}

let cachedData: Nifty750Stock[] | null = null;
const CSV_PATH = "/home/z/my-project/data/nifty750.csv";

/**
 * Parse a market cap string like "?42,423.08" → 42423.08
 */
function parseMarketCap(s: string): number {
  const cleaned = s.replace(/[?₹,\s]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * Parse a price string like "?1,050.00" → 1050.00
 */
function parsePrice(s: string): number {
  const cleaned = s.replace(/[?₹,\s]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * Load the Nifty 750 CSV file. Cached after first load.
 * Returns array of {symbol, longName, sector, industry, marketCapCr, closePrice}
 */
export async function loadNifty750(): Promise<Nifty750Stock[]> {
  if (cachedData) return cachedData;

  try {
    const content = await fs.readFile(CSV_PATH, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];

    // Parse header to find column indices
    const header = parseCsvLine(lines[0]);
    const symbolIdx = header.findIndex((h) => h.toUpperCase().includes("SYMBOL"));
    const nameIdx = header.findIndex((h) => h.toUpperCase().includes("COMPANY NAME"));
    const industryIdx = header.findIndex((h) => h.toUpperCase().includes("INDUSTRY"));
    const mcapIdx = header.findIndex((h) => h.toUpperCase().includes("MARKET CAPITAL"));
    const priceIdx = header.findIndex((h) => h.toUpperCase().includes("CLOSE PRICE"));

    if (symbolIdx === -1) {
      console.error("[nifty750] Could not find Symbol column in CSV");
      return [];
    }

    const stocks: Nifty750Stock[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 4) continue;

      const symbol = (cols[symbolIdx] || "").trim();
      if (!symbol) continue;

      stocks.push({
        symbol,
        longName: nameIdx >= 0 ? (cols[nameIdx] || symbol).trim() : symbol,
        sector: industryIdx >= 0 ? (cols[industryIdx] || "—").trim() : "—",
        industry: industryIdx >= 0 ? (cols[industryIdx] || "—").trim() : "—",
        marketCapCr: mcapIdx >= 0 ? parseMarketCap(cols[mcapIdx]) : 0,
        closePrice: priceIdx >= 0 ? parsePrice(cols[priceIdx]) : 0,
      });
    }

    cachedData = stocks;
    console.log(`[nifty750] Loaded ${stocks.length} stocks from CSV`);
    return stocks;
  } catch (e) {
    console.error("[nifty750] Failed to load CSV:", e instanceof Error ? e.message : "unknown");
    return [];
  }
}

/**
 * Parse a CSV line, handling quoted fields with commas inside
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Get the list of 750 symbols for the universe
 */
export async function getNifty750Symbols(): Promise<string[]> {
  const data = await loadNifty750();
  return data.map((s) => s.symbol);
}

/**
 * Build a lookup map: symbol → {marketCapCr, sector, longName, closePrice}
 */
export async function getNifty750Map(): Promise<Map<string, Nifty750Stock>> {
  const data = await loadNifty750();
  const map = new Map<string, Nifty750Stock>();
  for (const s of data) {
    map.set(s.symbol, s);
  }
  return map;
}
