/**
 * prompt-border
 *
 * Wraps the live input editor in a rounded border with contextual info:
 *
 *   ╭─ claude-sonnet-4-6 ─────────────────────────────────────────╮
 *   │ user types here                                              │
 *   ╰── 12.3k↓ · 4.1k↑ · ⏸ plan ─────────────────────────────────╯
 *
 * Top border  → model name
 * Bottom border → cumulative token counts + any active status items
 *                 (the same info that normally lives in the footer bar)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── ANSI helpers ─────────────────────────────────────────────────────────────

const ANSI_STRIP = /\x1b\[[0-9;]*m/g;
const RULE_RE = /^─{3,}/; // matches the CustomEditor's ─── separator

function stripAnsi(s: string): string {
  return (s ?? "").replace(ANSI_STRIP, "");
}

function isRuleLine(line: string): boolean {
  return RULE_RE.test(stripAnsi(line));
}

// ── Theme-safe colouring ──────────────────────────────────────────────────────

type Theme = {
  fg(color: string, text: string): string;
  bold?(text: string): string;
};

function col(theme: Theme | undefined, color: string, text: string): string {
  if (!theme || !text) return text ?? "";
  try {
    return theme.fg(color, text);
  } catch {
    return text;
  }
}

function bold(theme: Theme | undefined, text: string): string {
  if (!theme) return text;
  try {
    return theme.bold ? theme.bold(text) : text;
  } catch {
    return text;
  }
}

// ── Border builders ───────────────────────────────────────────────────────────

/**
 * ╭─ label ──────────────────────────────╮
 */
function topBorder(
  width: number,
  rawLabel: string,
  theme: Theme | undefined,
): string {
  const innerW = Math.max(0, width - 2);
  const label = truncateToWidth(rawLabel, innerW, "");
  const fill = "─".repeat(Math.max(0, innerW - visibleWidth(label)));
  return (
    col(theme, "border", "╭") +
    bold(theme, col(theme, "accent", label)) +
    col(theme, "border", fill + "╮")
  );
}

/**
 * ╰─ info ───────────────────────────────╯
 */
/**
 * ╰─ leftInfo ──────────────────────── rightInfo ──╯
 */
function bottomBorder(
  width: number,
  leftInfo: string,
  rightInfo: string,
  theme: Theme | undefined,
): string {
  const innerW = Math.max(0, width - 2);

  // Right side gets at most 45 % of the inner width
  const maxRightW = Math.floor(innerW * 0.45);
  const right = rightInfo ? truncateToWidth(rightInfo, maxRightW, "…") : "";
  const rightW = visibleWidth(right);

  // Left side fills the rest, leaving at least 1 fill char
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

/**
 * │ {line} │   – line is already rendered at (width-4) by CustomEditor
 */
function wrapLine(line: string, theme: Theme | undefined): string {
  return (
    col(theme, "border", "│") +
    " " +
    (line ?? "") +
    " " +
    col(theme, "border", "│")
  );
}

// ── Path / git helpers ──────────────────────────────────────────────────────

function shortenPath(p: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

// ── Token formatting ──────────────────────────────────────────────────────────

function formatK(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return k >= 100 ? `${Math.round(k)}k` : `${parseFloat(k.toFixed(1))}k`;
}

// ── Session data helpers ──────────────────────────────────────────────────────

function getSessionModel(ctx: any): string {
  return (ctx?.model?.name ?? ctx?.model?.id ?? "") as string;
}

function getThinkingLevel(ctx: any): string {
  // Prefer the live accessor; fall back to scanning session events
  if (typeof ctx?.getThinkingLevel === "function") {
    try {
      return String(ctx.getThinkingLevel());
    } catch {
      /* fall through */
    }
  }
  const events: unknown[] = ctx?.sessionManager?.getBranch?.() ?? [];
  let level = "";
  for (const e of events) {
    const ev = e as Record<string, unknown>;
    if (
      ev?.type === "thinking_level_change" &&
      typeof ev.thinkingLevel === "string"
    ) {
      level = ev.thinkingLevel;
    }
  }
  return level;
}

function getSessionTokens(ctx: any): {
  input: number;
  output: number;
  lastContextTokens: number; // total tokens in the most recent turn (for context %)
} {
  let input = 0;
  let output = 0;
  let lastContextTokens = 0;

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
      input += u.input ?? u.inputTokens ?? u.input_tokens ?? 0;
      output += u.output ?? u.outputTokens ?? u.output_tokens ?? 0;
      const cr = u.cacheRead ?? u.cache_read_input_tokens ?? 0;
      const cw = u.cacheWrite ?? u.cache_write_input_tokens ?? 0;
      // Track the running total used in the latest turn's context window
      lastContextTokens =
        (u.input ?? u.inputTokens ?? u.input_tokens ?? 0) +
        (u.output ?? u.outputTokens ?? u.output_tokens ?? 0) +
        cr +
        cw;
    }
  }

  return { input, output, lastContextTokens };
}

// ── Extension ─────────────────────────────────────────────────────────────────

