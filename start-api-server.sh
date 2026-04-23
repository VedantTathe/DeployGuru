#!/bin/bash
# Start the deployment API test server
# This server provides endpoints for the DeploymentCheckButton to call

echo "🚀 Starting Deployment API Server on port 8081..."
echo "Press CTRL+C to stop"
echo ""

PORT=8081 node test-deployment-api.js
