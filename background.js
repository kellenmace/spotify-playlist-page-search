// Background service worker for OAuth 2.0 Authorization Code Flow with PKCE

(function () {
  "use strict";

  // OAuth configuration
  const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
  const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
  const SCOPES = "playlist-read-private playlist-read-collaborative";

  // Track pending auth flow for tab-based OAuth fallback
  let pendingAuthFlow = null;

  // Use the proper redirect URI format for Chrome Identity API
  function getRedirectURI() {
    const redirectUri = chrome.identity.getRedirectURL();
    return redirectUri;
  }

  // Fallback redirect URI for tab-based authentication
  function getFallbackRedirectURI() {
    const redirectUri = `chrome-extension://${chrome.runtime.id}/`;
    return redirectUri;
  }

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

  // Alternative method when launchWebAuthFlow fails
  async function openAuthPageInTab(client_id, code_challenge, state) {
    // Create a promise that will be resolved when the auth flow completes
    if (pendingAuthFlow) {
      pendingAuthFlow.reject(
        new Error("Authentication flow was interrupted by a new request")
      );
    }

    const flowPromise = new Promise((resolve, reject) => {
      pendingAuthFlow = { resolve, reject, state };

      // Add timeout to prevent hanging indefinitely
      setTimeout(() => {
        if (pendingAuthFlow && pendingAuthFlow.state === state) {
          console.error("OAuth flow timed out after 5 minutes");
          pendingAuthFlow.reject(
            new Error(
              "OAuth flow timed out - user may have closed the tab or denied authorization"
            )
          );
          pendingAuthFlow = null;
        }
      }, 5 * 60 * 1000); // 5 minutes timeout
    });

    // Build authorization URL with fallback redirect URI
    const fallbackRedirectUri = getFallbackRedirectURI();
    const auth_params = new URLSearchParams({
      client_id: client_id,
      response_type: "code",
      redirect_uri: fallbackRedirectUri,
      code_challenge_method: "S256",
      code_challenge: code_challenge,
      state: state,
      scope: SCOPES,
      show_dialog: "true",
    });

    const auth_url = `${SPOTIFY_AUTHORIZE_URL}?${auth_params.toString()}`;

    // Open the auth page in a new tab
    const tab = await chrome.tabs.create({ url: auth_url });

    // The promise will be resolved by the onBeforeNavigate listener when it detects the redirect
    return flowPromise;
  }

  // Set up a listener for navigation to the redirect URI
  chrome.webNavigation.onBeforeNavigate.addListener(
    function (details) {
      // Only process main frame navigation (not iframes)
      const identityRedirectUri = chrome.identity.getRedirectURL();
      const fallbackRedirectUri = getFallbackRedirectURI();

      if (
        details.frameId === 0 &&
        pendingAuthFlow && // Only process if a fallback flow is active
        (details.url.startsWith(identityRedirectUri) ||
          details.url.startsWith(fallbackRedirectUri))
      ) {
        try {
          // Extract parameters from the URL (check both search params and hash params)
          const url = new URL(details.url);
          let params = new URLSearchParams(url.search);

          // If no search params, try hash params (some OAuth flows use hash)
          if (!params.has("code") && !params.has("error") && url.hash) {
            const hashParams = url.hash.substring(1);
            params = new URLSearchParams(hashParams);
          }

          const code = params.get("code");
          const state = params.get("state");
          const error = params.get("error");

          // Find and resolve the pending auth flow
          if (pendingAuthFlow) {
            if (error) {
              console.error("OAuth error detected:", error);
              pendingAuthFlow.reject(new Error(`OAuth error: ${error}`));
            } else if (!code) {
              console.error("No authorization code received");
              pendingAuthFlow.reject(
                new Error("No authorization code received")
              );
            } else if (state !== pendingAuthFlow.state) {
              console.error("State parameter mismatch:", {
                expected: pendingAuthFlow.state,
                received: state,
              });
              pendingAuthFlow.reject(new Error("State parameter mismatch"));
            } else {
              pendingAuthFlow.resolve({ code, state });
            }

            // Clear the pending auth flow
            pendingAuthFlow = null;

            // Close the tab
            chrome.tabs.remove(details.tabId);
          } else {
            console.warn(
              "OAuth redirect detected but no pending auth flow found"
            );
          }
        } catch (e) {
          console.error("Error processing navigation:", e);
          if (pendingAuthFlow) {
            pendingAuthFlow.reject(e);
            pendingAuthFlow = null;
          }
        }
      }
    },
    {
      url: [
        { urlPrefix: chrome.identity.getRedirectURL() },
        { urlPrefix: `chrome-extension://${chrome.runtime.id}/` },
      ],
    }
  );

  // OAuth flow functions
  async function initiate_oauth_flow(client_id) {
    try {
      // Get the redirect URI from Chrome Identity API
      let REDIRECT_URI = getRedirectURI();

      // Log both URIs for easy copy/paste to Spotify settings
      const fallbackURI = getFallbackRedirectURI();

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

      // Build authorization URL using modern redirect URI
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

      // Try Chrome Identity API first, then fallback to tab-based flow
      let redirect_url;
      let authorization_code;
      let returned_state;
      let error_param;
      try {
        redirect_url = await chrome.identity.launchWebAuthFlow({
          url: auth_url,
          interactive: true,
        });
        if (redirect_url) {
          const parsed_url = new URL(redirect_url);
          const url_params = new URLSearchParams(parsed_url.search);
          authorization_code = url_params.get("code");
          returned_state = url_params.get("state");
          error_param = url_params.get("error");
        }
      } catch (identity_error) {
        console.error("Chrome Identity API failed:", identity_error);
        // Fallback to tab-based authentication
        try {
          const result = await openAuthPageInTab(
            client_id,
            code_challenge,
            state
          );
          authorization_code = result.code;
          returned_state = result.state;
          error_param = null;
          // Update REDIRECT_URI for token exchange to use fallback URI
          REDIRECT_URI = getFallbackRedirectURI();
        } catch (tab_error) {
          console.error("Tab-based authentication failed:", tab_error);
          throw new Error(`Authentication failed: ${tab_error.message}`);
        }
      }

      // Validate the response
      if (error_param) {
        throw new Error(`OAuth error: ${error_param}`);
      }
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
        code_verifier,
        REDIRECT_URI
      );

      // Reload any active Spotify playlist tabs to refresh authentication state
      await reload_spotify_tabs();

      return { success: true };
    } catch (error) {
      console.error("OAuth flow error:", error);
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });

      // Provide specific guidance for redirect URI issues
      const identityRedirectUri = chrome.identity.getRedirectURL();
      const fallbackRedirectUri = getFallbackRedirectURI();
      const additionalInfo = error.message.includes(
        "Authorization page could not be loaded"
      )
        ? `\n\nThis error often means the redirect URI is not properly configured in your Spotify app. Please ensure your Spotify app's redirect URI includes both:\n1. ${identityRedirectUri} (for Chrome Identity API)\n2. ${fallbackRedirectUri} (for tab-based fallback)`
        : "";

      return {
        success: false,
        error: error.message + additionalInfo,
        identityRedirectUri: identityRedirectUri,
        fallbackRedirectUri: fallbackRedirectUri,
      };
    } finally {
      // Clean up temporary PKCE parameters
      await chrome.storage.local.remove(["oauth_code_verifier", "oauth_state"]);
    }
  }

  async function exchange_code_for_token(
    client_id,
    authorization_code,
    code_verifier,
    redirect_uri
  ) {
    const token_data = {
      client_id: client_id,
      grant_type: "authorization_code",
      code: authorization_code,
      redirect_uri: redirect_uri,
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
      let error_data;
      try {
        error_data = await response.json();
        console.error("Token exchange error data:", error_data);
      } catch (parse_error) {
        console.error("Failed to parse error response:", parse_error);
        error_data = {
          error_description: `HTTP ${response.status}: ${response.statusText}`,
        };
      }
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

  async function reload_spotify_tabs() {
    try {
      // Get all tabs that match Spotify playlist URLs
      const tabs = await chrome.tabs.query({
        url: "https://open.spotify.com/playlist/*",
      });

      // Reload each Spotify playlist tab
      for (const tab of tabs) {
        await chrome.tabs.reload(tab.id);
      }
    } catch (error) {
      console.error("Error reloading Spotify tabs after OAuth:", error);
      // Don't throw - this is a nice-to-have feature
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

  // Command listener for keyboard shortcuts
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === "toggle-search") {
      // Get the active tab
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      // Only send the command to Spotify playlist pages
      if (tab && tab.url && tab.url.includes("open.spotify.com/playlist/")) {
        chrome.tabs.sendMessage(tab.id, { action: "toggle-search" });
      }
    }
  });

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
