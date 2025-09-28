// Spotify Playlist Page Search - Content Script

(function () {
  "use strict";

  let playlist_songs = [];
  let current_playlist_id = null;
  let search_modal = null;
  let is_fetching = false;
  let is_first_fetch = true;
  let keyboard_navigation_enabled = false;
  let selected_result_index = -1;
  let filtered_songs = [];

  const playlist_search = {
    init() {
      this.inject_search_button();
      this.inject_jump_to_playing_button();
      this.extract_playlist_id();
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
      const existing_search_button = document.querySelector(
        ".spotify-playlist-search-button"
      );
      if (existing_search_button) {
        existing_search_button.remove();
      }

      // Also remove existing jump button
      const existing_jump_button = document.querySelector(
        ".spotify-jump-to-playing-button"
      );
      if (existing_jump_button) {
        existing_jump_button.remove();
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

    inject_jump_to_playing_button() {
      // Remove existing button if it exists
      const existing_button = document.querySelector(
        ".spotify-jump-to-playing-button"
      );
      if (existing_button) {
        existing_button.remove();
      }

      // Find the target element (control-button-npv)
      const target_element = document.querySelector(
        'button[data-testid="control-button-npv"]'
      );

      if (target_element) {
        const jump_button = this.create_jump_to_playing_button();
        target_element.parentNode.insertBefore(jump_button, target_element);
      } else {
        // Retry after a short delay if elements aren't ready
        setTimeout(() => this.inject_jump_to_playing_button(), 1000);
      }
    },

    create_jump_to_playing_button() {
      const button = document.createElement("button");
      button.className =
        "spotify-jump-to-playing-button Button-sc-1dqy6lx-0 fprjoI e-91000-overflow-wrap-anywhere e-91000-button-tertiary--icon-only pJ7RQa2Lqdi9JOvfKGAA";
      button.setAttribute("title", "Jump to playing song");
      button.setAttribute("aria-label", "Jump to playing song");
      button.setAttribute("data-encore-id", "buttonTertiary");
      button.innerHTML = `
        <span aria-hidden="true" class="e-91000-button__icon-wrapper">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="16" height="16" role="img" aria-label="Playlist icon" class="e-91000-icon e-91000-baseline" style="--encore-icon-height: var(--encore-graphic-size-decorative-smaller); --encore-icon-width: var(--encore-graphic-size-decorative-smaller);">
            <!-- Top line -->
            <rect x="100" y="120" width="400" height="50" fill="currentColor"/>
            <!-- Middle row -->
            <!-- Right-pointing triangle, vertically centered between top and bottom -->
            <polygon points="100,235 100,365 220,300" fill="currentColor"/>
            <!-- Middle line -->
            <rect x="250" y="275" width="250" height="50" fill="currentColor"/>
            <!-- Bottom line -->
            <rect x="100" y="430" width="400" height="50" fill="currentColor"/>
          </svg>
        </span>
      `;

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.jump_to_currently_playing_track();
      });

      return button;
    },

    async open_search_modal() {
      if (search_modal) {
        search_modal.showModal();

        // Focus and highlight existing text in the search input
        const search_input = search_modal.querySelector(
          ".spotify-playlist-search-input"
        );
        search_input.focus();
        if (search_input.value.trim()) {
          search_input.select();
        }

        // Reset keyboard navigation state
        this.reset_keyboard_navigation();
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

      // Reset keyboard navigation state
      this.reset_keyboard_navigation();

      // Load playlist songs
      await this.load_playlist_songs();
    },

    async toggle_search_modal() {
      console.log("toggle_search_modal called");

      if (search_modal && search_modal.open) {
        console.log("Closing search modal");
        search_modal.close();
      } else {
        console.log("Opening search modal");
        await this.open_search_modal();
      }
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

      // Handle escape key and arrow navigation
      dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          dialog.close();
          return;
        }

        // Only handle navigation keys when search input has focus or navigation is enabled
        if (event.target === search_input || keyboard_navigation_enabled) {
          switch (event.key) {
            case "ArrowDown":
              event.preventDefault();
              this.navigate_to_next_result();
              break;
            case "ArrowUp":
              event.preventDefault();
              this.navigate_to_previous_result();
              break;
            case "Enter":
              if (
                selected_result_index >= 0 &&
                selected_result_index < filtered_songs.length
              ) {
                event.preventDefault();
                const selected_song = filtered_songs[selected_result_index];
                this.select_song(selected_song.id);
              }
              break;
          }
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
              artists: item.track.artists.map((artist) => ({
                name: artist.name,
                url: artist.external_urls.spotify,
              })),
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
            artists: item.track.artists.map((artist) => ({
              name: artist.name,
              url: artist.external_urls.spotify,
            })),
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
      filtered_songs = this.filter_songs(query.trim());
      this.render_songs(filtered_songs);
      this.reset_keyboard_navigation();
    },

    reset_keyboard_navigation() {
      keyboard_navigation_enabled = false;
      selected_result_index = -1;
      this.update_selection_display();
    },

    navigate_to_next_result() {
      if (filtered_songs.length === 0) return;

      keyboard_navigation_enabled = true;
      selected_result_index =
        (selected_result_index + 1) % filtered_songs.length;
      this.update_selection_display();
      this.scroll_selected_into_view();
    },

    navigate_to_previous_result() {
      if (filtered_songs.length === 0) return;

      keyboard_navigation_enabled = true;
      selected_result_index =
        selected_result_index <= 0
          ? filtered_songs.length - 1
          : selected_result_index - 1;
      this.update_selection_display();
      this.scroll_selected_into_view();
    },

    update_selection_display() {
      const song_elements = search_modal.querySelectorAll(
        ".spotify-playlist-search-song"
      );
      song_elements.forEach((element, index) => {
        if (index === selected_result_index) {
          element.classList.add("selected");
        } else {
          element.classList.remove("selected");
        }
      });
    },

    scroll_selected_into_view() {
      if (selected_result_index < 0) return;

      const song_elements = search_modal.querySelectorAll(
        ".spotify-playlist-search-song"
      );
      const selected_element = song_elements[selected_result_index];

      if (selected_element) {
        selected_element.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      }
    },

    select_song(track_id) {
      this.scrollToAndHighlightTrack(track_id);
      // Close the modal after a short delay
      setTimeout(() => {
        search_modal.close();
      }, 300);
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
        const searchable_text = [
          song.name,
          ...song.artists.map((artist) => artist.name),
          song.album,
        ]
          .join(" ")
          .toLowerCase();

        return search_terms.every((term) => searchable_text.includes(term));
      });
    },

    render_songs(songs) {
      filtered_songs = songs; // Store for keyboard navigation
      const content_area = search_modal.querySelector(
        ".spotify-playlist-search-content"
      );

      if (songs.length === 0) {
        const message = is_first_fetch ? "Loading songs..." : "No songs found";
        content_area.innerHTML = `<div class="spotify-playlist-search-empty">${message}</div>`;
        this.reset_keyboard_navigation();
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
            <div class="spotify-playlist-search-song-title">
              <a href="#" class="spotify-playlist-search-track-link" data-track-id="${this.escape_html(
                song.id
              )}">
                ${this.escape_html(song.name)}
              </a>
            </div>
            <div class="spotify-playlist-search-song-artist">
              ${song.artists
                .map(
                  (artist) =>
                    `<a href="${this.escape_html(
                      artist.url
                    )}">${this.escape_html(artist.name)}</a>`
                )
                .join(", ")}
            </div>
          </div>
          <div class="spotify-playlist-search-song-album">
            <a href="${this.escape_html(song.albumUrl)}">
              ${this.escape_html(song.album)}
            </a>
          </div>
        `;

        // Add click handler for track title
        const trackLink = song_element.querySelector(
          ".spotify-playlist-search-track-link"
        );
        if (trackLink) {
          trackLink.addEventListener("click", (event) => {
            event.preventDefault();
            const trackId = event.target.getAttribute("data-track-id");
            this.scrollToAndHighlightTrack(trackId);
            // Close the modal after a short delay
            setTimeout(() => {
              search_modal.close();
            }, 300);
          });
        }

        // Add click handler for the entire song element
        song_element.addEventListener("click", (event) => {
          // Don't handle clicks if they're on links (let those handle themselves)
          if (event.target.tagName === "A" || event.target.closest("a")) {
            return;
          }

          event.preventDefault();
          const trackId = song.id;
          this.scrollToAndHighlightTrack(trackId);
          // Close the modal after a short delay
          setTimeout(() => {
            search_modal.close();
          }, 300);
        });

        song_list.appendChild(song_element);
      });

      content_area.innerHTML = "";
      content_area.appendChild(song_list);

      // Reset keyboard navigation when new results are rendered
      this.reset_keyboard_navigation();
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
          Please connect to Spotify.<br>
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

    async scrollToAndHighlightTrack(trackId) {
      try {
        // First, try to find the track in the current DOM
        let trackElement = await this.waitForTrackAndFind(trackId, 3000); // Increased from 2000ms

        if (!trackElement) {
          // Track not found in DOM, need to scroll to load it
          console.log(
            "Track not in current DOM, attempting to scroll to load it..."
          );
          await this.scrollToLoadTrack(trackId);

          trackElement = await this.waitForTrackAndFind(trackId, 30000);
        }

        if (trackElement) {
          this.clickTrackPlayButton(trackElement, trackId);

          // Scroll to the track
          trackElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });

          console.log(
            "Successfully scrolled to and highlighted track:",
            trackId
          );
        } else {
          console.warn(
            "Track not found in DOM after scrolling attempts:",
            trackId
          );
        }
      } catch (error) {
        console.warn("Could not find/highlight track:", error);
      }
    },

    clickTrackPlayButton(trackElement, trackId) {
      try {
        // Look for the play button within the track row
        // The button has aria-label that includes "Play [track name] by [artist]"
        const playButton = trackElement.querySelector(
          'button[aria-label*="Play"]'
        );

        if (playButton) {
          console.log(
            "Found play button, clicking to start playback for track:",
            trackId
          );
          playButton.click();
        } else {
          // Fallback: try other selectors for the play button
          const fallbackSelectors = [
            "button.y3wrMu2sPRR2DCdEpWlg", // The specific class from markup
            'button[tabindex="-1"]', // Play buttons often have tabindex="-1"
            'button svg[viewBox="0 0 24 24"]', // Look for button containing the play icon SVG
          ];

          for (const selector of fallbackSelectors) {
            const button = trackElement.querySelector(selector);
            if (button && button.getAttribute("aria-label")?.includes("Play")) {
              console.log(
                "Found play button via fallback selector, clicking for track:",
                trackId
              );
              button.click();
              return;
            }
          }

          console.warn("Could not find play button for track:", trackId);
        }
      } catch (error) {
        console.error("Error clicking play button:", error);
      }
    },

    /**
     * Robustly scrolls the playlist container until the track is found in the DOM.
     * Will keep scrolling in small increments until the track is loaded or a max number of attempts is reached.
     */
    async scrollToLoadTrack(trackId) {
      const trackIndex = playlist_songs.findIndex(
        (song) => song.id === trackId
      );
      if (trackIndex === -1) {
        console.warn("Track not found in playlist data:", trackId);
        return;
      }
      const playlistContainer = this.findPlaylistContainer();
      if (!playlistContainer) {
        console.warn("Could not find playlist container for scrolling");
        return;
      }
      const rowHeight = 56;
      const headerHeight = 64;
      const maxAttempts = 40; // up to ~40 scrolls (should be enough for huge playlists)
      let attempt = 0;
      let found = false;
      let lastScrollTop = -1;
      let direction = 1; // always scroll down for now
      while (attempt < maxAttempts) {
        // Calculate where we want to scroll
        const targetScrollPosition =
          headerHeight + (trackIndex + 1) * rowHeight;
        playlistContainer.scrollTo({
          top: targetScrollPosition,
          behavior: "auto",
        });
        // Wait for DOM to update
        await new Promise((resolve) => setTimeout(resolve, 700));
        // Check if the track is now present
        const trackLinks = document.querySelectorAll(
          `a[href="/track/${trackId}"]`
        );
        for (const link of trackLinks) {
          const row =
            link.closest('[data-testid="tracklist-row"]') ||
            link.closest('[role="row"]');
          if (row) {
            found = true;
            break;
          }
        }
        if (found) break;
        // If not found, nudge the scroll position a bit further (in case virtualization is lagging)
        playlistContainer.scrollBy({
          top: direction * rowHeight * 3,
          behavior: "auto",
        });
        // If the scroll position isn't changing, break to avoid infinite loop
        if (playlistContainer.scrollTop === lastScrollTop) break;
        lastScrollTop = playlistContainer.scrollTop;
        attempt++;
      }
      if (!found) {
        console.warn(
          "Track not found after repeated scroll attempts:",
          trackId
        );
      }
    },

    findPlaylistContainer() {
      // Try the overlayscrollbars viewport first
      const overlayViewport = document.querySelector(
        "[data-overlayscrollbars-viewport]"
      );
      if (
        overlayViewport &&
        overlayViewport.scrollHeight > overlayViewport.clientHeight
      ) {
        console.log("Using overlayscrollbars viewport as scroll container");
        return overlayViewport;
      }

      // Try other specific selectors
      const selectors = [
        ".main-view-container__scroll-node",
        ".main-view-container .os-viewport",
        '[role="grid"]',
        '[data-testid="playlist-tracklist"]',
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.scrollHeight > element.clientHeight) {
          console.log("Found scrollable element:", selector);
          return element;
        }
      }

      // More aggressive fallback: find ANY scrollable element in the main content area
      const mainSelectors = [
        ".main-view-container",
        ".Root__main-view",
        "main",
        '[role="main"]',
        "#main",
      ];

      for (const mainSelector of mainSelectors) {
        const mainContent = document.querySelector(mainSelector);
        if (mainContent) {
          // Check if the main content itself is scrollable
          if (
            mainContent.scrollHeight > mainContent.clientHeight &&
            mainContent.clientHeight > 200
          ) {
            console.log(
              "Using main content area as scroll container:",
              mainSelector
            );
            return mainContent;
          }

          // Look for any scrollable child element
          const allElements = mainContent.querySelectorAll("*");
          for (const element of allElements) {
            if (
              element.scrollHeight > element.clientHeight &&
              element.clientHeight > 300 && // Must be reasonably large
              element.scrollHeight > element.clientHeight + 100
            ) {
              // Must have significant scroll content
              console.log("Found fallback scrollable container");
              return element;
            }
          }
        }
      }

      // Last resort: use document.documentElement or document.body
      if (
        document.documentElement &&
        document.documentElement.scrollHeight >
          document.documentElement.clientHeight
      ) {
        console.log("Using document.documentElement as scroll container");
        return document.documentElement;
      }

      if (
        document.body &&
        document.body.scrollHeight > document.body.clientHeight
      ) {
        console.log("Using document.body as scroll container");
        return document.body;
      }

      console.warn("Could not find any playlist scroll container");
      return null;
    },

    async waitForTrackAndFind(trackId, timeout = 15000) {
      const start = Date.now();
      const trackIndex = playlist_songs.findIndex(
        (song) => song.id === trackId
      );
      const rowHeight = 56;
      const headerHeight = 64;
      const playlistContainer = this.findPlaylistContainer();

      console.log(
        "Starting track search for:",
        trackId,
        "at index:",
        trackIndex
      );
      console.log(
        "Using scroll container:",
        playlistContainer ? "found" : "NOT FOUND"
      );

      if (!playlistContainer) {
        // If we can't find a scroll container, just try to find the track as-is
        console.warn(
          "No scroll container found, attempting to find track without scrolling"
        );
        const trackLinks = document.querySelectorAll(
          `a[href="/track/${trackId}"]`
        );
        for (const link of trackLinks) {
          const row =
            link.closest('[data-testid="tracklist-row"]') ||
            link.closest('[role="row"]');
          if (row) {
            console.log("Found track without scrolling");
            return row;
          }
        }
        throw new Error("No scroll container found and track not visible");
      }

      let lastScrollTop = -1;
      let attempt = 0;
      const maxAttempts = Math.ceil(timeout / 500);

      const findTrackElement = () => {
        const trackLinks = document.querySelectorAll(
          `a[href="/track/${trackId}"]`
        );
        console.log("Found", trackLinks.length, "track links for:", trackId);
        for (const link of trackLinks) {
          const row =
            link.closest('[data-testid="tracklist-row"]') ||
            link.closest('[role="row"]');
          if (row) {
            console.log("Found track row for:", trackId);
            return row;
          }
        }
        return null;
      };

      return new Promise((resolve, reject) => {
        const interval = setInterval(() => {
          let found = findTrackElement();
          if (found) {
            console.log("Successfully found track after", attempt, "attempts");
            clearInterval(interval);
            resolve(found);
            return;
          }

          // If not found and we have container info, try scrolling
          if (trackIndex !== -1) {
            const targetScrollPosition =
              headerHeight + (trackIndex + 1) * rowHeight;
            const currentScroll = playlistContainer.scrollTop;

            console.log(
              "Attempt",
              attempt,
              "- Current scroll:",
              currentScroll,
              "Target:",
              targetScrollPosition
            );

            // If we're not close to the target, scroll closer
            if (
              Math.abs(currentScroll - targetScrollPosition) >
              rowHeight * 3
            ) {
              playlistContainer.scrollTo({
                top: targetScrollPosition,
                behavior: "auto",
              });
            } else {
              // If we're close, try small nudges in both directions
              const nudgeAmount =
                attempt % 2 === 0 ? rowHeight * 2 : -rowHeight * 2;
              playlistContainer.scrollBy({
                top: nudgeAmount,
                behavior: "auto",
              });
            }

            // If the scroll position isn't changing, we might be stuck
            if (Math.abs(playlistContainer.scrollTop - lastScrollTop) < 5) {
              console.warn(
                "Scroll position not changing, trying different approach"
              );
              // Try scrolling to beginning and then to target
              if (attempt < maxAttempts / 2) {
                playlistContainer.scrollTo({ top: 0, behavior: "auto" });
              }
            }
            lastScrollTop = playlistContainer.scrollTop;
          }

          attempt++;
          if (Date.now() - start > timeout || attempt > maxAttempts) {
            console.error(
              "Timeout after",
              attempt,
              "attempts. Final scroll position:",
              playlistContainer.scrollTop
            );
            clearInterval(interval);
            reject(new Error("Timeout finding track"));
          }
        }, 500);
      });
    },

    async jump_to_currently_playing_track() {
      try {
        const playing_track_element = await this.find_currently_playing_track();

        if (playing_track_element) {
          // Scroll the playing track into view
          playing_track_element.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });

          console.log("Successfully jumped to currently playing track");
        } else {
          console.log("No currently playing track found in playlist");
        }
      } catch (error) {
        console.warn("Could not jump to currently playing track:", error);
      }
    },

    async find_currently_playing_track() {
      // First, try to find the track in the current DOM
      let playing_element = this.find_playing_track_in_dom();

      if (playing_element) {
        return playing_element;
      }

      // If not found, start from top and scroll down quickly
      const playlist_container = this.findPlaylistContainer();
      if (!playlist_container) {
        console.warn("Could not find playlist container for scrolling");
        return null;
      }

      // Start at the top of the playlist
      playlist_container.scrollTo({
        top: 0,
        behavior: "auto",
      });

      // Wait for initial load
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check if it's at the top
      playing_element = this.find_playing_track_in_dom();
      if (playing_element) {
        return playing_element;
      }

      // Get scroll parameters
      const total_height = playlist_container.scrollHeight;
      const viewport_height = playlist_container.clientHeight;
      const max_scroll = total_height - viewport_height;

      // Scroll down in larger increments for speed
      const scroll_increment = viewport_height * 0.8; // Scroll 80% of viewport at a time
      let current_scroll = 0;

      while (current_scroll < max_scroll) {
        current_scroll = Math.min(
          current_scroll + scroll_increment,
          max_scroll
        );

        playlist_container.scrollTo({
          top: current_scroll,
          behavior: "auto",
        });

        // Shorter wait time for faster scanning
        await new Promise((resolve) => setTimeout(resolve, 100));

        playing_element = this.find_playing_track_in_dom();
        if (playing_element) {
          return playing_element;
        }
      }

      return null;
    },

    find_playing_track_in_dom() {
      // Look for a button with aria-label="Pause" within tracklist rows
      const pause_buttons = document.querySelectorAll(
        'div[data-testid="tracklist-row"] button[aria-label="Pause"]'
      );

      for (const button of pause_buttons) {
        const row = button.closest('div[role="row"]');
        if (row) {
          return row;
        }
      }

      return null;
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

      // Clear previous state
      playlist_songs = [];
      current_playlist_id = null;
      is_first_fetch = true; // Reset for new playlist
      filtered_songs = [];
      keyboard_navigation_enabled = false;
      selected_result_index = -1;

      // Close modal if open
      if (search_modal && search_modal.open) {
        search_modal.close();
      }

      // Reinitialize for new playlist
      setTimeout(() => playlist_search.init(), 500);
    }
  });

  observer.observe(document, { childList: true, subtree: true });

  // Listen for authentication state changes from the popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Content script received message:", request);

    if (request.action === "toggle-search") {
      console.log("Toggling search modal");
      playlist_search.toggle_search_modal();
      sendResponse({ success: true });
      return;
    }

    if (request.action === "auth_state_changed") {
      console.log("Authentication state changed:", request.authenticated);

      if (request.authenticated && search_modal && search_modal.open) {
        // If search modal is open and we just got authenticated, try to load songs
        const content_area = search_modal.querySelector(
          ".spotify-playlist-search-content"
        );
        if (
          content_area &&
          content_area.innerHTML.includes("Please connect to Spotify")
        ) {
          console.log(
            "Re-attempting to load playlist songs after authentication"
          );
          // Close and reopen the modal to trigger a fresh load
          search_modal.close();
          setTimeout(() => {
            playlist_search.open_search_modal();
          }, 100);
        }
      } else if (!request.authenticated && search_modal && search_modal.open) {
        // If search modal is open and we just disconnected, show auth error
        console.log("User disconnected while search modal was open");
        playlist_search.show_auth_error();
      }

      sendResponse({ success: true });
    }
  });
})();
