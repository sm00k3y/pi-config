/**
 * prompt-border
 *
 * Wraps the live input editor in a rounded border with contextual info:
 *
 *   ╭─ anthropic / claude-sonnet-4-6 · medium ────────────────────╮
 *   │                                                              │
 *   │ user types here                                              │
 *   │                                                              │
 *   ╰── 12.3k↓ · 4.1k↑ · 42% of 200k · ⏸ plan ── ~/proj · main ──╯
 *
 * Top border    → provider / model · thinking level
 * Bottom-left   → tokens · context % · extension statuses
 * Bottom-right  → cwd · git branch
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const ANSI_STRIP = /\x1b\[[0-9;]*m/g;
const RULE_RE = /^─{3,}/;

function stripAnsi(s: string): string {
  return (s ?? "").replace(ANSI_STRIP, "");
}

function isRuleLine(line: string): boolean {
  return RULE_RE.test(stripAnsi(line));
}

// ── Theme helpers ─────────────────────────────────────────────────────────────

type Theme = { fg(color: string, text: string): string; bold?(text: string): string };

function col(theme: Theme | undefined, color: string, text: string): string {
  if (!theme || !text) return text ?? "";
  try { return theme.fg(color, text); } catch { return text; }
}

function bold(theme: Theme | undefined, text: string): string {
  if (!theme) return text;
  try { return theme.bold ? theme.bold(text) : text; } catch { return text; }
}

// ── Border builders ───────────────────────────────────────────────────────────

function topBorder(width: number, rawLabel: string, theme: Theme | undefined): string {
  const innerW = Math.max(0, width - 2);
  const label = truncateToWidth(rawLabel, innerW, "");
  const fill = "─".repeat(Math.max(0, innerW - visibleWidth(label)));
  return (
    col(theme, "border", "╭") +
    bold(theme, col(theme, "accent", label)) +
    col(theme, "border", fill + "╮")
  );
}

function bottomBorder(
  width: number,
  leftInfo: string,
  rightInfo: string,
  theme: Theme | undefined,
): string {
  const innerW = Math.max(0, width - 2);
  const maxRightW = Math.floor(innerW * 0.45);
  const right = rightInfo ? truncateToWidth(rightInfo, maxRightW, "…") : "";
  const rightW = visibleWidth(right);
  const leftAvail = Math.max(0, innerW - rightW - 1);
  const left = leftInfo ? truncateToWidth(leftInfo, leftAvail, "…") : "";
  const leftW = visibleWidth(left);
  const fill = "─".repeat(Math.max(0, innerW - leftW - rightW));
  return (
    col(theme, "border", "╰") +
    col(theme, "muted", left) +
    col(theme, "border", fill) +
    col(theme, "muted", right) +
    col(theme, "border", "╯")
  );
}

function wrapLine(line: string, theme: Theme | undefined): string {
  return col(theme, "border", "│") + " " + (line ?? "") + " " + col(theme, "border", "│");
}

// ── Path / git helpers ────────────────────────────────────────────────────────

function shortenPath(p: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

// ── Token formatting ──────────────────────────────────────────────────────────

function formatK(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return k >= 100 ? `${Math.round(k)}k` : `${parseFloat(k.toFixed(1))}k`;
}

// ── Settings helpers ──────────────────────────────────────────────────────────

function readDefaultProvider(): string {
  try {
    const path = join(process.env.HOME ?? homedir(), ".pi", "agent", "settings.json");
    if (!existsSync(path)) return "";
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    return typeof parsed?.defaultProvider === "string" ? parsed.defaultProvider : "";
  } catch { return ""; }
}

// ── Session data helpers ──────────────────────────────────────────────────────

function getSessionModel(ctx: any): string {
  return (ctx?.model?.name ?? ctx?.model?.id ?? "") as string;
}

function getThinkingLevel(ctx: any): string {
  if (typeof ctx?.getThinkingLevel === "function") {
    try { return String(ctx.getThinkingLevel()); } catch { /* fall through */ }
  }
  const events: unknown[] = ctx?.sessionManager?.getBranch?.() ?? [];
  let level = "";
  for (const e of events) {
    const ev = e as Record<string, unknown>;
    if (ev?.type === "thinking_level_change" && typeof ev.thinkingLevel === "string") {
      level = ev.thinkingLevel;
    }
  }
  return level;
}

function getSessionTokens(ctx: any): {
  input: number;
  output: number;
  lastContextTokens: number;
} {
  let input = 0, output = 0, lastContextTokens = 0;
  const events: unknown[] = ctx?.sessionManager?.getBranch?.() ?? [];
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const ev = e as Record<string, unknown>;
    if (ev.type !== "message") continue;
    const m = ev.message as Record<string, unknown> | undefined;
    if (!m || m.role !== "assistant") continue;
    if (m.stopReason === "error" || m.stopReason === "aborted") continue;
    const u = m.usage as Record<string, number> | undefined;
    if (u) {
      input  += u.input  ?? u.inputTokens  ?? u.input_tokens  ?? 0;
      output += u.output ?? u.outputTokens ?? u.output_tokens ?? 0;
      const cr = u.cacheRead  ?? u.cache_read_input_tokens  ?? 0;
      const cw = u.cacheWrite ?? u.cache_write_input_tokens ?? 0;
      lastContextTokens =
        (u.input ?? u.inputTokens ?? u.input_tokens ?? 0) +
        (u.output ?? u.outputTokens ?? u.output_tokens ?? 0) +
        cr + cw;
    }
  }
  return { input, output, lastContextTokens };
}

