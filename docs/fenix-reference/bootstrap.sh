#!/usr/bin/env sh
set -eu

npm install
if [ ! -f workbench.config.json ]; then
  npm run init-project
fi

echo "Configure your project instance, then authenticate and run:"
echo "  copilot login --host YOUR_ENTERPRISE.ghe.com"
echo "  gh auth login --hostname YOUR_ENTERPRISE.ghe.com"
echo "  npm run projects"
echo "  npm run doctor -- --project YOUR_PROJECT_ID"
echo "  npm start -- --project YOUR_PROJECT_ID"
