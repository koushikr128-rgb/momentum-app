// Quick test — does Node's fetch work against Yahoo?
async function test() {
  const url = "https://query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=18mo&interval=1d";
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  console.log("status:", res.status);
  console.log("content-type:", res.headers.get("content-type"));
  const text = await res.text();
  console.log("body length:", text.length);
  console.log("body first 200:", text.slice(0, 200));
}
test().catch(console.error);
