(function () {
  "use strict";

  const popup_manager = {
    elements: {},

    init() {
      console.log("Popup manager initializing...");
      this.cache_elements();
      this.bind_events();
      this.load_stored_data();
      this.update_ui_state();
      console.log("Popup manager initialization complete");
    },

    cache_elements() {
      this.elements.status_indicator =
        document.getElementById("status-indicator");
      this.elements.status_text = document.getElementById("status-text");
      this.elements.auth_button = document.getElementById("auth-button");
      this.elements.client_id_input = document.getElementById("client-id");
      this.elements.save_button = document.getElementById("save-client-id");

      console.log("Elements cached:", {
        status_indicator: !!this.elements.status_indicator,
        status_text: !!this.elements.status_text,
        auth_button: !!this.elements.auth_button,
        client_id_input: !!this.elements.client_id_input,
        save_button: !!this.elements.save_button,
      });
    },

    bind_events() {
      console.log("Binding events...");

      if (this.elements.auth_button) {
        this.elements.auth_button.addEventListener(
          "click",
          this.handle_auth_click.bind(this)
        );
        console.log("Auth button event bound");
      }

      if (this.elements.save_button) {
        this.elements.save_button.addEventListener(
          "click",
          this.handle_save_client_id.bind(this)
        );
        console.log("Save button event bound");
      }
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
        console.log("Stored data loaded:", {
          has_client_id: !!result.spotify_client_id,
          has_access_token: this.has_access_token,
        });
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

      console.log("UI state updated:", { is_connected, has_client_id });
    },

    async handle_auth_click() {
      console.log("Auth button clicked");

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
        const redirectUri = `chrome-extension://${chrome.runtime.id}/`;
        alert(
          `Failed to connect to Spotify: ${error.message}\n\nPlease check the console for more details and ensure your redirect URI is set to:\n${redirectUri}`
        );
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
      console.log("Save Client ID button clicked");
      const client_id = this.elements.client_id_input.value.trim();
      console.log("Client ID value:", client_id);

      if (!client_id) {
        alert("Please enter a valid Client ID.");
        return;
      }

      try {
        console.log("Attempting to save client ID...");
        this.elements.save_button.disabled = true;
        this.elements.save_button.textContent = "Saving...";

        await chrome.storage.local.set({ spotify_client_id: client_id });
        console.log("Client ID saved successfully");

        this.update_ui_state();

        // Show temporary success feedback
        this.elements.save_button.textContent = "Saved!";
        setTimeout(() => {
          this.elements.save_button.textContent = "Save Client ID";
          this.elements.save_button.disabled = false;
        }, 1500);
      } catch (error) {
        console.error("Error saving client ID:", error);
        alert("Failed to save Client ID. Please try again.");
        this.elements.save_button.textContent = "Save Client ID";
        this.elements.save_button.disabled = false;
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
