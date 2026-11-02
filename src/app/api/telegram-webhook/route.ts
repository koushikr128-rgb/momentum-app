// POST /api/telegram-webhook
// Telegram bot webhook handler — responds to stock queries
// User sends "RELIANCE" on Telegram → bot replies with full analysis

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

async function sendTelegramMessage(chatId: string, text: string, botToken: string) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error("[telegram-webhook] Send failed:", e);
  }
}

async function analyzeStock(symbol: string, botToken: string): Promise<string> {
  let data: any = null;

  // 1. Try Render backend
  if (RENDER_URL) {
    try {
      const res = await fetch(`${RENDER_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) data = await res.json();
    } catch {}
  }

  // 2. Try local Python (sandbox)
  if (!data && IS_SANDBOX) {
    try {
      const { stdout: checkOut } = await execAsync(`python3 -c "import yfinance; print('OK')"`, { timeout: 10000 })
        .catch(() => ({ stdout: "", stderr: "failed" }));
      if (!checkOut.includes("OK")) {
        await execAsync(`pip3 install yfinance curl_cffi pandas numpy --quiet`, { timeout: 120000 });
      }
      const scriptPath = path.join(process.cwd(), "scripts", "yfinance_backend.py");
      const { stdout } = await execAsync(`python3 ${scriptPath} analyze ${symbol}`, { timeout: 25000, maxBuffer: 5 * 1024 * 1024 });
      data = JSON.parse(stdout);
    } catch (e: any) {
      return `❌ Could not analyze <b>${symbol}</b>. The stock may not exist or backend is unavailable.`;
    }
  }

  if (!data) return `❌ Could not analyze <b>${symbol}</b> — backend unavailable.`;
  if (data.error) {
    if (data.suggestions && data.suggestions.length > 0) {
      return `❌ <b>${symbol}</b> not found on NSE.\n\nDid you mean:\n${data.suggestions.map((s: any) => `• ${s.symbol} — ${s.name}`).slice(0, 5).join("\n")}`;
    }
    return `❌ ${data.error}`;
  }

  // Format analysis
  const setupEmojis: Record<string, string> = {
    BREAKOUT: "🟢", PULLBACK: "🔵", UPTREND: "⚪", TIGHTENING: "🟡",
    EXTENDED: "🟠", DISTRIBUTION: "🔴",
  };
  const emoji = setupEmojis[data.setupType] || "⚪";

  let msg = `${emoji} <b>${data.symbol}</b>\n`;
  msg += `${data.longName}\n`;
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `💰 Price: ₹${data.currentPrice?.toFixed(2)}\n`;
  msg += `${emoji} Setup: <b>${data.setupType}</b> (${data.setupGrade})\n`;
  msg += `📊 Signal: ${data.signalScore}/100\n`;
  msg += `📈 RSI: ${data.rsi14?.toFixed(1)}\n`;
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `<b>Trade Plan:</b>\n`;
  msg += `Entry: ₹${data.entryPrice?.toFixed(2)}\n`;
  msg += `Stop: ₹${data.stopPrice?.toFixed(2)}\n`;
  msg += `T1: ₹${data.target1?.toFixed(2)}\n`;
  msg += `T2: ₹${data.target2?.toFixed(2)}\n`;
  msg += `R:R = 1:${data.riskReward?.toFixed(1)}\n`;
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `1W: ${data.ret1wPct >= 0 ? "+" : ""}${data.ret1wPct?.toFixed(1)}%\n`;
  msg += `1M: ${data.ret1mPct >= 0 ? "+" : ""}${data.ret1mPct?.toFixed(1)}%\n`;
  msg += `6M: ${data.ret6mPct >= 0 ? "+" : ""}${data.ret6mPct?.toFixed(1)}%\n`;

  const pb = data.pullbackBridge;
  if (pb && !pb.error) {
    msg += `━━━━━━━━━━━━━━━\n`;
    msg += `<b>Pullback Bridge:</b>\n`;
    msg += `Monthly RSI: ${pb.monthly_rsi?.toFixed(1)} ${pb.macro_filter_pass ? "✅" : "⚠️"}\n`;
    msg += `Daily 20EMA: ₹${pb.daily_20ema?.toFixed(2)}\n`;
    const tactics = pb.entry_tactics || [];
    for (const t of tactics) {
      const s = t.status === "READY" ? "🟢" : t.status === "TRIGGERED" ? "🔵" : "🟡";
      msg += `${s} ${t.name}\n   ₹${t.entry?.toFixed(0)} | SL ₹${t.stop?.toFixed(0)} | ${t.risk_pct?.toFixed(1)}%\n`;
    }
    msg += `⚠ 30d SL: ₹${pb.prev_week_low?.toFixed(2)}\n`;
  }

  return msg;
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const update = await req.json();

    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();

      // Get bot token from: query param ?botToken=xxx, header, or env
      const botToken = url.searchParams.get("botToken") || req.headers.get("x-telegram-bot-token") || process.env.TELEGRAM_BOT_TOKEN || "";

      if (!botToken) {
        console.error("[telegram-webhook] No bot token provided");
        return NextResponse.json({ error: "Bot token not configured" }, { status: 500 });
      }

      if (text === "/start" || text === "/help") {
        await sendTelegramMessage(chatId,
          `🤖 <b>Momentum Dashboard Bot</b>\n\nSend any NSE stock symbol to get instant analysis:\n\n<code>RELIANCE</code>\n<code>TCS</code>\n<code>HDFCBANK</code>\n\nYou'll get:\n• Setup type + Signal Score\n• Trade plan (Entry/Stop/Targets)\n• Pullback Bridge tactics\n• Returns (1W/1M/6M)`,
          botToken
        );
        return NextResponse.json({ ok: true });
      }

      let symbol = text.toUpperCase().replace(/\.NS$/g, "").replace(/^\/ANALYZE\s*/g, "").replace(/^\/A\s*/g, "").replace(/\s+/g, "").replace(/[^A-Z0-9\-]/g, "");

      if (!symbol || symbol.length < 1) {
        await sendTelegramMessage(chatId, "Send a stock symbol (e.g., RELIANCE, TCS)", botToken);
        return NextResponse.json({ ok: true });
      }

      await sendTelegramMessage(chatId, `🔍 Analyzing <b>${symbol}</b>...`, botToken);
      const analysis = await analyzeStock(symbol, botToken);
      await sendTelegramMessage(chatId, analysis, botToken);

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[telegram-webhook] Error:", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: "ok", service: "telegram-webhook" });
}
