// Test crumb fetch from Node
async function testCrumb() {
  // Step 1: Visit Yahoo homepage to get cookies
  const homeRes = await fetch("https://www.yahoo.com/", {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15" },
    redirect: "follow",
  });
  console.log("Home:", homeRes.status);
  
  // Extract set-cookie header
  const setCookie = homeRes.headers.get("set-cookie") || "";
  console.log("Cookies:", setCookie.slice(0, 200));
  
  // Step 2: Get crumb
  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      Cookie: setCookie,
    },
  });
  const crumb = await crumbRes.text();
  console.log("Crumb status:", crumbRes.status);
  console.log("Crumb:", crumb.slice(0, 100));
  
  if (crumb.startsWith("{")) {
    console.log("FAILED — got JSON error instead of crumb");
    return;
  }
  
  // Step 3: Test batch quote
  const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=RELIANCE.NS,TCS.NS,WELCORP.NS&crumb=${encodeURIComponent(crumb)}`;
  const quoteRes = await fetch(quoteUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      Cookie: setCookie,
    },
  });
  console.log("Quote status:", quoteRes.status);
  const data = await quoteRes.json();
  const quotes = data?.quoteResponse?.result || [];
  console.log("Quotes:", quotes.length);
  for (const q of quotes) {
    console.log(`  ${q.symbol}: mc=${q.marketCap}, name=${q.longName?.slice(0, 30)}`);
  }
}
testCrumb().catch(console.error);