export default function promptBorderExtension(pi: ExtensionAPI): void {
  let currentCtx: any = null;
  let footerDataRef: any = null; // ReadonlyFooterDataProvider reference

  // ── Setup: install custom editor on session start ──────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    if (ctx.hasUI) {
      setupCustomEditor(ctx);
    }
  });

  // ── Cleanup on reload ──────────────────────────────────────────────────────
  pi.on("session_shutdown", async (event: { reason?: string }) => {
    if (event?.reason === "reload") {
      currentCtx = null;
      footerDataRef = null;
    }
  });

  // ── Install the custom editor component ───────────────────────────────────
  function setupCustomEditor(ctx: any): void {
    // Dynamic import matches Pi's own pattern for CustomEditor
    import("@earendil-works/pi-coding-agent")
      .then(
        ({
          CustomEditor,
        }: {
          CustomEditor: new (tui: any, theme: any, kb: any) => any;
        }) => {
          const editorFactory = (
            tui: any,
            editorTheme: any,
            keybindings: any,
          ) => {
            const editor = new CustomEditor(tui, editorTheme, keybindings);
            const originalRender = (
              editor.render as (w: number) => string[]
            ).bind(editor);

            editor.render = (width: number): string[] => {
              // Fall back to original when too narrow
              if (width < 10) return originalRender(width);

              // ── Content width ──────────────────────────────────────────────
              // Each content line will be wrapped as:  │ {line} │
              // overhead = "│ "(2) + " │"(2) = 4
              const contentW = Math.max(1, width - 4);

              // Get content lines from the original editor at narrower width
              const lines = originalRender(contentW);
              if (!lines.length) return lines;

              // ── Locate the bottom separator ────────────────────────────────
              // Original CustomEditor output:
              //   lines[0]          top rule (─────)
              //   lines[1..N-1]     content
              //   lines[N]          bottom rule (─────)
              //   lines[N+1..]      autocomplete items (if any)
              let bottomIdx = lines.length - 1;
              for (let i = lines.length - 1; i >= 1; i--) {
                if (isRuleLine(lines[i] ?? "")) {
                  bottomIdx = i;
                  break;
                }
              }

              // ── Gather context info ────────────────────────────────────────
              const theme = ctx.ui?.theme as Theme | undefined;
              const ctxToUse = currentCtx ?? ctx;
              const model = getSessionModel(ctxToUse);
              const { input, output, lastContextTokens } =
                getSessionTokens(ctxToUse);

              // Top label: model name + thinking level
              const thinkLevel = getThinkingLevel(ctxToUse);
              const thinkSuffix =
                thinkLevel && thinkLevel !== "off" ? ` · ${thinkLevel}` : "";
              const topLabel = model ? ` ${model}${thinkSuffix} ` : " input ";

              // Bottom-left: tokens · context usage · extension statuses
              const infoParts: string[] = [];
              if (input > 0 || output > 0) {
                infoParts.push(`${formatK(input)}↓ · ${formatK(output)}↑`);
              }
              const contextWindow = (ctxToUse?.model?.contextWindow ??
                0) as number;
              if (lastContextTokens > 0 && contextWindow > 0) {
                const pct = Math.round(
                  (lastContextTokens / contextWindow) * 100,
                );
                infoParts.push(`${pct}% of ${formatK(contextWindow)}`);
              }
              const statuses = footerDataRef?.getExtensionStatuses?.() as
                | Map<string, string>
                | undefined;
              if (statuses) {
                for (const v of statuses.values()) {
                  if (v) infoParts.push(v);
                }
              }
              const bottomLeft =
                infoParts.length > 0 ? ` ${infoParts.join(" · ")} ` : "";

              // Bottom-right: shortened cwd + git branch
              const cwd = shortenPath(ctxToUse?.cwd ?? process.cwd());
              const branch = (footerDataRef?.getGitBranch?.() ?? "") as string;
              const rightParts: string[] = [cwd];
              if (branch) rightParts.push(branch);
              const bottomRight = ` ${rightParts.join(" · ")} `;

              // ── Assemble output ────────────────────────────────────────────
              const result: string[] = [];

              // Rounded top border
              result.push(topBorder(width, topLabel, theme));

							// PADDING HERE
              // Single padding line above the content
              // result.push(wrapLine(" ".repeat(contentW), theme));

              // Content lines (between the two rules in original output)
              const contentLines = lines.slice(1, bottomIdx);
              if (contentLines.length === 0) {
                // Empty editor — show one blank content line
                result.push(wrapLine(" ".repeat(contentW), theme));
              } else {
                for (const line of contentLines) {
                  result.push(wrapLine(line, theme));
                }
              }

							// PADDING HERE
              // Blank padding line before the bottom border
              // result.push(wrapLine(" ".repeat(contentW), theme));

              // Rounded bottom border with footer info embedded
              result.push(bottomBorder(width, bottomLeft, bottomRight, theme));

              // Bottom margin
              result.push("");

              // Autocomplete items (unchanged)
              for (let i = bottomIdx + 1; i < lines.length; i++) {
                result.push(lines[i] ?? "");
              }

              return result;
            };

            return editor;
          };

          ctx.ui.setEditorComponent(editorFactory);

          // Set up a silent footer renderer to gain access to the
          // ReadonlyFooterDataProvider (extension statuses, git branch, etc.)
          ctx.ui.setFooter((tui: any, _theme: unknown, footerData: any) => {
            footerDataRef = footerData;
            // Re-render the editor when footer data changes (e.g. git branch switch)
            const unsub =
              footerData?.onBranchChange?.(() => tui.requestRender()) ??
              (() => {});
            return {
              dispose: unsub,
              invalidate(): void {},
              render(): string[] {
                return [];
              }, // footer bar itself is empty
            };
          });
        },
      )
      .catch((err: unknown) => {
        console.debug("[prompt-border] Failed to install custom editor:", err);
      });
  }
}
