"""
Flask wrapper for the yfinance backend — runs as a persistent HTTP service
alongside Next.js on the VPS. Next.js API routes call this via HTTP instead
of exec(), which is faster and more reliable.

Endpoints:
  GET  /health          → "ok"
  POST /screen          → momentum screen (body: {topN, rsiMin, mcapMin, volMin})
  POST /bridge-screen   → pullback bridge screen (body: {topN, rsiMin, mcapMin, volMin})
  POST /analyze         → single stock analysis (body: {symbol})
  GET  /nifty           → NIFTY 50 + breadth data for regime detector

Run:
  gunicorn -w 2 -b 127.0.0.1:5001 render_server:app
"""

import sys
import os
import json
import subprocess
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_SCRIPT = os.path.join(SCRIPT_DIR, "yfinance_backend.py")


def _run_python(cmd: str, args: list = None) -> dict:
    """Run yfinance_backend.py with given command + args, return parsed JSON."""
    full_cmd = ["python3", BACKEND_SCRIPT, cmd]
    if args:
        full_cmd.extend(args)
    try:
        result = subprocess.run(
            full_cmd,
            capture_output=True,
            text=True,
            timeout=120,
            cwd=SCRIPT_DIR,
        )
        if result.returncode != 0:
            return {"error": f"Python failed: {result.stderr[:300]}"}
        return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        return {"error": "Python command timed out (120s)"}
    except json.JSONDecodeError:
        return {"error": "Invalid JSON from Python"}
    except Exception as e:
        return {"error": str(e)}


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "yfinance-backend"})


@app.route("/screen", methods=["POST"])
def screen():
    data = request.json or {}
    top_n = data.get("topN", 10)
    filters = data.get("filters", {})
    result = _run_python("screen", [str(top_n), json.dumps(filters)])
    return jsonify(result)


@app.route("/bridge-screen", methods=["POST"])
def bridge_screen():
    data = request.json or {}
    top_n = data.get("topN", 10)
    filters = data.get("filters", {})
    result = _run_python("bridge_screen", [str(top_n), json.dumps(filters)])
    return jsonify(result)


@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.json or {}
    symbol = data.get("symbol", "")
    if not symbol:
        return jsonify({"error": "symbol is required"}), 400
    result = _run_python("analyze", [symbol])
    return jsonify(result)


@app.route("/nifty", methods=["GET"])
def nifty():
    result = _run_python("nifty")
    return jsonify(result)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=False)
