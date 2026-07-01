/**
 * welcome-screen.ts
 *
 * Displays a Welcome ASCII art banner as a widget above the editor on startup.
 * The banner is automatically cleared when the user sends their first message.
 *
 * Also forces skills, extensions, and themes to display on separate lines
 * at startup (instead of a single comma-separated line) by switching
 * the TUI into expanded mode before `showLoadedResources` renders them.
 *
 * Side-effect: tool call outputs will also start in expanded state.
 * Press the `app.tools.expand` keybinding (usually Ctrl+E or similar)
 * to toggle them back to collapsed at any time.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BANNER = [
  "",
  "       \\ \\      / /__| | ___ ___  _ __ ___   ___ ",
  "        \\ \\ /\\ / / _ \\ |/ __/ _ \\| '_ ` _ \\ / _ \\",
  "         \\ V  V /  __/ | (_| (_) | | | | | |  __/",
  "          \\_/\\_/ \\___|_|\\___\\___/|_| |_| |_|\\___|",
  "",
  "    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2563\u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557  \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2563\u2588\u2588\u2557   \u2588\u2588\u2557",
  "    \u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551 \u2588\u2588\u2554\u255d\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u255a\u2588\u2588\u2557 \u2588\u2588\u2554\u255d",
  "    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2563\u2588\u2588\u2554\u2588\u2588\u2588\u2588\u2554\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2554\u255d \u2588\u2588\u2588\u2588\u2588\u2563   \u255a\u2588\u2588\u2588\u2588\u2554\u255f ",
  "    \u255a\u2550\u2550\u2550\u2550\u2588\u2588\u2563\u2588\u2588\u2551\u255a\u2588\u2588\u2554\u255d\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2588\u2588\u2557 \u2588\u2588\u2554\u2550\u2550\u255d    \u255a\u2588\u2588\u2554\u255d  ",
  "    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2563\u2588\u2588\u2551 \u255a\u2550\u255d \u2588\u2588\u2551\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2551  \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2563   \u2588\u2588\u2551   ",
  "    \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u255d     \u255a\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u255d  \u255a\u2550\u255d\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d   \u255a\u2550\u255d   ",
  "",
];

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    // Show the ASCII art welcome banner above the editor.
    // Use the factory-function form to bypass the 10-line MAX_WIDGET_LINES
    // limit that applies to plain string arrays.
    ctx.ui.setWidget("welcome-banner", () => ({
      render: () => BANNER,
      invalidate() {},
    }));

    // Also expand resources list for readability
    ctx.ui.setToolsExpanded(false);
  });

  // Clear the banner as soon as the user sends their first message
  pi.on("input", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget("welcome-banner", []);
  });
}
