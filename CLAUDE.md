# Claude Usage Tracker MCP

When starting a session in this project, automatically run `check_alarms` to see if any usage alarms are triggered.

## Available alarm examples:
- Session token alarm: `add_alarm` with type="session", metric="tokens", threshold=50000000
- Weekly % alarm: `add_alarm` with type="weekly", metric="percent", budget=100000000, threshold=75
- Sonnet model alarm: `add_alarm` with type="model", model="claude-sonnet-4-6", metric="tokens", threshold=50000000
- Burn rate alarm: `add_alarm` with type="burn-rate", metric="tokens-per-hour", threshold=5000000
