#!/bin/bash

# Setup script for running the YouTube Chat Multi app on Termux
# Based on: https://github.com/rishabhrpg/puppeteer-on-termux

echo "===== YouTube Chat Multi - Termux Setup Script ====="
echo "This script will guide you through setting up the necessary environment"
echo "to run the YouTube Chat Multi application on Termux."
echo ""

# Check if running in Termux
if [ -z "$TERMUX_VERSION" ] && [ -z "$PREFIX" ]; then
  echo "⚠️  Warning: This script is designed to run in Termux."
  echo "If you're not running this in Termux, you may need to adapt the instructions."
  echo ""
  read -p "Continue anyway? (y/n): " CONTINUE
  if [ "$CONTINUE" != "y" ]; then
    echo "Setup aborted."
    exit 1
  fi
fi

echo "Step 1: Installing proot-distro if not already installed..."
pkg install proot-distro

echo "Step 2: Installing Alpine Linux in proot-distro..."
proot-distro install alpine

echo "Step 3: Creating a setup script for Alpine..."
cat > alpine-setup.sh << 'EOL'
#!/bin/sh

# Update Alpine and install required packages
echo "Updating Alpine packages..."
apk update

echo "Installing Chromium and required packages..."
apk add --no-cache nmap && \
  echo @edge http://nl.alpinelinux.org/alpine/edge/community >> /etc/apk/repositories && \
  echo @edge http://nl.alpinelinux.org/alpine/edge/main >> /etc/apk/repositories && \
  apk update && \
  apk add --no-cache chromium

echo "Alpine setup complete!"
echo "To start Chromium in remote debugging mode, run:"
echo "chromium-browser --headless --disable-gpu --remote-debugging-port=9222"
EOL

chmod +x alpine-setup.sh

echo "Step 4: Running the Alpine setup script..."
proot-distro login alpine -- sh -c "$(pwd)/alpine-setup.sh"

echo ""
echo "===== Setup Complete! ====="
echo ""
echo "To run the application:"
echo ""
echo "1. Start Chromium in debug mode in a separate Termux session:"
echo "   proot-distro login alpine -- chromium-browser --headless --disable-gpu --remote-debugging-port=9222"
echo ""
echo "2. In another Termux session, start the backend:"
echo "   cd backend && bun run start"
echo ""
echo "3. In a third Termux session, start the frontend:"
echo "   cd .. && npm run dev"
echo ""
echo "Note: Make sure to keep the Chromium session running while using the app." 