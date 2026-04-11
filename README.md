# Claude Usage Tracker MCP

An MCP (Model Context Protocol) server that tracks Claude Code token usage across all sessions and provides configurable alarms with sound notifications.

It reads Claude Code's local session data to calculate usage percentages, burn rates, and trigger alerts — giving you a real-time view of your consumption without needing API access.

## Features

- Real-time usage percentage tracking (session, weekly, per-model)
- Configurable alarms with Windows sound notifications
- Automatic alarm checking after every Claude response via Stop hook
- Plan-based limits (Pro, Max 5x, Max 20x) with P90 adaptive learning
- Cross-session monitoring — tracks all sessions combined

## Installation

```bash
git clone https://github.com/ahmetdenizyilmaz/claude-usage-tracker.git
cd claude-usage-tracker
npm install
npm run build
```

### Add to Claude Code

```bash
claude mcp add usage-tracker -s user -- node /path/to/claude-usage-tracker/dist/index.js
```

### Enable automatic alarm checking (optional)

Add a `Stop` hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/claude-usage-tracker/scripts/check-alarms-cli.js"
          }
        ]
      }
    ]
  }
}
```

This runs after every Claude response and beeps if any alarm threshold is crossed.

## Configuration

### Set your plan

```
set_plan with plan="max20"
```

This sets hardcoded output token limits used for percentage calculations:

| Plan | Session (5h) | Weekly |
|------|-------------|--------|
| pro | 45K | 225K |
| max5 | 175K | 875K |
| max20 | 375K | 2.5M |

### Fine-tune limits

If percentages don't match `/usage`, adjust manually:

```
set_plan_limits with sessionOutputTokens=400000
```

### Adaptive limits

Run `recalculate_limits` to analyze your historical sessions and calculate limits via P90 analysis. This scans all past 5-hour session blocks, takes the top 25% highest-usage blocks, and uses the 90th percentile as your estimated cap.

## Tools Reference

### Usage Dashboard

#### `get_usage_percent`

Shows usage percentage bars matching Claude's built-in `/usage` format.

```
Current session
█████████████████████████████           77% used
287.3K / 375.0K output tokens

Current week (all models)
██████████████████████████████████      89% used
2.2M / 2.5M output tokens

Current week (Sonnet only)
                                         0% used
