#!/bin/bash

# Exit immediately if any command fails
set -e

# Get the actual user's name and home directory
ACTUAL_USER=$(whoami)
USER_HOME=$HOME

DISABLED=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d)

      DISABLED+=("$2")
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

value_in_array() {
  local search="$1"
  shift # Remove the search term, leaving only the array elements
  
  for element in "$@"; do
    [[ "$element" == "$search" ]] && return 0
  done
  return 1
}

# Change directory to the user's home directory
cd

# 1. Update system repositories
sudo apt-get update

# 2. Install Git
sudo apt-get install -y git

# 3. Install Node.js 24 from NodeSource system-wide
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# 4. Install PM2 globally
sudo npm install -g pm2

# 5. Setup the project and run the installer
mkdir -p projectPackageManager
cd projectPackageManager

git clone https://github.com/Minecat300/nodejsPPM.git .

# Run the installer with sudo (as required by the repo)
if value_in_array "nginx" "${DISABLED[@]}"; then
    sudo node installer.js -d nginx
else
    sudo node installer.js
fi

# Give ownership of the project files back to your regular user
sudo chown -R $ACTUAL_USER:$ACTUAL_USER .

# 6. Configure PM2 startup for your regular user
PM2_STARTUP_CMD=$(pm2 startup systemd -u $ACTUAL_USER --hp $USER_HOME | grep "sudo env")
eval "$PM2_STARTUP_CMD"

# 7. Save the current PM2 process list for your user
pm2 save

# Change directory back to where you started safely
cd ..