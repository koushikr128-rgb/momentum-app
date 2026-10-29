// POST /api/telegram-alert
// Sends a message to a Telegram chat via a bot.
// Body: { botToken: "xxx", chatId: "xxx", message: "text" }

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(req: Request) {
  try {
    const { botToken, chatId, message } = await req.json();

    if (!botToken || !chatId || !message) {
      return NextResponse.json({ error: "botToken, chatId, and message are required" }, { status: 400 });
    }

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Telegram API error: ${err.slice(0, 200)}` }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
