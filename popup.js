(function () {
  "use strict";

  const popup_manager = {
    elements: {},

    init() {
      this.cache_elements();
      this.bind_events();
      this.load_stored_data();
      this.update_ui_state();
    },

    cache_elements() {
      this.elements.status_indicator =
        document.getElementById("status-indicator");
      this.elements.status_text = document.getElementById("status-text");
      this.elements.auth_button = document.getElementById("auth-button");
      this.elements.client_id_input = document.getElementById("client-id");
      this.elements.save_button = document.getElementById("save-client-id");
    },

    bind_events() {
      this.elements.auth_button.addEventListener(
        "click",
        this.handle_auth_click.bind(this)
      );
      this.elements.save_button.addEventListener(
        "click",
        this.handle_save_client_id.bind(this)
      );
    },

    async load_stored_data() {
      try {
        const result = await chrome.storage.local.get([
          "spotify_client_id",
          "spotify_access_token",
        ]);

        if (result.spotify_client_id) {
          this.elements.client_id_input.value = result.spotify_client_id;
        }

        this.has_access_token = !!result.spotify_access_token;
      } catch (error) {
        console.error("Error loading stored data:", error);
      }
    },

    update_ui_state() {
      const is_connected = this.has_access_token;

      if (is_connected) {
        this.elements.status_indicator.classList.add("connected");
        this.elements.status_indicator.classList.remove("disconnected");
        this.elements.status_text.textContent = "Connected to Spotify";
        this.elements.auth_button.textContent = "Disconnect";
      } else {
        this.elements.status_indicator.classList.add("disconnected");
        this.elements.status_indicator.classList.remove("connected");
        this.elements.status_text.textContent = "Not connected";
        this.elements.auth_button.textContent = "Connect to Spotify";
      }

      const has_client_id = this.elements.client_id_input.value.trim() !== "";
      this.elements.auth_button.disabled = !has_client_id;
    },

    async handle_auth_click() {
      if (this.has_access_token) {
        await this.disconnect();
      } else {
        await this.connect();
      }
    },

    async connect() {
      const client_id = this.elements.client_id_input.value.trim();

      if (!client_id) {
        alert("Please enter your Spotify Client ID first.");
        return;
      }

      this.elements.auth_button.disabled = true;
      this.elements.auth_button.textContent = "Connecting...";

      try {
        // Send message to background script to initiate OAuth flow
        const response = await chrome.runtime.sendMessage({
          action: "initiate_oauth",
          client_id: client_id,
        });

        if (response.success) {
          this.has_access_token = true;
          this.update_ui_state();
        } else {
          throw new Error(response.error || "OAuth flow failed");
        }
      } catch (error) {
        console.error("OAuth error:", error);
        alert("Failed to connect to Spotify. Please try again.");
      } finally {
        this.elements.auth_button.disabled = false;
      }
    },

    async disconnect() {
      try {
        await chrome.storage.local.remove([
          "spotify_access_token",
          "spotify_refresh_token",
          "spotify_token_expires_at",
        ]);
        this.has_access_token = false;
        this.update_ui_state();
      } catch (error) {
        console.error("Error disconnecting:", error);
        alert("Failed to disconnect. Please try again.");
      }
    },

    async handle_save_client_id() {
      const client_id = this.elements.client_id_input.value.trim();

      if (!client_id) {
        alert("Please enter a valid Client ID.");
        return;
      }

      try {
        await chrome.storage.local.set({ spotify_client_id: client_id });
        this.update_ui_state();

        // Show temporary success feedback
        const original_text = this.elements.save_button.textContent;
        this.elements.save_button.textContent = "Saved!";
        setTimeout(() => {
          this.elements.save_button.textContent = original_text;
        }, 1500);
      } catch (error) {
        console.error("Error saving client ID:", error);
        alert("Failed to save Client ID. Please try again.");
      }
    },
  };

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => popup_manager.init());
  } else {
    popup_manager.init();
  }
})();
