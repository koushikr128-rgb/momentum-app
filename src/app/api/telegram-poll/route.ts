// GET /api/telegram-poll?botToken=xxx
// Polls Telegram for new messages and responds with stock analysis.

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const IS_SANDBOX = !process.env.RENDER_URL && process.env.VERCEL !== "1";
const RENDER_URL = process.env.RENDER_URL || "";
let updateOffset = 0;

async function sendMsg(chatId: string, text: string, botToken: string) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch {}
}

async function analyzeStock(symbol: string): Promise<string> {
  let data: any = null;
  if (RENDER_URL) {
    try {
      const res = await fetch(`${RENDER_URL}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol }), signal: AbortSignal.timeout(20000) });
      if (res.ok) data = await res.json();
    } catch {}
  }
  if (!data && IS_SANDBOX) {
    try {
      const { stdout: c } = await execAsync(`python3 -c "import yfinance; print('OK')"`, { timeout: 10000 }).catch(() => ({ stdout: "", stderr: "" }));
      if (!c.includes("OK")) await execAsync(`pip3 install yfinance curl_cffi pandas numpy --quiet`, { timeout: 120000 });
      const sp = path.join(process.cwd(), "scripts", "yfinance_backend.py");
      const { stdout } = await execAsync(`python3 ${sp} analyze ${symbol}`, { timeout: 25000, maxBuffer: 5 * 1024 * 1024 });
      data = JSON.parse(stdout);
    } catch { return `❌ Could not analyze <b>${symbol}</b>. Try again in 30s.`; }
  }
  if (!data) return `❌ Backend unavailable.`;
  if (data.error) { return data.suggestions?.length ? `❌ <b>${symbol}</b> not found.\n\nDid you mean:\n${data.suggestions.slice(0,5).map((s:any)=>`• ${s.symbol}`).join("\n")}` : `❌ ${data.error}`; }
  const em: Record<string,string> = { BREAKOUT:"🟢",PULLBACK:"🔵",UPTREND:"⚪",TIGHTENING:"🟡",EXTENDED:"🟠",DISTRIBUTION:"🔴" };
  const e = em[data.setupType]||"⚪";
  let m = `${e} <b>${data.symbol}</b>\n${data.longName}\n━━━━━━━━━━━━━━━\n💰 ₹${data.currentPrice?.toFixed(2)}\n${e} <b>${data.setupType}</b> (${data.setupGrade}) | Signal: ${data.signalScore}/100\n📈 RSI: ${data.rsi14?.toFixed(1)}\n━━━━━━━━━━━━━━━\n<b>Trade Plan:</b>\nEntry: ₹${data.entryPrice?.toFixed(0)} | Stop: ₹${data.stopPrice?.toFixed(0)}\nT1: ₹${data.target1?.toFixed(0)} | T2: ₹${data.target2?.toFixed(0)}\nR:R = 1:${data.riskReward?.toFixed(1)}\n━━━━━━━━━━━━━━━\n1W: ${data.ret1wPct>=0?"+":""}${data.ret1wPct?.toFixed(1)}% | 1M: ${data.ret1mPct>=0?"+":""}${data.ret1mPct?.toFixed(1)}% | 6M: ${data.ret6mPct>=0?"+":""}${data.ret6mPct?.toFixed(1)}%\n`;
  const pb = data.pullbackBridge;
  if (pb && !pb.error) { m += `━━━━━━━━━━━━━━━\n<b>Bridge:</b> M-RSI ${pb.monthly_rsi?.toFixed(1)} ${pb.macro_filter_pass?"✅":"⚠️"}\n`; for (const t of (pb.entry_tactics||[])) { const s=t.status==="READY"?"🟢":t.status==="TRIGGERED"?"🔵":"🟡"; m += `${s} ${t.name}: ₹${t.entry?.toFixed(0)} SL₹${t.stop?.toFixed(0)} (${t.risk_pct?.toFixed(1)}%)\n`; } m += `⚠ 30d SL: ₹${pb.prev_week_low?.toFixed(0)}\n`; }
  return m;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const botToken = url.searchParams.get("botToken") || "";
  if (!botToken) return NextResponse.json({ error: "botToken required" }, { status: 400 });
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?offset=${updateOffset}&timeout=0&limit=10`, { cache: "no-store" });
    if (!r.ok) return NextResponse.json({ error: "Telegram API error", processed: 0 });
    const d = await r.json(); const updates = d.result || []; let processed = 0;
    for (const u of updates) {
      updateOffset = u.update_id + 1;
      if (!u.message?.text) continue;
      const cid = u.message.chat.id; const text = u.message.text.trim();
      if (text === "/start" || text === "/help") { await sendMsg(cid, `🤖 <b>Momentum Bot</b>\n\nSend a stock symbol:\n<code>RELIANCE</code>\n<code>TCS</code>\n\nGet: Setup, Signal, Trade Plan, Bridge, Returns`, botToken); processed++; continue; }
      let sym = text.toUpperCase().replace(/\.NS$/g,"").replace(/^\/ANALYZE\s*/g,"").replace(/^\/A\s*/g,"").replace(/\s+/g,"").replace(/[^A-Z0-9\-]/g,"");
      if (!sym || sym.length < 1) continue;
      await sendMsg(cid, `🔍 Analyzing <b>${sym}</b>...`, botToken);
      const a = await analyzeStock(sym); await sendMsg(cid, a, botToken); processed++;
    }
    return NextResponse.json({ ok: true, processed, offset: updateOffset });
  } catch (e: any) { return NextResponse.json({ error: e.message, processed: 0 }, { status: 500 }); }
}
