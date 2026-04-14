import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getUsageSummary } from "./tools/get-usage-summary.js";
import { getUsageRate } from "./tools/get-usage-rate.js";
import { getUsageAlerts } from "./tools/get-usage-alerts.js";
import { setAlertThreshold } from "./tools/set-alert-threshold.js";
import { getSessionHistory } from "./tools/get-session-history.js";
import { get5hWindowUsage } from "./tools/get-5h-window-usage.js";
import { getUsagePercent } from "./tools/get-usage-percent.js";
import { addAlarm } from "./tools/add-alarm.js";
import { removeAlarm } from "./tools/remove-alarm.js";
import { listAlarms } from "./tools/list-alarms.js";
import { checkAlarms } from "./tools/check-alarms.js";
import { toggleSound } from "./tools/toggle-sound.js";
import { setWeekResetTool } from "./tools/set-week-reset.js";
import { setPlan, setCustomLimits, recalculateAdaptiveLimits, readLimitsConfig } from "./limits.js";

const server = new McpServer({
  name: "claude-usage-alarm",
  version: "2.0.0",
});

// === Usage tools ===

server.tool(
  "get_usage_summary",
  "Get token usage summary for a given period (today, week, month, or all-time). Shows total tokens by model and activity stats.",
  { period: z.enum(["today", "week", "month", "all"]).default("today") },
  async ({ period }) => {
    const result = await getUsageSummary(period);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_usage_rate",
  "Get current token burn rate with spike detection. Compares today's projected usage against the rolling average.",
  { windowDays: z.number().min(1).max(90).default(7) },
  async ({ windowDays }) => {
    const result = await getUsageRate(windowDays);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_usage_alerts",
  "Check legacy alert thresholds. For the new alarm system, use check_alarms instead.",
  {},
  async () => {
    const result = await getUsageAlerts();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "set_alert_threshold",
  "Legacy: set simple budget thresholds. For advanced alarms, use add_alarm instead.",
  {
    dailyBudget: z.number().optional().describe("Daily token budget"),
    weeklyBudget: z.number().optional().describe("Weekly token budget"),
    monthlyBudget: z.number().optional().describe("Monthly token budget"),
    fiveHourBudget: z.number().optional().describe("5-hour rolling window token budget"),
    thresholds: z
      .array(z.number().min(1).max(100))
      .optional()
      .describe("Alert percentage thresholds, e.g. [50, 75, 90]"),
    spikeMultiplier: z
      .number()
      .min(1)
      .optional()
      .describe("Spike alert multiplier vs average"),
  },
  async (params) => {
    const result = await setAlertThreshold(params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_session_history",
  "Get recent Claude Code session history with metadata.",
  { limit: z.number().min(1).max(100).default(10) },
  async ({ limit }) => {
    const result = await getSessionHistory(limit);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_5h_window_usage",
  "Get token usage in the rolling 5-hour window (or custom window) by scanning all session JSONL files.",
  { windowHours: z.number().min(1).max(24).default(5) },
  async ({ windowHours }) => {
    const result = await get5hWindowUsage(windowHours);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_usage_percent",
  "Get a usage dashboard with progress bars showing percentage of budget used for 5-hour window, today, this week, and this month.",
  {},
  async () => {
    const result = await getUsagePercent();
    return { content: [{ type: "text", text: result.text }] };
  }
);

// === Alarm tools ===

server.tool(
  "add_alarm",
  "Add or update a named alarm. Types: session, 5h-window, daily, weekly, monthly, model, burn-rate. Metrics: tokens, percent (needs budget), tokens-per-hour. Each alarm can have sound on/off.",
  {
    name: z.string().describe("Unique alarm name"),
    type: z
      .enum(["session", "5h-window", "daily", "weekly", "monthly", "model", "burn-rate"])
      .describe("What to monitor"),
    metric: z
      .enum(["tokens", "percent", "tokens-per-hour"])
      .describe("How to measure: raw tokens, % of budget, or burn rate"),
    threshold: z.number().describe("Trigger when value exceeds this (tokens, %, or tokens/hr)"),
    budget: z.number().optional().describe("Token budget (required for percent metric)"),
    model: z
      .string()
      .optional()
      .describe("Model name for model-type alarms, e.g. claude-sonnet-4-6"),
    sound: z.boolean().default(true).describe("Play sound when triggered"),
    enabled: z.boolean().default(true).describe("Whether alarm is active"),
  },
  async (params) => {
    const result = await addAlarm(params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "remove_alarm",
  "Remove an alarm by name.",
  { name: z.string().describe("Name of alarm to remove") },
  async ({ name }) => {
    const result = await removeAlarm(name);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "list_alarms",
  "List all configured alarms and global sound setting.",
  {},
  async () => {
    const result = await listAlarms();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "check_alarms",
  "Evaluate all enabled alarms and trigger sounds for any that exceed their threshold. Returns which alarms fired.",
  {},
  async () => {
    const result = await checkAlarms();
    return { content: [{ type: "text" as const, text: result.text ?? "" }] };
  }
);

server.tool(
  "toggle_sound",
  "Enable or disable sound alarms globally.",
  { enabled: z.boolean().optional().describe("Set true/false, or omit to toggle") },
  async ({ enabled }) => {
    const result = await toggleSound(enabled ?? undefined);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// === Plan & Limits tools ===

server.tool(
  "set_plan",
  "Set your Claude subscription plan to calibrate usage percentages. Plans: pro, max5, max20.",
  { plan: z.enum(["pro", "max5", "max20"]).describe("Your Claude subscription plan") },
  async ({ plan }) => {
    const config = await setPlan(plan);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              message: `Plan set to "${plan}". Hardcoded limits applied.`,
              limits: config.hardcoded,
              adaptive: config.adaptive.sampleCount > 0
                ? `Adaptive limits available (${config.adaptive.sampleCount} samples). Run recalculate_limits to update.`
                : "No adaptive data yet. Use recalculate_limits after a few sessions.",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "recalculate_limits",
  "Recalculate adaptive limits using P90 analysis of your historical sessions. Scans all past sessions to estimate your actual rate limit caps.",
  {},
  async () => {
    const config = await recalculateAdaptiveLimits();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              message: "Adaptive limits recalculated.",
              adaptive: config.adaptive,
              hardcoded: config.hardcoded,
              activeSource: config.useAdaptive && config.adaptive.sampleCount >= 3
                ? "adaptive"
                : "hardcoded",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "set_plan_limits",
  "Manually set custom output token limits. Use this to fine-tune after comparing with /usage percentages.",
  {
    sessionOutputTokens: z.number().optional().describe("Session (5h window) output token limit"),
    weeklyOutputTokens: z.number().optional().describe("Weekly output token limit"),
    sonnetSessionOutputTokens: z.number().optional().describe("Sonnet session output token limit"),
  },
  async (params) => {
    const config = await setCustomLimits(params);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ message: "Custom limits saved.", limits: config.hardcoded }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "get_limits",
  "Show current plan, hardcoded limits, adaptive limits, and which source is active.",
  {},
  async () => {
    const config = await readLimitsConfig();
    const activeSource = config.useAdaptive && config.adaptive.sampleCount >= 3
      ? "adaptive"
      : "hardcoded";
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ ...config, activeSource }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "set_week_reset",
  "Calibrate the weekly budget window to your plan's actual reset time. Paste any upcoming reset timestamp from Claude Code's /usage command (e.g. \"2026-04-20T15:00:00+03:00\"). The tracker rolls this anchor forward in 7-day increments automatically, so you only set it once per plan cycle.",
  {
    nextReset: z
      .string()
      .optional()
      .describe("ISO datetime of any upcoming or past weekly reset, e.g. '2026-04-20T15:00:00+03:00'. Pass empty string to clear and fall back to a rolling 7-day window."),
    sonnetNextReset: z
      .string()
      .optional()
      .describe("Optional separate anchor for the Sonnet-only weekly budget if it resets on a different schedule."),
  },
  async ({ nextReset, sonnetNextReset }) => {
    const params = {
      nextReset: nextReset === undefined ? undefined : (nextReset === "" ? null : nextReset),
      sonnetNextReset:
        sonnetNextReset === undefined ? undefined : (sonnetNextReset === "" ? null : sonnetNextReset),
    };
    const result = await setWeekResetTool(params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
