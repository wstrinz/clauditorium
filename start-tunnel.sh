#!/bin/bash

# start-tunnel.sh
# Script to start a Cloudflare quick tunnel for local development
# Usage: ./start-tunnel.sh [port]
# If port is not specified, defaults to 3000

# Set default port if not provided
PORT=${1:-3000}

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "Error: cloudflared is not installed."
    echo "Please install it by following the instructions at:"
    echo "https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation"
    exit 1
fi

echo "Starting Cloudflare quick tunnel to localhost:$PORT..."

# Start the cloudflared tunnel
# The --url flag specifies where to route the traffic (localhost:PORT)
# --no-autoupdate prevents cloudflared from updating during runtime
cloudflared tunnel --url http://localhost:$PORT --no-autoupdate

# Check if cloudflared exited with an error
if [ $? -ne 0 ]; then
    echo "Error: Failed to start Cloudflare tunnel."
    echo "Please check your network connection and try again."
    exit 1
fi

