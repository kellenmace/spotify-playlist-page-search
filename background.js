// Background service worker for OAuth 2.0 Authorization Code Flow with PKCE

(function () {
  "use strict";

  // OAuth configuration
  const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
  const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
  const REDIRECT_URI = `chrome-extension://${chrome.runtime.id}/`;
  const SCOPES = "playlist-read-private playlist-read-collaborative";

  // Utility functions for PKCE
  function generate_random_string(length) {
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const values = crypto.getRandomValues(new Uint8Array(length));
    return values.reduce((acc, x) => acc + possible[x % possible.length], "");
  }

  async function create_code_challenge(code_verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(code_verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const base64_digest = btoa(String.fromCharCode(...new Uint8Array(digest)));
    return base64_digest
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  // OAuth flow functions
  async function initiate_oauth_flow(client_id) {
    try {
      console.log("Starting OAuth flow with client ID:", client_id);
      console.log("Redirect URI:", REDIRECT_URI);

      // Validate client ID
      if (!client_id || client_id.trim() === "") {
        throw new Error("Invalid client ID provided");
      }

      // Generate PKCE parameters
      const code_verifier = generate_random_string(128);
      const code_challenge = await create_code_challenge(code_verifier);
      const state = generate_random_string(16);

      // Store PKCE parameters temporarily
      await chrome.storage.local.set({
        oauth_code_verifier: code_verifier,
        oauth_state: state,
      });

      // Build authorization URL
      const auth_params = new URLSearchParams({
        client_id: client_id,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        code_challenge_method: "S256",
        code_challenge: code_challenge,
        state: state,
        scope: SCOPES,
        show_dialog: "true",
      });

      const auth_url = `${SPOTIFY_AUTHORIZE_URL}?${auth_params.toString()}`;
      console.log("Authorization URL:", auth_url);

      // Launch OAuth flow
      const redirect_url = await chrome.identity.launchWebAuthFlow({
        url: auth_url,
        interactive: true,
      });

      console.log("Received redirect URL:", redirect_url);

      // Extract authorization code from redirect URL
      const url_params = new URLSearchParams(new URL(redirect_url).search);
      const authorization_code = url_params.get("code");
      const returned_state = url_params.get("state");

      if (!authorization_code) {
        throw new Error("No authorization code received");
      }

      if (returned_state !== state) {
        throw new Error("State parameter mismatch");
      }

      // Exchange authorization code for access token
      await exchange_code_for_token(
        client_id,
        authorization_code,
        code_verifier
      );

      return { success: true };
    } catch (error) {
      console.error("OAuth flow error:", error);
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
      return { success: false, error: error.message };
    } finally {
      // Clean up temporary PKCE parameters
      await chrome.storage.local.remove(["oauth_code_verifier", "oauth_state"]);
    }
  }

  async function exchange_code_for_token(
    client_id,
    authorization_code,
    code_verifier
  ) {
    const token_data = {
      client_id: client_id,
      grant_type: "authorization_code",
      code: authorization_code,
      redirect_uri: REDIRECT_URI,
      code_verifier: code_verifier,
    };

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(token_data).toString(),
    });

    if (!response.ok) {
      const error_data = await response.json();
      throw new Error(error_data.error_description || "Token exchange failed");
    }

    const token_response = await response.json();

    // Calculate expiration time
    const expires_at = Date.now() + token_response.expires_in * 1000;

    // Store tokens securely
    await chrome.storage.local.set({
      spotify_access_token: token_response.access_token,
      spotify_refresh_token: token_response.refresh_token,
      spotify_token_expires_at: expires_at,
    });
  }

  async function refresh_access_token() {
    try {
      const result = await chrome.storage.local.get([
        "spotify_client_id",
        "spotify_refresh_token",
      ]);

      if (!result.spotify_client_id || !result.spotify_refresh_token) {
        throw new Error("Missing client ID or refresh token");
      }

      const token_data = {
        client_id: result.spotify_client_id,
        grant_type: "refresh_token",
        refresh_token: result.spotify_refresh_token,
      };

      const response = await fetch(SPOTIFY_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(token_data).toString(),
      });

      if (!response.ok) {
        throw new Error("Token refresh failed");
      }

      const token_response = await response.json();
      const expires_at = Date.now() + token_response.expires_in * 1000;

      // Update stored tokens
      const update_data = {
        spotify_access_token: token_response.access_token,
        spotify_token_expires_at: expires_at,
      };

      // Update refresh token if provided
      if (token_response.refresh_token) {
        update_data.spotify_refresh_token = token_response.refresh_token;
      }

      await chrome.storage.local.set(update_data);

      return token_response.access_token;
    } catch (error) {
      console.error("Token refresh error:", error);
      // Clear invalid tokens
      await chrome.storage.local.remove([
        "spotify_access_token",
        "spotify_refresh_token",
        "spotify_token_expires_at",
      ]);
      throw error;
    }
  }

  async function get_valid_access_token() {
    const result = await chrome.storage.local.get([
      "spotify_access_token",
      "spotify_token_expires_at",
    ]);

    if (!result.spotify_access_token) {
      throw new Error("No access token found");
    }

    // Check if token is expired (with 5 minute buffer)
    const expires_at = result.spotify_token_expires_at;
    const buffer_time = 5 * 60 * 1000; // 5 minutes

    if (expires_at && Date.now() >= expires_at - buffer_time) {
      // Token is expired or about to expire, refresh it
      return await refresh_access_token();
    }

    return result.spotify_access_token;
  }

  // Message listener for popup and content script communication
  chrome.runtime.onMessage.addListener((request, sender, send_response) => {
    if (request.action === "initiate_oauth") {
      initiate_oauth_flow(request.client_id).then(send_response);
      return true; // Keep the message channel open for async response
    }

    if (request.action === "get_access_token") {
      get_valid_access_token()
        .then((token) => send_response({ success: true, access_token: token }))
        .catch((error) =>
          send_response({ success: false, error: error.message })
        );
      return true; // Keep the message channel open for async response
    }
  });
})();
