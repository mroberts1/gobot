# Module 11: VPS Deployment

> This module walks through deploying the Go Telegram Bot to a
> Virtual Private Server (VPS) so it runs 24/7 in the cloud
> instead of relying on your local machine.

---

## Why Deploy to a VPS?

Running the bot on your Mac works, but has limitations:

| Factor | Local Mac | VPS |
|--------|-----------|-----|
| **Uptime** | Only when lid is open and not sleeping | 24/7/365 |
| **Sleep handling** | `StartCalendarInterval` catches up, `StartInterval` does not | No sleep -- always running |
| **Network** | Home internet (outages, router reboots) | Data center with redundant connectivity |
| **Portability** | Tied to your machine | Access from anywhere |
| **Cost** | Your existing hardware | ~$5/month |
| **Performance** | Shared with your other apps | Dedicated resources |

**Recommendation:** If you need reliable 24/7 operation (especially for
check-ins and morning briefings), deploy to a VPS. If you only use the
bot during work hours, local macOS is fine.

---

## Recommended Provider: Hostinger

This guide uses [Hostinger VPS](https://www.hostinger.com/vps-hosting)
because of the balance between price, performance, and ease of use.

### Recommended Plan: KVM 1

| Spec | KVM 1 |
|------|-------|
| **vCPU** | 1 core |
| **RAM** | 4 GB |
| **Storage** | 50 GB NVMe SSD |
| **Bandwidth** | 1 TB |
| **Price** | ~$5/month (24-month commitment) |
| **OS** | Ubuntu 24.04 LTS |

This is more than enough for the Go bot. The bot idles at ~50 MB RAM
and spikes briefly when spawning Claude subprocesses.

> **Note:** Any VPS provider works (DigitalOcean, Linode, Vultr, Hetzner).
> The setup steps are nearly identical -- only the initial provisioning
> differs. This guide focuses on Hostinger's hPanel interface.

---

## Phase 1: Purchase and Provision

### 1.1 Create a Hostinger Account

1. Go to [hostinger.com/vps-hosting](https://www.hostinger.com/vps-hosting)
2. Select **KVM 1** (or higher if you plan to run other services)
3. Choose a **24-month plan** for the best price
4. Complete checkout

### 1.2 Set Up the VPS

After purchase, you'll be taken to hPanel (Hostinger's control panel):

1. **Choose OS:** Ubuntu 24.04 LTS (recommended)
2. **Set root password:** Use a strong password (you'll disable password login later)
3. **Choose region:** Pick the closest data center to you for lowest latency
4. **Wait for provisioning:** Takes 1-2 minutes

### 1.3 Note Your Server IP

From hPanel, find your server's **IP address**. It looks like `123.45.67.89`.
You'll need this for SSH access.

---

## Phase 2: Secure the Server

**Do this BEFORE deploying the bot.** An unsecured VPS gets attacked within
minutes of going online.

### 2.1 First SSH Connection

From your local terminal:

```bash
ssh root@YOUR_SERVER_IP
```

Accept the fingerprint and enter your root password.

### 2.2 Create a Non-Root User

Never run services as root:

```bash
# Create user (replace 'deploy' with your preferred username)
adduser deploy

# Give sudo access
usermod -aG sudo deploy

# Test the new user
su - deploy
sudo whoami  # Should print: root
exit
```

### 2.3 Set Up SSH Key Authentication

On your **local machine** (not the VPS):

```bash
# Generate a key pair if you don't have one
ssh-keygen -t ed25519 -C "your_email@example.com"

# Copy your public key to the VPS
ssh-copy-id deploy@YOUR_SERVER_IP
```

Test that key-based login works:

```bash
ssh deploy@YOUR_SERVER_IP
# Should log in without asking for a password
```

### 2.4 Disable Password Login

On the VPS:

```bash
sudo nano /etc/ssh/sshd_config
```

Find and change these lines:

```
PasswordAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
```

Restart SSH:

```bash
sudo systemctl restart sshd
```

> **Warning:** Do NOT close your current SSH session until you've verified
> key-based login works in a second terminal. If you lock yourself out,
> use Hostinger's hPanel browser terminal as an emergency escape hatch.

### 2.5 Configure the Firewall (UFW)

```bash
# Allow SSH
sudo ufw allow OpenSSH

# Allow the health check port (optional, for external monitoring)
# sudo ufw allow 3000/tcp

# Enable the firewall
sudo ufw enable

# Verify rules
sudo ufw status
```

Expected output:

```
Status: active

To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
```

> **Defense in depth:** Hostinger's hPanel also has a managed firewall
> (VPS > Firewall). Configure it to allow only SSH (port 22) from your
> IP address for an additional layer of protection.

### 2.6 Install fail2ban

Blocks IPs after repeated failed login attempts:

```bash
sudo apt update && sudo apt install -y fail2ban

# Create local config (survives package updates)
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo nano /etc/fail2ban/jail.local
```

Find the `[sshd]` section and ensure:

```ini
[sshd]
enabled = true
port = ssh
filter = sshd
maxretry = 3
bantime = 3600
```

Start and enable:

```bash
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Check banned IPs
sudo fail2ban-client status sshd
```

### 2.7 Enable Automatic Security Updates

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

Select "Yes" when prompted. This automatically installs security patches.

---

## Phase 3: Install the Runtime

### 3.1 Install System Dependencies

```bash
sudo apt update && sudo apt install -y \
  curl \
  git \
  build-essential \
  unzip
```

### 3.2 Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Verify
bun --version
```

### 3.3 Install Node.js (for PM2)

PM2 requires Node.js:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version
npm --version
```

### 3.4 Install PM2

```bash
sudo npm install -g pm2

# Set up PM2 to auto-start on boot
pm2 startup
# Follow the printed command (copy-paste and run it)
```

### 3.5 Install Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
```

**Important -- Headless Authentication:**

On a VPS without a browser, Claude Code cannot use the normal OAuth flow.
You need an API key instead:

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Add it to your `.env` file as `ANTHROPIC_API_KEY`

The bot's `src/lib/claude.ts` automatically passes `ANTHROPIC_API_KEY` to
Claude subprocesses. When this env var is set, Claude Code uses it instead
of OAuth.

---

## Phase 4: Deploy the Bot

### 4.1 Clone the Repository

```bash
cd ~
git clone https://github.com/YOUR_USERNAME/go-telegram-bot.git
cd go-telegram-bot
```

### 4.2 Install Dependencies

```bash
bun install
```

### 4.3 Create Environment File

```bash
cp .env.example .env
nano .env
```

Fill in your values:

```bash
# Required
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_USER_ID=your_id
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_key

# Required on VPS (headless Claude auth)
ANTHROPIC_API_KEY=your_api_key

# Optional: service role for full Supabase access
SUPABASE_SERVICE_ROLE_KEY=your_key

# Optional: fallback LLMs, voice, etc.
# See .env.example for full list
```

### 4.4 Create Required Directories

```bash
mkdir -p logs temp uploads config
```

### 4.5 Run Setup Verification

```bash
bun run setup
bun run setup:verify
```

All required checks should pass.

### 4.6 Test the Bot

```bash
bun run start
```

Send a test message on Telegram. Verify the bot responds. Then `Ctrl+C`.

### 4.7 Configure Services with PM2 + Cron

```bash
bun run setup:services -- --service all
```

This will:
- Start `telegram-relay` and `watchdog` as PM2 daemon processes
- Create cron entries for `smart-checkin` and `morning-briefing`

Save PM2 state and set up boot persistence:

```bash
pm2 save
```

### 4.8 Verify Services

```bash
# Check PM2 daemons
pm2 status

# Check cron entries
crontab -l

# View live logs
pm2 logs go-telegram-relay
```

---

## Google OAuth on VPS

On macOS, Google OAuth tokens are stored in the Keychain. On a VPS (Linux),
the bot automatically uses file-based storage instead.

### How It Works

The `src/lib/google-auth.ts` module detects the platform:

- **macOS:** `security find-generic-password` (Keychain)
- **Linux/Windows:** `config/.google-tokens.json` (file)

### Setting Up Google Tokens on VPS

If you use Google Calendar or Gmail features (morning briefing, smart check-in):

1. **On your local Mac**, the Google MCP server creates OAuth tokens in the Keychain
2. Export the tokens from your Mac:

```bash
# On your Mac
security find-generic-password -s google-workspace-oauth -a main-account -w
# Copy the JSON output
```

3. Create the token file on the VPS:

```bash
# On the VPS
nano ~/go-telegram-bot/config/.google-tokens.json
```

Paste this structure (replacing with your actual token values):

```json
{
  "google-workspace-oauth": {
    "serverName": "google-workspace-oauth",
    "token": {
      "accessToken": "ya29.xxx",
      "refreshToken": "1//0xxx",
      "expiresAt": 1700000000000,
      "scope": "https://www.googleapis.com/auth/calendar.readonly"
    },
    "updatedAt": 1700000000000
  },
  "gmail-business-oauth": {
    "serverName": "gmail-business-oauth",
    "token": {
      "accessToken": "ya29.xxx",
      "refreshToken": "1//0xxx",
      "expiresAt": 1700000000000,
      "scope": "https://www.googleapis.com/auth/gmail.readonly"
    },
    "updatedAt": 1700000000000
  }
}
```

The bot auto-refreshes expired tokens. You only need to do this once.

> **Security:** The `.google-tokens.json` file is gitignored and should
> never be committed. Set restrictive permissions:
> ```bash
> chmod 600 ~/go-telegram-bot/config/.google-tokens.json
> ```

---

## Daily Management

### Useful Commands

```bash
# Check all PM2 services
pm2 status

# View logs (live stream)
pm2 logs go-telegram-relay
pm2 logs go-watchdog

# View log files directly
tail -f ~/go-telegram-bot/logs/telegram-relay.log
tail -f ~/go-telegram-bot/logs/smart-checkin.log

# Restart a service
pm2 restart go-telegram-relay

# Stop a service
pm2 stop go-telegram-relay

# View cron schedule
crontab -l

# Run check-in manually
cd ~/go-telegram-bot && bun run checkin

# Run morning briefing manually
cd ~/go-telegram-bot && bun run briefing

# Full health check
cd ~/go-telegram-bot && bun run setup:verify
```

### Updating the Bot

```bash
cd ~/go-telegram-bot
git pull
bun install
pm2 restart all
```

### Monitoring Disk Space

```bash
df -h      # Check disk usage
du -sh ~/go-telegram-bot/logs/  # Check log size
```

If logs grow too large, rotate them:

```bash
# Truncate log files (keeps PM2 happy)
> ~/go-telegram-bot/logs/telegram-relay.log
> ~/go-telegram-bot/logs/smart-checkin.log
```

Or set up automatic log rotation:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

---

## Hostinger-Specific Notes

### 1. hPanel Browser Terminal

If you ever get locked out of SSH (misconfigured firewall, lost SSH key),
Hostinger provides a browser-based terminal in hPanel:

**VPS > your server > Terminal**

This is your emergency escape hatch. Bookmark it.

### 2. Managed Firewall

Hostinger's hPanel includes a network-level firewall (separate from UFW):

**VPS > your server > Firewall**

For maximum security, configure both:
- **hPanel firewall:** Allow SSH (22) from your IP only (network level)
- **UFW:** Allow SSH from anywhere (OS level, in case hPanel rules change)

### 3. Snapshots and Backups

Hostinger offers server snapshots. Take one after initial setup:

**VPS > your server > Snapshots > Create**

This lets you restore to a known-good state if something breaks.

### 4. Server Reboot

If you need to reboot:

```bash
sudo reboot
```

PM2 will auto-start your services after boot (thanks to `pm2 startup`).
Cron entries survive reboots automatically.

### 5. OS Upgrades

Hostinger provides an OS reinstall option in hPanel. If you ever need to
start fresh, you can reinstall Ubuntu and re-run this guide.

### 6. Resource Monitoring

Check server resources:

```bash
htop          # Interactive process viewer
free -h       # Memory usage
uptime        # System uptime and load
```

### 7. IPv4 vs IPv6

Hostinger VPS comes with an IPv4 address. If your Telegram API calls fail,
ensure outbound HTTPS (port 443) is not blocked:

```bash
curl -I https://api.telegram.org
# Should return HTTP/2 200
```

### 8. Time Zone

Set the server timezone to match your local timezone (for correct
check-in and briefing schedules):

```bash
sudo timedatectl set-timezone Europe/Berlin  # Change to your timezone
timedatectl  # Verify
```

---

## Security Checklist

Before going live, verify all items:

- [ ] Root login disabled (`PermitRootLogin no`)
- [ ] Password authentication disabled (`PasswordAuthentication no`)
- [ ] SSH key authentication working
- [ ] UFW enabled with only required ports open
- [ ] fail2ban installed and monitoring SSH
- [ ] Unattended upgrades enabled
- [ ] `.env` file has restrictive permissions (`chmod 600 .env`)
- [ ] `.google-tokens.json` has restrictive permissions (if used)
- [ ] hPanel managed firewall configured (optional but recommended)
- [ ] Server snapshot taken

---

## Troubleshooting

### Bot Not Starting

```bash
# Check PM2 status
pm2 status

# Check error logs
pm2 logs go-telegram-relay --err --lines 50

# Test manually
cd ~/go-telegram-bot && bun run start
```

### Claude Subprocess Failing

```bash
# Check Claude CLI is installed
claude --version

# Check API key is set
grep ANTHROPIC_API_KEY .env

# Test Claude directly
claude -p "Hello" --output-format text
```

Common causes:
- `ANTHROPIC_API_KEY` not set (required on headless VPS)
- API key expired or rate-limited
- Network issue reaching Anthropic API

### Cron Jobs Not Running

```bash
# Verify cron entries exist
crontab -l | grep go

# Check cron logs
grep CRON /var/log/syslog | tail -20

# Run manually to test
cd ~/go-telegram-bot && bun run checkin
```

### Memory Issues

If the VPS runs out of memory (unlikely with KVM 1's 4 GB):

```bash
# Check memory usage
free -h

# Check which processes use the most
ps aux --sort=-%mem | head -10

# Add swap space (emergency measure)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### SSH Connection Refused

1. Check Hostinger's hPanel firewall rules
2. Use the hPanel browser terminal to access the server
3. Check UFW: `sudo ufw status`
4. Check SSH service: `sudo systemctl status sshd`

---

## Relevant Source Files

| File | Purpose |
|------|---------|
| `setup/configure-services.ts` | PM2 + cron configuration (Linux) |
| `setup/uninstall.ts` | Remove PM2 processes and cron entries |
| `setup/verify.ts` | Full health check |
| `src/lib/claude.ts` | Claude subprocess (passes `ANTHROPIC_API_KEY`) |
| `src/lib/google-auth.ts` | Cross-platform OAuth (Keychain vs file) |

---

**Previous module:** [10 - Customization Guide](./10-customization-guide.md)
