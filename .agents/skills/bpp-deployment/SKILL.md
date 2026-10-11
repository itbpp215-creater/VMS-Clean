---
name: bpp-deployment
description: >-
  Standard runbook for validating, testing, and deploying BPP-PrerimWatch.
---

# BPP-PrerimWatch Deployment Runbook

## 1. Validate Configuration
Before deploying, always validate the Frigate configuration to ensure no syntax errors exist in the config:
```bash
docker exec frigate python3 -m frigate --validate-config
```

## 2. Standard Deploy
Use the deployment script to deploy locally on the production Windows machine. This script contains built-in guards for health checks and dashboard recreation.
```bash
./deploy.sh
```

## 3. Check System Health
After deploying, verify that all services are running and healthy, and check the GPU status:
```bash
docker ps --format "{{.Names}}: {{.Status}}"
docker inspect -f '{{.State.Health.Status}}' frigate
nvidia-smi
```

## Note on Continuous Integration
Auto-deploy via GitHub Actions is currently not fully functional due to a missing self-hosted runner. Rely on the manual `./deploy.sh` script for the current baseline.
