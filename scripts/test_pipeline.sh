#!/bin/bash
# Test full pipeline: screen -> allocate -> stops + stress
set -e

echo "=== 1) GET /api/screen ==="
SCREEN=$(curl -s "http://localhost:3000/api/screen" --max-time 300)
echo "$SCREEN" | python3 -c "import json,sys; d=json.load(sys.stdin); print('Top 10 fetched:', len(d['top10']))"

echo ""
echo "=== 2) POST /api/allocate ==="
ALLOC=$(echo "$SCREEN" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(json.dumps({'stocks': d['top10'], 'totalInvestment': 200000}))
" | curl -s -X POST "http://localhost:3000/api/allocate" \
  -H "Content-Type: application/json" \
  -d @- --max-time 30)
echo "$ALLOC" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('Allocation count:', len(d['allocation']))
print('Total invested:', d['totalInvested'])
print('Sector breakdown:', len(d['sectorBreakdown']), 'sectors')
"

echo ""
echo "=== 3) POST /api/stops ==="
echo "$ALLOC" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(json.dumps({'allocation': d['allocation']}))
" | curl -s -X POST "http://localhost:3000/api/stops" \
  -H "Content-Type: application/json" \
  -d @- --max-time 120 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('Stops:', len(d['stops']))
print('Total P&L:', round(d['totalPnl'], 2))
print('Status:', d['statusCounts'])
"

echo ""
echo "=== 4) POST /api/stress ==="
echo "$ALLOC" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(json.dumps({'allocation': d['allocation'], 'totalInvested': d['totalInvested']}))
" | curl -s -X POST "http://localhost:3000/api/stress" \
  -H "Content-Type: application/json" \
  -d @- --max-time 30 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('Scenarios:', len(d['scenarios']))
print('Worst drawdown:', round(d['worstDrawdown'], 2), '%')
"
