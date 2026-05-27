(function () {
  "use strict";

  chrome.commands.onCommand.addListener(async function handle_command(command) {
    if (command !== "toggle-search") {
      return;
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab || !tab.id) {
      return;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, { action: "toggle-search" });
    } catch (error) {
      // The content script only exists on Spotify playlist pages.
    }
  });
})();
