#!/bin/sh
CONFIG=$(curl -s http://127.0.0.1:5000/api/config)
for i in 2 6 7 8 9 10 11 12 13 14 15; do
  CAM="nongwang$i"
  echo "Fixing $CAM"
  curl -s -X PUT -H "Content-Type: application/json" -d "{\"requires_restart\": 0, \"config_data\": {\"cameras\": {\"$CAM\": {\"ffmpeg\": {\"inputs\": [{\"path\": \"rtsp://127.0.0.1:8554/$CAM?video\", \"roles\": [\"record\"], \"input_args\": \"preset-rtsp-restream\"}]}}}}}" http://127.0.0.1:5000/api/config/set
done