// ── Extension ─────────────────────────────────────────────────────────────────

export default function promptBorderExtension(pi: ExtensionAPI): void {
  let currentCtx: any = null;
  let footerDataRef: any = null;

  // settings.json defaultProvider — read once as a fallback, file rarely changes
  let settingsProvider = "";
  let settingsProviderLoaded = false;

  function getProvider(ctx: any): string {
    // Prefer the live model object — updates automatically when provider changes
    const live = (ctx?.model as any)?.provider as string | undefined;
    if (live) return live;
    // Fall back to settings.json (lazy-loaded once)
    if (!settingsProviderLoaded) {
      settingsProvider = readDefaultProvider();
      settingsProviderLoaded = true;
    }
    return settingsProvider;
  }

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    if (ctx.hasUI) setupCustomEditor(ctx);
  });

  pi.on("session_shutdown", async (event: { reason?: string }) => {
    if (event?.reason === "reload") {
      currentCtx    = null;
      footerDataRef = null;
      settingsProviderLoaded = false;
      settingsProvider = "";
    }
  });

  function setupCustomEditor(ctx: any): void {
    import("@earendil-works/pi-coding-agent")
      .then(({ CustomEditor }: { CustomEditor: new (tui: any, theme: any, kb: any) => any }) => {

        const editorFactory = (tui: any, editorTheme: any, keybindings: any) => {
          const editor = new CustomEditor(tui, editorTheme, keybindings);
          const originalRender = (editor.render as (w: number) => string[]).bind(editor);

          editor.render = (width: number): string[] => {
            if (width < 10) return originalRender(width);

            const contentW = Math.max(1, width - 4);
            const lines = originalRender(contentW);
            if (!lines.length) return lines;

            // Find bottom rule — content sits between lines[0] and lines[bottomIdx]
            let bottomIdx = lines.length - 1;
            for (let i = lines.length - 1; i >= 1; i--) {
              if (isRuleLine(lines[i] ?? "")) { bottomIdx = i; break; }
            }

            const theme    = ctx.ui?.theme as Theme | undefined;
            const ctxToUse = currentCtx ?? ctx;

            // ── Top label: provider / model · thinking ─────────────────────
            const model    = getSessionModel(ctxToUse);
            const provider = getProvider(ctxToUse);
            const modelPart = model
              ? provider ? `${model} (${provider})` : model
              : provider || "";
            const thinkLevel  = getThinkingLevel(ctxToUse);
            const thinkSuffix = thinkLevel && thinkLevel !== "off" ? ` · ${thinkLevel}` : "";
            const topLabel = modelPart ? ` ${modelPart}${thinkSuffix} ` : " input ";

            // ── Bottom-left: tokens · context % · statuses ─────────────────
            const { input, output, lastContextTokens } = getSessionTokens(ctxToUse);
            const infoParts: string[] = [];
            if (input > 0 || output > 0) {
              infoParts.push(`${formatK(input)}↓ · ${formatK(output)}↑`);
            }
            const contextWindow = (ctxToUse?.model?.contextWindow ?? 0) as number;
            if (lastContextTokens > 0 && contextWindow > 0) {
              const pct = Math.round((lastContextTokens / contextWindow) * 100);
              infoParts.push(`${pct}% of ${formatK(contextWindow)}`);
            }
            const statuses = footerDataRef?.getExtensionStatuses?.() as Map<string, string> | undefined;
            if (statuses) {
              for (const v of statuses.values()) { if (v) infoParts.push(v); }
            }
            const bottomLeft = infoParts.length > 0 ? ` ${infoParts.join(" · ")} ` : "";

            // ── Bottom-right: cwd · branch ─────────────────────────────────
            const cwd    = shortenPath(ctxToUse?.cwd ?? process.cwd());
            const branch = (footerDataRef?.getGitBranch?.() ?? "") as string;
            const rightParts = branch ? [cwd, branch] : [cwd];
            const bottomRight = ` ${rightParts.join(" · ")} `;

            // ── Assemble ───────────────────────────────────────────────────
            const result: string[] = [];

            result.push(topBorder(width, topLabel, theme));
            // result.push(wrapLine(" ".repeat(contentW), theme));   // top padding

            const contentLines = lines.slice(1, bottomIdx);
            if (contentLines.length === 0) {
              result.push(wrapLine(" ".repeat(contentW), theme));
            } else {
              for (const line of contentLines) result.push(wrapLine(line, theme));
            }

            // result.push(wrapLine(" ".repeat(contentW), theme));   // bottom padding
            result.push(bottomBorder(width, bottomLeft, bottomRight, theme));
            result.push("");                                       // bottom margin

            // Autocomplete items pass through unchanged
            for (let i = bottomIdx + 1; i < lines.length; i++) result.push(lines[i] ?? "");

            return result;
          };

          return editor;
        };

        ctx.ui.setEditorComponent(editorFactory);

        ctx.ui.setFooter((tui: any, _theme: unknown, footerData: any) => {
          footerDataRef = footerData;
          const unsub = footerData?.onBranchChange?.(() => tui.requestRender()) ?? (() => {});
          return {
            dispose: unsub,
            invalidate(): void {},
            render(): string[] { return []; },
          };
        });
      })
      .catch((err: unknown) => {
        console.debug("[prompt-border] Failed to install custom editor:", err);
      });
  }
}
