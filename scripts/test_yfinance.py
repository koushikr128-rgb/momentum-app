"""Quick test that yfinance can fetch NSE stocks."""
import yfinance as yf

# Test with 3 well-known NSE stocks
tickers = ['RELIANCE.NS', 'TCS.NS', 'INFY.NS']
data = yf.download(tickers, period='1y', progress=False, threads=True)
print("Shape:", data.shape)
print("Columns:", data.columns.tolist()[:6])
print(data.tail(2))

# Test info/market cap
print("\n--- Testing fast_info ---")
for sym in ['RELIANCE.NS', 'TCS.NS']:
    t = yf.Ticker(sym)
    fi = t.fast_info
    print(f"{sym}: market_cap={fi.get('market_cap')}, last_price={fi.get('last_price')}")

print("\n--- Testing .info (sector) ---")
t = yf.Ticker('RELIANCE.NS')
info = t.info
print(f"sector={info.get('sector')}, industry={info.get('industry')}, marketCap={info.get('marketCap')}")
