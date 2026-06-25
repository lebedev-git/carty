for i in $(seq 1 50); do
  j=$(curl -s -m5 http://localhost:8787/api/decks/11/job)
  st=$(echo "$j" | grep -oE '"status":"[^"]+"' | head -1 | cut -d'"' -f4)
  prog=$(echo "$j" | grep -oE '"current":[0-9]+|"total":[0-9]+|"label":"[^"]+"' | tr '\n' ' ')
  echo "[$(date +%H:%M:%S)] $st · $prog"
  if [ "$st" != "running" ]; then echo "FINISHED: $st"; break; fi
  sleep 60
done
