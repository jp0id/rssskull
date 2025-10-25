#!/bin/bash

# Deploy script for RSS Skull Bot on VM
# This script pulls the latest code and Docker image from GHCR

set -e  # Exit on error

echo "🚀 Starting deployment of RSS Skull Bot..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Stop current container
echo -e "${YELLOW}📦 Step 1: Stopping current container...${NC}"
docker compose down || echo "⚠️  Container might not be running"

# Step 2: Pull latest code
echo -e "${YELLOW}📥 Step 2: Pulling latest code from GitHub...${NC}"
git fetch origin
git checkout main
git pull origin main

# Step 3: Pull latest Docker image from GHCR
echo -e "${YELLOW}🐳 Step 3: Pulling latest Docker image from GHCR...${NC}"
docker compose pull || echo "⚠️  Image not found in GHCR, will build locally"

# Step 4: Start container
echo -e "${YELLOW}▶️  Step 4: Starting container...${NC}"
docker compose up -d

# Step 5: Wait a bit for container to start
echo -e "${YELLOW}⏳ Waiting 5 seconds for container to start...${NC}"
sleep 5

# Step 6: Check status
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo -e "\n📊 Container status:"
docker compose ps

echo -e "\n📋 Recent logs:"
docker compose logs --tail=50 rss-skull-bot

echo -e "\n${GREEN}🎉 Deployment complete! To monitor logs, run:${NC}"
echo "docker compose logs -f rss-skull-bot"

