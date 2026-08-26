// Toggle ponytail mode between FULL and OFF with a keybinding (default: ctrl+shift+y).
// Change the key in ~/.pi/agent/keybindings.json under "ponytail.toggle".

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let ponytailOn = true; // ponytail mode is active by default per project convention

  pi.registerShortcut("ctrl+p", {
    description: "Toggle ponytail mode (FULL/OFF)",
    handler: async (ctx) => {
      ponytailOn = !ponytailOn;
      pi.sendUserMessage(ponytailOn ? "/ponytail full" : "/ponytail off", {
        expandPromptTemplates: true,
      });
      ctx.ui.notify(`Ponytail mode: ${ponytailOn ? "FULL" : "OFF"}`);
    },
  });
}
