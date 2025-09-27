// Spotify Web Player Playlist Search Content Script

(function () {
  "use strict";

  let playlist_songs = [];
  let current_playlist_id = null;
  let search_modal = null;
  let is_fetching = false;
  let is_first_fetch = true;

  const playlist_search = {
    init() {
      if (this.is_playlist_page()) {
        this.inject_search_button();
        this.extract_playlist_id();
      }
    },

    is_playlist_page() {
      return window.location.href.startsWith(
        "https://open.spotify.com/playlist/"
      );
    },

    extract_playlist_id() {
      const url_parts = window.location.pathname.split("/");
      const playlist_index = url_parts.indexOf("playlist");

      if (playlist_index !== -1 && playlist_index + 1 < url_parts.length) {
        current_playlist_id = url_parts[playlist_index + 1];
      }
    },

    inject_search_button() {
      // Remove existing button if it exists
      const existing_button = document.querySelector(
        ".spotify-playlist-search-button"
      );
      if (existing_button) {
        existing_button.remove();
      }

      // Try to find the more button first
      let target_element = document.querySelector(
        'button[data-testid="more-button"]'
      );

      // Fallback: find the action bar and get the last button
      if (!target_element) {
        const action_bar = document.querySelector(
          'div[data-testid="action-bar-row"]'
        );
        if (action_bar) {
          const buttons = action_bar.querySelectorAll("button");
          if (buttons.length > 0) {
            target_element = buttons[buttons.length - 1];
          }
        }
      }

      if (target_element) {
        const search_button = this.create_search_button();
        target_element.parentNode.insertBefore(search_button, target_element);
      } else {
        // Retry after a short delay if elements aren't ready
        setTimeout(() => this.inject_search_button(), 1000);
      }
    },

    create_search_button() {
      const button = document.createElement("button");
      button.className = "spotify-playlist-search-button";
      button.setAttribute("aria-label", "Search playlist");
      button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <path d="m11 11 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      `;

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.open_search_modal();
      });

      return button;
    },

    async open_search_modal() {
      if (search_modal) {
        search_modal.showModal();
        return;
      }

      search_modal = this.create_search_modal();
      document.body.appendChild(search_modal);
      search_modal.showModal();

      // Focus the search input
      const search_input = search_modal.querySelector(
        ".spotify-playlist-search-input"
      );
      search_input.focus();

      // Load playlist songs
      await this.load_playlist_songs();
    },

    create_search_modal() {
      const dialog = document.createElement("dialog");
      dialog.className = "spotify-playlist-search-modal";

      dialog.innerHTML = `
        <div class="spotify-playlist-search-modal-content">
          <div class="spotify-playlist-search-header">
            <h2>Search Playlist</h2>
            <div class="spotify-playlist-search-input-container">
              <svg class="spotify-playlist-search-input-icon" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5" fill="none"/>
                <path d="m11 11 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              <input 
                type="text" 
                class="spotify-playlist-search-input" 
                placeholder="Search songs, artists, or albums..."
                autocomplete="off"
              >
            </div>
          </div>
          <div class="spotify-playlist-search-content">
            <div class="spotify-playlist-search-loading">Loading songs...</div>
          </div>
          <button class="spotify-playlist-search-close" aria-label="Close search">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      `;

      // Bind events
      const search_input = dialog.querySelector(
        ".spotify-playlist-search-input"
      );
      const close_button = dialog.querySelector(
        ".spotify-playlist-search-close"
      );

      search_input.addEventListener("input", (event) => {
        this.handle_search_input(event.target.value);
      });

      close_button.addEventListener("click", () => {
        dialog.close();
      });

      // Close modal when clicking outside
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
          dialog.close();
        }
      });

      // Handle escape key
      dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          dialog.close();
        }
      });

      return dialog;
    },

    get_current_search_query() {
      const search_input = search_modal?.querySelector(
        ".spotify-playlist-search-input"
      );
      return search_input ? search_input.value.trim() : "";
    },

    async load_playlist_songs() {
      if (!current_playlist_id) {
        this.show_error_state("Unable to get playlist information");
        return;
      }

      if (is_fetching) {
        return;
      }

      is_fetching = true;

      try {
        // Get access token from background script
        const token_response = await chrome.runtime.sendMessage({
          action: "get_access_token",
        });

        if (!token_response.success) {
          this.show_auth_error();
          return;
        }

        const access_token = token_response.access_token;

        if (is_first_fetch) {
          // Progressive loading for first fetch - show songs as they're loaded
          const onPageFetched = async (page_tracks) => {
            const new_songs = page_tracks.map((item) => ({
              id: item.track.id,
              name: item.track.name,
              artists: item.track.artists.map((artist) => artist.name),
              album: item.track.album.name,
              albumUrl: item.track.album.external_urls.spotify,
              albumImage: this.getSmallestAlbumImage(item.track.album.images),
            }));

            playlist_songs.push(...new_songs);

            // Apply current search filter and render
            const current_query = this.get_current_search_query();
            const filtered_songs = this.filter_songs(current_query);
            this.render_songs(filtered_songs);
          };

          await this.fetch_playlist_tracks(
            current_playlist_id,
            access_token,
            onPageFetched
          );

          is_first_fetch = false;
        } else {
          // Complete loading for subsequent fetches
          const tracks_data = await this.fetch_playlist_tracks(
            current_playlist_id,
            access_token
          );

          playlist_songs = tracks_data.map((item) => ({
            id: item.track.id,
            name: item.track.name,
            artists: item.track.artists.map((artist) => artist.name),
            album: item.track.album.name,
            albumUrl: item.track.album.external_urls.spotify,
            albumImage: this.getSmallestAlbumImage(item.track.album.images),
          }));

          // Apply current search filter and render
          const current_query = this.get_current_search_query();
          const filtered_songs = this.filter_songs(current_query);
          this.render_songs(filtered_songs);
        }
      } catch (error) {
        console.error("Error loading playlist songs:", error);
        this.show_error_state("Unable to get playlist songs");
      } finally {
        is_fetching = false;
      }
    },

    async fetch_playlist_tracks(
      playlist_id,
      access_token,
      onPageFetched = null
    ) {
      const all_tracks = [];
      let next_url = `https://api.spotify.com/v1/playlists/${playlist_id}/tracks?limit=50`;

      while (next_url) {
        const response = await fetch(next_url, {
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("Unauthorized - token may be expired");
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const page_tracks = data.items.filter(
          (item) => item.track && item.track.id
        );
        all_tracks.push(...page_tracks);

        // Call the callback with the page tracks if provided
        if (onPageFetched) {
          await onPageFetched(page_tracks);
        }

        next_url = data.next;
      }
      console.log({ all_tracks });
      return all_tracks;
    },

    handle_search_input(query) {
      const filtered_songs = this.filter_songs(query.trim());
      this.render_songs(filtered_songs);
    },

    filter_songs(query) {
      if (!query) {
        return playlist_songs;
      }

      const search_terms = query
        .toLowerCase()
        .split(" ")
        .filter((term) => term.length > 0);

      return playlist_songs.filter((song) => {
        const searchable_text = [song.name, ...song.artists, song.album]
          .join(" ")
          .toLowerCase();

        return search_terms.every((term) => searchable_text.includes(term));
      });
    },

    render_songs(songs) {
      const content_area = search_modal.querySelector(
        ".spotify-playlist-search-content"
      );

      if (songs.length === 0) {
        const message = is_first_fetch ? "Loading songs..." : "No songs found";
        content_area.innerHTML = `<div class="spotify-playlist-search-empty">${message}</div>`;
        return;
      }

      const song_list = document.createElement("div");
      song_list.className = "spotify-playlist-search-list";

      songs.forEach((song) => {
        const song_element = document.createElement("div");
        song_element.className = "spotify-playlist-search-song";

        const albumImageHtml = song.albumImage
          ? `<img src="${this.escape_html(
              song.albumImage
            )}" alt="${this.escape_html(
              song.album
            )}" class="spotify-playlist-search-album-image">`
          : '<div class="spotify-playlist-search-album-image-placeholder"></div>';

        song_element.innerHTML = `
          ${albumImageHtml}
          <div class="spotify-playlist-search-song-info">
            <div class="spotify-playlist-search-song-title">${this.escape_html(
              song.name
            )}</div>
            <div class="spotify-playlist-search-song-artist">${this.escape_html(
              song.artists.join(", ")
            )}</div>
          </div>
          <div class="spotify-playlist-search-song-album">
            <a href="${this.escape_html(
              song.albumUrl
            )}" target="_blank" rel="noopener noreferrer">
              ${this.escape_html(song.album)}
            </a>
          </div>
        `;

        song_list.appendChild(song_element);
      });

      content_area.innerHTML = "";
      content_area.appendChild(song_list);
    },

    show_error_state(message) {
      const content_area = search_modal.querySelector(
        ".spotify-playlist-search-content"
      );
      content_area.innerHTML = `<div class="spotify-playlist-search-error">${this.escape_html(
        message
      )}</div>`;
    },

    show_auth_error() {
      const content_area = search_modal.querySelector(
        ".spotify-playlist-search-content"
      );
      content_area.innerHTML = `
        <div class="spotify-playlist-search-error">
          Please connect to Spotify first.<br>
          Click the extension icon to authenticate.
        </div>
      `;
    },

    getSmallestAlbumImage(images) {
      if (!images || images.length === 0) {
        return null;
      }

      // Find the image with the smallest width
      return images.reduce((smallest, current) => {
        return current.width < smallest.width ? current : smallest;
      }).url;
    },

    escape_html(unsafe) {
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    },
  };

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => playlist_search.init());
  } else {
    playlist_search.init();
  }

  // Re-inject button when navigating within Spotify (SPA navigation)
  let current_url = window.location.href;

  const observer = new MutationObserver(() => {
    if (window.location.href !== current_url) {
      current_url = window.location.href;

      if (playlist_search.is_playlist_page()) {
        // Clear previous state
        playlist_songs = [];
        current_playlist_id = null;
        is_first_fetch = true; // Reset for new playlist

        // Close modal if open
        if (search_modal && search_modal.open) {
          search_modal.close();
        }

        // Reinitialize for new playlist
        setTimeout(() => playlist_search.init(), 500);
      }
    }
  });

  observer.observe(document, { childList: true, subtree: true });
})();
