# Maintenance

Amplio ships a small maintenance watcher that keeps the project healthy without
constant human attention. It is plain bash so anyone can read, run, or adapt it.

## What it does

`scripts/maintenance.sh` runs a set of checks and only escalates to a human when
something genuinely needs one:

- Pulls the latest `main` (picks up merged contributions).
- Installs dependencies with a frozen lockfile.
- Runs `typecheck` and the full test suite.
- Audits **production** dependencies for high or critical advisories. Dev-tool
  advisories (test runner, bundler) are logged but do not alert, because they
  never ship in a deployed artifact.
- Counts open pull requests and issues.

If any check fails, a production advisory appears, or a pull request is waiting,
it sends a short alert (Telegram in this deployment). Otherwise it logs
`all green` and stays quiet. Logs live in `.maintenance/` (gitignored).

## Running it by hand

```bash
bash scripts/maintenance.sh
tail -f .maintenance/maintenance.log
```

## Scheduling (macOS launchd)

Save this as `~/Library/LaunchAgents/com.amplio.maintenance.plist`, adjusting
paths, then `launchctl load` it. It runs daily at 09:00.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.amplio.maintenance</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/path/to/amplio/scripts/maintenance.sh</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>StartCalendarInterval</key>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
</dict>
</plist>
```

On Linux, run the same script from cron or a systemd timer.

## Notifications

The script calls a notifier if one is present. Point the `TG` variable at your
own channel (Telegram, Slack webhook, email) to receive alerts.
