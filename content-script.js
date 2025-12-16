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
  let debug_logging = true; // Toggle verbose diagnostics for scrolling

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
        'button[data-testid="lyrics-button"]'
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
      if (search_modal && search_modal.open) {
        search_modal.close();
      } else {
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
        // 1. Fast path: track already rendered
        let trackElement = this.findTrackElementFast(trackId);

        // 2. Indexed scroll attempt (aim near where track should be)
        if (!trackElement) {
          await this.scrollToLoadTrack(trackId);
          trackElement = this.findTrackElementFast(trackId);
        }

        // 3. Timed wait with adaptive nudging
        if (!trackElement) {
          try {
            trackElement = await this.waitForTrackAndFind(trackId, 15000);
          } catch (e) {
            // Ignore timeout here; will log below if still not found
          }
        }

        if (trackElement) {
          this.clickTrackPlayButton(trackElement, trackId);
          trackElement.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          console.warn("Track not found after all strategies:", trackId);
        }
      } catch (error) {
        console.warn("Could not find/highlight track:", error);
      }
    },

    findTrackElementFast(trackId) {
      // Accept links that may include query params or suffixes (e.g. ?si=...)
      const links = document.querySelectorAll(`a[href*="/track/${trackId}"]`);
      for (const link of links) {
        const row =
          link.closest('[data-testid="tracklist-row"]') ||
          link.closest('[role="row"]');
        if (row) return row;
      }
      return null;
    },

    getScrollableContainers() {
      const results = [];
      const seen = new Set();
      const pushUnique = (el, origin) => {
        if (!el || seen.has(el)) return;
        // Must be visible
        if (!el.offsetParent && el !== document.documentElement) return;

        seen.add(el);
        results.push(el);
        if (debug_logging) {
          const sh = el.scrollHeight,
            ch = el.clientHeight;
          console.log(
            "[getScrollableContainers] add",
            origin,
            "scrollH",
            sh,
            "clientH",
            ch,
            "ratio",
            ch ? (sh / ch).toFixed(2) : "n/a"
          );
        }
      };
      const baseSelectors = [
        '[data-testid="playlist-tracklist"] [data-overlayscrollbars-viewport]',
        '[data-testid="playlist-tracklist"] .os-viewport',
        ".main-view-container__scroll-node",
        ".main-view-container .os-viewport",
        "[data-overlayscrollbars-viewport]",
        ".os-viewport",
        'main[role="main"]',
        "main",
        ".main-view-container",
      ];
      baseSelectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => pushUnique(el, sel));
      });

      // Filter out non-scrollable
      const filtered = results.filter((el) => {
        return el.scrollHeight > el.clientHeight + 50;
      });

      // Rank: prefer known classes, then ratio
      filtered.sort((a, b) => {
        const getScore = (el) => {
          let score = 0;
          if (el.matches("[data-overlayscrollbars-viewport], .os-viewport"))
            score += 100;
          if (el.matches(".main-view-container__scroll-node")) score += 90;
          if (el.tagName === "MAIN") score += 10;
          return score;
        };

        const scoreA = getScore(a);
        const scoreB = getScore(b);

        if (scoreA !== scoreB) return scoreB - scoreA;

        const ra = a.scrollHeight / (a.clientHeight || 1);
        const rb = b.scrollHeight / (b.clientHeight || 1);
        return rb - ra;
      });
      return filtered;
    },

    // Removed experimental materializeTrackRow & getPrimaryTracklistScrollContainer (rollback)

    clickTrackPlayButton(trackElement, trackId) {
      try {
        // Look for the play button within the track row
        // The button has aria-label that includes "Play [track name] by [artist]"
        const playButton = trackElement.querySelector(
          'button[aria-label*="Play"]'
        );

        if (playButton) {
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
      const containers = this.getScrollableContainers();
      if (containers.length === 0) {
        console.warn("No scrollable containers discovered");
        return;
      }
      // Attempt to derive row height from a visible track row
      let rowHeight = 56;
      const sampleRow = document.querySelector('[data-testid="tracklist-row"]');
      if (sampleRow) {
        const rect = sampleRow.getBoundingClientRect();
        if (rect && rect.height > 30 && rect.height < 120) {
          rowHeight = rect.height;
        }
      }
      // Improved estimation using first & last visible rows
      const rows = Array.from(
        document.querySelectorAll('[data-testid="tracklist-row"]')
      );
      if (rows.length >= 2) {
        const firstRect = rows[0].getBoundingClientRect();
        const lastRect = rows[rows.length - 1].getBoundingClientRect();
        const approx = (lastRect.top - firstRect.top) / (rows.length - 1);
        if (approx > 30 && approx < 120) rowHeight = approx;
      }
      const headerHeight = 64;
      const targetOffset = headerHeight + (trackIndex + 1) * rowHeight;
      for (const container of containers) {
        // Skip non-overflow candidates where scrollHeight ~ clientHeight
        if (
          !(container.scrollHeight > container.clientHeight + 50) ||
          container.clientHeight > container.scrollHeight - 5
        ) {
          continue;
        }
        if (debug_logging)
          console.log(
            "[scrollToLoadTrack] attempt container",
            container.className || container.id || container.tagName,
            "index",
            trackIndex,
            "targetOffset",
            targetOffset,
            "rowHeight",
            rowHeight,
            "sh/ch",
            container.scrollHeight,
            "/",
            container.clientHeight
          );
        container.scrollTo({
          top: Math.max(targetOffset - container.clientHeight / 2, 0),
          behavior: "auto",
        });
        await new Promise((r) => setTimeout(r, 250));
        if (this.findTrackElementFast(trackId)) return;
        // Nudge pattern
        for (let j = 0; j < 6; j++) {
          if (this.findTrackElementFast(trackId)) return;
          const dir = j % 2 === 0 ? 1 : -1;
          container.scrollBy({
            top: dir * rowHeight * (j < 3 ? 6 : 12),
            behavior: "auto",
          });
          await new Promise((r) => setTimeout(r, 180));
        }
        // Brute sweep small window around target if still not found
        if (!this.findTrackElementFast(trackId)) {
          const sweepSpan = container.clientHeight * 0.8;
          const base = Math.max(targetOffset - sweepSpan, 0);
          for (
            let pos = base;
            pos < base + sweepSpan * 2;
            pos += rowHeight * 15
          ) {
            container.scrollTo({
              top: Math.min(
                pos,
                container.scrollHeight - container.clientHeight
              ),
              behavior: "auto",
            });
            await new Promise((r) => setTimeout(r, 140));
            if (this.findTrackElementFast(trackId)) return;
          }
        }
        if (this.findTrackElementFast(trackId)) return; // final check for this container
      }
    },

    getScrollableCandidates() {
      const candidates = [];
      // Primary: explicit playlist tracklist container
      const tracklist = document.querySelector(
        '[data-testid="playlist-tracklist"]'
      );
      if (tracklist) {
        // If the tracklist itself scrolls
        if (tracklist.scrollHeight > tracklist.clientHeight + 50) {
          candidates.push(tracklist);
        }
        // Common internal viewport wrappers
        const internalSelectors = [
          "[data-overlayscrollbars-viewport]",
          ".os-viewport",
        ];
        internalSelectors.forEach((sel) => {
          const el = tracklist.querySelector(sel);
          if (el && el.scrollHeight > el.clientHeight + 50) {
            candidates.push(el);
          }
        });
      }

      // Secondary: derive container from existing track rows if tracklist not found yet
      if (candidates.length === 0) {
        const anyRow = document.querySelector('[data-testid="tracklist-row"]');
        if (anyRow) {
          // Walk up ancestors to find first sizable scrollable
          let ancestor = anyRow.parentElement;
          while (ancestor) {
            if (
              ancestor.scrollHeight > ancestor.clientHeight + 100 &&
              ancestor.clientHeight > 200
            ) {
              candidates.push(ancestor);
              break;
            }
            ancestor = ancestor.parentElement;
          }
        }
      }

      // Tertiary fallback: generic main content grid
      if (candidates.length === 0) {
        const generic =
          document.querySelector('[role="grid"]') ||
          document.querySelector(".main-view-container__scroll-node");
        if (generic && generic.scrollHeight > generic.clientHeight + 50) {
          candidates.push(generic);
        }
      }

      return candidates;
    },

    // Removed ensureTrackVisible & waitShort (rollback)

    findPlaylistContainer() {
      // Try the overlayscrollbars viewport first
      const overlayViewport = document.querySelector(
        "[data-overlayscrollbars-viewport]"
      );
      if (
        overlayViewport &&
        overlayViewport.scrollHeight > overlayViewport.clientHeight
      ) {
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
        return document.documentElement;
      }

      if (
        document.body &&
        document.body.scrollHeight > document.body.clientHeight
      ) {
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
      const containers = this.getScrollableContainers();
      if (containers.length === 0) {
        console.warn("No containers for waitForTrackAndFind");
        return null;
      }
      let containerIndex = 0;
      let playlistContainer = containers[containerIndex];
      const advanceContainer = () => {
        containerIndex = (containerIndex + 1) % containers.length;
        playlistContainer = containers[containerIndex];
        if (debug_logging)
          console.log(
            "[waitForTrackAndFind] switching container to",
            playlistContainer.className ||
              playlistContainer.id ||
              playlistContainer.tagName
          );
      };

      let lastScrollTop = -1;
      let attempt = 0;
      const maxAttempts = Math.ceil(timeout / 500);

      const findTrackElement = () => {
        const trackLinks = document.querySelectorAll(
          `a[href*="/track/${trackId}"]`
        );
        for (const link of trackLinks) {
          const row =
            link.closest('[data-testid="tracklist-row"]') ||
            link.closest('[role="row"]');
          if (row) return row;
        }
        return null;
      };

      return new Promise((resolve, reject) => {
        const interval = setInterval(() => {
          const found = findTrackElement();
          if (found) {
            clearInterval(interval);
            resolve(found);
            return;
          }

          if (trackIndex !== -1) {
            const targetScrollPosition =
              headerHeight + (trackIndex + 1) * rowHeight;
            const currentScroll = playlistContainer.scrollTop;
            if (
              Math.abs(currentScroll - targetScrollPosition) >
              rowHeight * 3
            ) {
              playlistContainer.scrollTo({
                top: targetScrollPosition,
                behavior: "auto",
              });
            } else {
              const nudgeAmount =
                attempt % 2 === 0 ? rowHeight * 2 : -rowHeight * 2;
              playlistContainer.scrollBy({
                top: nudgeAmount,
                behavior: "auto",
              });
            }
            if (Math.abs(playlistContainer.scrollTop - lastScrollTop) < 5) {
              if (debug_logging)
                console.warn("[waitForTrackAndFind] stagnation");
              advanceContainer();
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
      const playPauseButton = document.querySelector(
        'button[data-testid="control-button-playpause"]'
      );

      if (playPauseButton) {
        const ariaLabel = playPauseButton.getAttribute("aria-label");
        const isPlaying = ariaLabel === "Pause";

        // No song is playing. Don't attempt to jump to it.
        if (!isPlaying) return;
      }

      try {
        const playing_track_element = await this.find_currently_playing_track();

        if (playing_track_element) {
          // Scroll the playing track into view
          playing_track_element.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } else {
        }
      } catch (error) {
        console.warn("Could not jump to currently playing track:", error);
      }
    },

    async find_currently_playing_track() {
      // 1. Try to find the track in the current DOM (fastest)
      let playing_element = this.find_playing_track_in_dom();
      if (playing_element) return playing_element;

      // 2. Try to identify the playing track from the footer and jump to it
      const playingInfo = this.get_now_playing_info();
      if (playingInfo) {
        const trackIndex = this.find_track_index(playingInfo);
        if (trackIndex !== -1) {
          if (debug_logging)
            console.log(
              "[find_currently_playing_track] Jumping to index",
              trackIndex
            );

          const containers = this.getScrollableContainers();
          for (const container of containers) {
            // Estimate position: header + index * rowHeight
            // Row height is approx 56px
            const estimatedTop = 64 + trackIndex * 56;

            container.scrollTo({
              top: Math.max(0, estimatedTop - 200), // Scroll a bit above
              behavior: "auto",
            });

            await new Promise((r) => setTimeout(r, 150));

            playing_element = this.find_playing_track_in_dom();
            if (playing_element) return playing_element;

            // Try a small scan around the area
            for (let offset of [-300, 300, 600]) {
              container.scrollBy({ top: offset, behavior: "auto" });
              await new Promise((r) => setTimeout(r, 100));
              playing_element = this.find_playing_track_in_dom();
              if (playing_element) return playing_element;
            }
          }
        }
      }

      // 3. Fallback: Scan all containers from top to bottom
      const containers = this.getScrollableContainers();
      if (containers.length === 0) {
        console.warn("Could not find any scrollable containers");
        return null;
      }

      if (debug_logging) {
        console.log(
          `[find_currently_playing_track] Found ${containers.length} containers`
        );
      }

      for (const container of containers) {
        if (debug_logging) {
          console.log(
            "[find_currently_playing_track] Scanning container:",
            container
          );
        }

        // Start from top
        container.scrollTo({
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
        const total_height = container.scrollHeight;
        const viewport_height = container.clientHeight;

        // Skip if not scrollable
        if (total_height <= viewport_height) {
          continue;
        }

        const max_scroll = total_height - viewport_height;

        // Scroll down in larger increments for speed
        const scroll_increment = viewport_height * 0.9; // Scroll 90% of viewport
        let current_scroll = 0;
        let found_in_this_container = false;

        while (current_scroll < max_scroll) {
          current_scroll = Math.min(
            current_scroll + scroll_increment,
            max_scroll
          );

          container.scrollTo({
            top: current_scroll,
            behavior: "auto",
          });

          // Wait for virtualization to render - reduced time
          await new Promise((resolve) => setTimeout(resolve, 100));

          playing_element = this.find_playing_track_in_dom();
          if (playing_element) {
            found_in_this_container = true;
            break;
          }
        }

        if (found_in_this_container) {
          return playing_element;
        }
      }

      return null;
    },

    get_now_playing_info() {
      // Try to get track name from the Now Playing widget in the footer
      const titleEl = document.querySelector(
        '[data-testid="context-item-info-title"]'
      );
      if (!titleEl) return null;

      const title = titleEl.textContent || "";
      // Artist is usually in a sibling or child
      const artistEl = document.querySelector(
        '[data-testid="context-item-info-artist"]'
      );
      const artist = artistEl ? artistEl.textContent : "";

      return { title, artist };
    },

    find_track_index(info) {
      if (!info || !info.title) return -1;

      const clean = (s) => (s || "").toLowerCase().trim();
      const targetTitle = clean(info.title);
      const targetArtist = clean(info.artist);

      return playlist_songs.findIndex((song) => {
        if (clean(song.name) !== targetTitle) return false;
        // If artist is available, check it too (loose match)
        if (targetArtist && song.artists) {
          return song.artists.some((a) => targetArtist.includes(clean(a.name)));
        }
        return true;
      });
    },

    find_playing_track_in_dom() {
      // Look for a button with aria-label containing "Pause" within tracklist rows
      const buttons = document.querySelectorAll(
        'div[data-testid="tracklist-row"] button'
      );

      for (const button of buttons) {
        const label = button.getAttribute("aria-label");
        if (label && label.includes("Pause")) {
          const row = button.closest('div[role="row"]');
          if (row) {
            return row;
          }
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
  let navigation_timeout;

  function handle_navigation() {
    // This function is called on URL change.
    // It resets the extension state and re-initializes it.

    // Clear previous state
    playlist_songs = [];
    current_playlist_id = null;
    is_first_fetch = true; // Reset for new playlist
    filtered_songs = [];
    keyboard_navigation_enabled = false;
    selected_result_index = -1;

    // Close and remove modal if it exists
    if (search_modal) {
      if (search_modal.open) {
        search_modal.close();
      }
      // Remove the modal from the DOM to force recreation
      search_modal.remove();
      search_modal = null;
    }

    // Reinitialize for new page
    // Use a timeout to ensure the DOM is updated after navigation
    setTimeout(() => playlist_search.init(), 500);
  }

  function on_url_change() {
    // Debounce navigation events to avoid multiple triggers
    clearTimeout(navigation_timeout);
    navigation_timeout = setTimeout(() => {
      if (window.location.href !== current_url) {
        current_url = window.location.href;
        handle_navigation();
      }
    }, 100); // 100ms debounce interval
  }

  // Listen for history changes (back/forward buttons)
  window.addEventListener("popstate", on_url_change);

  // Observe DOM changes for SPA navigation (clicking links)
  const observer = new MutationObserver(on_url_change);
  observer.observe(document.body, { childList: true, subtree: true });

  // Listen for authentication state changes from the popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "toggle-search") {
      playlist_search.toggle_search_modal();
      sendResponse({ success: true });
      return;
    }

    if (request.action === "auth_state_changed") {
      if (request.authenticated && search_modal && search_modal.open) {
        // If search modal is open and we just got authenticated, try to load songs
        const content_area = search_modal.querySelector(
          ".spotify-playlist-search-content"
        );
        if (
          content_area &&
          content_area.innerHTML.includes("Please connect to Spotify")
        ) {
          // Close and reopen the modal to trigger a fresh load
          search_modal.close();
          setTimeout(() => {
            playlist_search.open_search_modal();
          }, 100);
        }
      } else if (!request.authenticated && search_modal && search_modal.open) {
        // If search modal is open and we just disconnected, show auth error
        playlist_search.show_auth_error();
      }

      sendResponse({ success: true });
    }
  });
})();