0 / 375.0K output tokens
```

**Parameters:** none

#### `get_usage_summary`

Token usage totals for a given period with model breakdown and activity stats.

**Parameters:**
- `period` (optional): `"today"`, `"week"`, `"month"`, or `"all"` (default: `"today"`)

Returns total tokens by model (opus, sonnet, haiku), message count, session count, and tool call count for the period.

#### `get_5h_window_usage`

Detailed 5-hour rolling window usage by scanning all session JSONL files. Shows exact token breakdown: input, output, cache creation, cache read — per model.

**Parameters:**
- `windowHours` (optional): 1-24, default 5

#### `get_usage_rate`

Current burn rate with spike detection. Extrapolates today's usage rate and compares against the rolling daily average.

**Parameters:**
- `windowDays` (optional): 1-90, default 7

Returns tokens/day average, today's projected rate, and whether a spike is detected.

#### `get_session_history`

Lists recent Claude Code sessions with start time, project directory, and metadata.

**Parameters:**
- `limit` (optional): 1-100, default 10

---

### Alarms

#### `add_alarm`

Create or update a named alarm.

**Parameters:**
- `name` (required): Unique alarm name
- `type` (required): What to monitor
  - `"session"` — current 5h session
  - `"5h-window"` — rolling 5-hour window
  - `"daily"` — daily usage
  - `"weekly"` — weekly usage
  - `"monthly"` — monthly usage
  - `"model"` — per-model usage (e.g., sonnet only)
  - `"burn-rate"` — tokens per hour
- `metric` (required): How to measure
  - `"tokens"` — raw token count
  - `"percent"` — percentage of budget (requires `budget` parameter)
  - `"tokens-per-hour"` — burn rate
- `threshold` (required): Value that triggers the alarm
- `budget` (optional): Token budget for percent metric
- `model` (optional): Model name for model-type alarms (e.g., `"claude-sonnet-4-6"`)
- `sound` (optional): Play sound when triggered (default: true)
- `enabled` (optional): Whether alarm is active (default: true)

**Examples:**

Session alarm at 300K output tokens:
```
add_alarm name="session-80" type="session" metric="tokens" threshold=300000 sound=true
```

Weekly alarm at 80% of 2M budget:
```
add_alarm name="weekly-warn" type="weekly" metric="percent" threshold=80 budget=2000000
```

Sonnet model alarm:
```
add_alarm name="sonnet-limit" type="model" model="claude-sonnet-4-6" metric="tokens" threshold=50000
```

Burn rate alarm at 80K tokens/hour:
```
add_alarm name="fast-burn" type="burn-rate" metric="tokens-per-hour" threshold=80000
```

#### `remove_alarm`

Remove an alarm by name.

**Parameters:**
- `name` (required): Name of alarm to remove

#### `list_alarms`

Show all configured alarms and global sound setting.

**Parameters:** none

#### `check_alarms`

Evaluate all enabled alarms and trigger sounds for any that exceed their threshold.

**Parameters:** none

Returns which alarms fired with severity level (warning/critical).

#### `toggle_sound`

Enable or disable sound alarms globally.

**Parameters:**
- `enabled` (optional): `true`/`false`, or omit to toggle

---

### Plan & Limits

#### `set_plan`

Set your Claude subscription plan to apply hardcoded token limits.

**Parameters:**
- `plan` (required): `"pro"`, `"max5"`, or `"max20"`

#### `set_plan_limits`

Manually set custom output token limits. Use after comparing `get_usage_percent` with Claude's `/usage` to calibrate.

**Parameters:**
- `sessionOutputTokens` (optional): Session (5h window) output token limit
- `weeklyOutputTokens` (optional): Weekly output token limit
- `sonnetSessionOutputTokens` (optional): Sonnet session output token limit

#### `recalculate_limits`

Run P90 adaptive analysis on your historical sessions. Scans all past 5-hour session blocks, filters to the top 25% highest-usage, and takes the 90th percentile as the estimated cap.

**Parameters:** none

#### `get_limits`

Show current plan, hardcoded limits, adaptive limits, and which source is active.

**Parameters:** none

---

### Legacy Tools

#### `get_usage_alerts`

Check simple budget-based alerts. For the newer alarm system, use `check_alarms` instead.

#### `set_alert_threshold`

Configure simple budget thresholds. For advanced alarms, use `add_alarm` instead.

**Parameters:**
- `dailyBudget`, `weeklyBudget`, `monthlyBudget`, `fiveHourBudget` (optional): Token budgets
- `thresholds` (optional): Alert percentage thresholds, e.g., `[50, 75, 90]`
- `spikeMultiplier` (optional): Spike alert multiplier vs average

## How It Works

### Data Sources

- **`~/.claude/stats-cache.json`** — daily token totals per model, activity metrics
- **`~/.claude/projects/*/\*.jsonl`** — per-message token counts with timestamps (used for 5h window and session tracking)
- **`~/.claude/sessions/*.json`** — session metadata

### Percentage Calculation

Usage percentages are based on **output tokens** (not total tokens including cache). Output tokens are the primary metric Anthropic uses for rate limiting.

Formula: `(output tokens in window) / (estimated limit) x 100`

Limits come from either hardcoded plan defaults or P90 adaptive analysis of your historical sessions.

### Sound Notifications (Windows)

Alarms use PowerShell `[console]::beep()`:
- **Warning**: 2 medium beeps (750Hz)
- **Critical**: 3 high beeps (1000Hz)

## License

MIT
