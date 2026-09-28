#!/usr/bin/env bash
# ============================================================
# Weekly Rebalance — Nifty Momentum Strategy
# ============================================================
# Chains 4 scripts in order:
#   1. nifty_momentum_screen.py     — refresh screen + Top 10
#   2. portfolio_allocation.py       — ₹2L allocation across Top 10
#   3. stop_loss_monitor.py          — live stop-loss status
#   4. stress_test.py                 — portfolio resilience check
#
# Usage:
#   bash run_weekly.sh                # run all 4
#   bash run_weekly.sh screen          # run only the screen
#
# Schedule via crontab (Linux/Mac) — every Saturday 10:00 local time:
#   0 10 * * 6 cd /path/to/download && bash run_weekly.sh >> weekly.log 2>&1
#
# Schedule via Windows Task Scheduler — see README in download folder.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"
TS="$(date +%Y-%m-%d_%H%M%S)"
LOG_FILE="$LOG_DIR/weekly_${TS}.log"

echo "============================================================" | tee "$LOG_FILE"
echo "Weekly Rebalance — started $(date)"                          | tee -a "$LOG_FILE"
echo "Working dir: $SCRIPT_DIR"                                    | tee -a "$LOG_FILE"
echo "============================================================" | tee -a "$LOG_FILE"

PYTHON="${PYTHON:-python3}"

run_step() {
    local label="$1"; shift
    local script="$1"; shift
    echo "" | tee -a "$LOG_FILE"
    echo "--- [$label] $script ---" | tee -a "$LOG_FILE"
    if "$PYTHON" "$script" 2>&1 | tee -a "$LOG_FILE"; then
        echo "[$label] OK" | tee -a "$LOG_FILE"
    else
        echo "[$label] FAILED — see log above" | tee -a "$LOG_FILE"
        return 1
    fi
}

# Optional single-step mode
case "${1:-all}" in
    screen)     run_step "1/4" nifty_momentum_screen.py ;;
    alloc)      run_step "2/4" portfolio_allocation.py ;;
    stops)      run_step "3/4" stop_loss_monitor.py ;;
    stress)     run_step "4/4" stress_test.py ;;
    all)
        run_step "1/4" nifty_momentum_screen.py
        run_step "2/4" portfolio_allocation.py
        run_step "3/4" stop_loss_monitor.py
        run_step "4/4" stress_test.py
        ;;
    *) echo "Usage: bash run_weekly.sh [all|screen|alloc|stops|stress]"; exit 1 ;;
esac

echo "" | tee -a "$LOG_FILE"
echo "============================================================" | tee -a "$LOG_FILE"
echo "Weekly Rebalance — finished $(date)"                          | tee -a "$LOG_FILE"
echo "Log: $LOG_FILE"                                              | tee -a "$LOG_FILE"
echo "Latest outputs in: $SCRIPT_DIR/"                             | tee -a "$LOG_FILE"
echo "============================================================" | tee -a "$LOG_FILE"
