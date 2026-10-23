// POST /api/publish-screen
// Saves the current screen results to data/latest_screen.json and pushes to GitHub.
// Vercel reads this file at runtime for instant screen display.

import { NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const screenData = await req.json();

    if (!screenData || !screenData.top10 || screenData.top10.length === 0) {
      return NextResponse.json({ error: "No screen data to publish" }, { status: 400 });
    }

    // Save to data/latest_screen.json
    const filePath = path.join(process.cwd(), "data", "latest_screen.json");
    const dataToSave = {
      ...screenData,
      publishedAt: new Date().toISOString(),
      publishedFrom: "sandbox",
    };
    await writeFile(filePath, JSON.stringify(dataToSave, null, 2));

    // Git commit + push to GitHub
    // This triggers Vercel auto-deploy with the new data
    try {
      await execAsync('git add data/latest_screen.json', { cwd: process.cwd() });
      await execAsync(`git commit -m "Publish screen results — ${screenData.top10.length} stocks — ${new Date().toISOString()}"`, {
        cwd: process.cwd(),
        env: { ...process.env, GIT_AUTHOR_NAME: "koushikr128-rgb", GIT_AUTHOR_EMAIL: "koushikr128-rgb@users.noreply.github.com", GIT_COMMITTER_NAME: "koushikr128-rgb", GIT_COMMITTER_EMAIL: "koushikr128-rgb@users.noreply.github.com" },
      });
      await execAsync('git push origin main', { cwd: process.cwd(), timeout: 30000 });
    } catch (e: any) {
      // If git push fails, the file is still saved locally — Vercel can read it on next deploy
      console.error("[publish] Git push failed:", e.message);
      return NextResponse.json({
        success: true,
        warning: "Saved locally but git push failed. Vercel will pick it up on next manual deploy.",
        stocks: screenData.top10.length,
      });
    }

    return NextResponse.json({
      success: true,
      stocks: screenData.top10.length,
      publishedAt: dataToSave.publishedAt,
      message: "Pushed to GitHub. Vercel will auto-deploy in ~2 min.",
    });
  } catch (e: any) {
    console.error("[publish] Error:", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
