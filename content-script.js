(function () {
  "use strict";

  const installed_key = "__spotify_playlist_page_search_content_script__";

  if (window[installed_key]) {
    playlist_search_handle_reinjection();
    return;
  }

  window[installed_key] = true;

  const pathfinder_message_type =
    "spotify-playlist-page-search:pathfinder-response";
  const cache_request_type = "spotify-playlist-page-search:request-cache";
  const tracklist_row_selector = '[data-testid="tracklist-row"]';
  const default_row_height = 56;
  const track_index = window.spotify_playlist_track_index;

  let current_url = window.location.href;
  let current_page = get_page_from_url();
  let current_playlist_id = null;
  // Spotify serves Liked Songs as a hidden playlist whose id is only known
  // once the interceptor sees a response for it.
  let liked_songs_playlist_id = null;
  let search_modal = null;
  let navigation_timeout = null;
  let ui_injection_timeout = null;
  let keyboard_navigation_enabled = false;
  let selected_result_index = -1;
  let filtered_tracks = [];
  let page_total_count = null;
  const indexed_tracks = [];
  const indexed_track_keys = new Set();

  const playlist_search = {
    init() {
      current_page = get_page_from_url();

      if (!current_page) {
        return;
      }

      current_playlist_id =
        current_page.type === "liked-songs"
          ? liked_songs_playlist_id
          : current_page.playlist_id;

      request_cached_tracks();
      this.inject_search_button();
      this.inject_jump_to_playing_button();
    },

    inject_search_button() {
      if (!get_page_from_url()) {
        return;
      }

      const action_bar = document.querySelector(
        'div[data-testid="action-bar-row"]',
      );

      if (!action_bar) {
        schedule_ui_injection();
        return;
      }

      if (action_bar.querySelector(".spotify-playlist-search-button")) {
        return;
      }

      document
        .querySelectorAll(".spotify-playlist-search-button")
        .forEach((button) => button.remove());

      // Spotify right-aligns its view/sort control, so inserting before it
      // places the search button right after Spotify's own action buttons.
      action_bar.insertBefore(
        this.create_search_button(),
        get_action_bar_view_control(action_bar),
      );
    },

    create_search_button() {
      const button = document.createElement("button");
      button.className = "spotify-playlist-search-button";
      button.type = "button";
      const page_label = get_page_label(current_page);
      button.setAttribute("aria-label", `Search ${page_label}`);
      button.setAttribute("title", `Search ${page_label}`);
      button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5" fill="none"></circle>
          <path d="m11 11 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
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
      if (!get_page_from_url()) {
        return;
      }

      if (document.querySelector(".spotify-jump-to-playing-button")) {
        return;
      }

      const target_element = document.querySelector(
        'button[data-testid="lyrics-button"], button[data-testid="control-button-queue"]',
      );

      if (!target_element || !target_element.parentNode) {
        schedule_ui_injection();
        return;
      }

      target_element.parentNode.insertBefore(
        this.create_jump_to_playing_button(),
        target_element,
      );
    },

    create_jump_to_playing_button() {
      const button = document.createElement("button");
      button.className = "spotify-jump-to-playing-button";
      button.type = "button";
      button.setAttribute("title", "Jump to playing song");
      button.setAttribute("aria-label", "Jump to playing song");
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="16" height="16" aria-hidden="true">
          <rect x="100" y="120" width="400" height="50" fill="currentColor"></rect>
          <polygon points="100,235 100,365 220,300" fill="currentColor"></polygon>
          <rect x="250" y="275" width="250" height="50" fill="currentColor"></rect>
          <rect x="100" y="430" width="400" height="50" fill="currentColor"></rect>
        </svg>
      `;

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.jump_to_currently_playing_track();
      });

      return button;
    },

    open_search_modal() {
      synchronize_page();

      if (!current_page) {
        return;
      }

      if (!search_modal) {
        search_modal = this.create_search_modal();
        document.body.appendChild(search_modal);
      }

      search_modal.showModal();
      this.render_current_search_state();
      this.focus_search_input();
      this.reset_keyboard_navigation();
    },

    toggle_search_modal() {
      if (search_modal && search_modal.open) {
        search_modal.close();
        return;
      }

      this.open_search_modal();
    },

    create_search_modal() {
      const dialog = document.createElement("dialog");
      dialog.className = "spotify-playlist-search-modal";

      dialog.innerHTML = `
        <div class="spotify-playlist-search-modal-content">
          <div class="spotify-playlist-search-header">
            <h2>Search ${escape_html(get_page_label(current_page))}</h2>
            <div class="spotify-playlist-search-input-container">
              <svg class="spotify-playlist-search-input-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5" fill="none"></circle>
                <path d="m11 11 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
              </svg>
              <input
                type="text"
                class="spotify-playlist-search-input"
                placeholder="Search songs, artists, or albums..."
                autocomplete="off"
              >
            </div>
          </div>
          <div class="spotify-playlist-search-content"></div>
          <button class="spotify-playlist-search-close" type="button" aria-label="Close search">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>
      `;

      const search_input = dialog.querySelector(
        ".spotify-playlist-search-input",
      );
      const close_button = dialog.querySelector(
        ".spotify-playlist-search-close",
      );

      search_input.addEventListener("input", (event) => {
        this.handle_search_input(event.target.value);
      });

      close_button.addEventListener("click", () => {
        dialog.close();
      });

      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
          dialog.close();
        }
      });

      dialog.addEventListener("keydown", (event) => {
        this.handle_modal_keydown(event, search_input);
      });

      return dialog;
    },

    focus_search_input() {
      const search_input = search_modal.querySelector(
        ".spotify-playlist-search-input",
      );

      search_input.focus();

      if (search_input.value.trim()) {
        search_input.select();
      }
    },

    handle_modal_keydown(event, search_input) {
      if (event.key === "Escape") {
        search_modal.close();
        return;
      }

      if (event.target !== search_input && !keyboard_navigation_enabled) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.navigate_to_next_result();
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.navigate_to_previous_result();
      }

      if (event.key === "Enter") {
        this.select_current_result(event);
      }
    },

    handle_search_input(query) {
      filtered_tracks = this.filter_tracks(query.trim());
      this.render_tracks(filtered_tracks);
      this.reset_keyboard_navigation();
    },

    filter_tracks(query) {
      if (!query) {
        return indexed_tracks;
      }

      const search_terms = query
        .toLowerCase()
        .split(" ")
        .filter((term) => term.length > 0);

      return indexed_tracks.filter((track) => {
        const searchable_text = [
          track.name,
          ...track.artists.map((artist) => artist.name),
          track.album,
        ]
          .join(" ")
          .toLowerCase();

        return search_terms.every((term) => searchable_text.includes(term));
      });
    },

    render_tracks(tracks) {
      const content_area = search_modal.querySelector(
        ".spotify-playlist-search-content",
      );

      if (tracks.length === 0) {
        const search_input = search_modal.querySelector(
          ".spotify-playlist-search-input",
        );
        const has_query = Boolean(search_input.value.trim());
        const message = has_query
          ? "No songs found"
          : `${get_page_label(current_page)} tracks are still being indexed.`;

        content_area.innerHTML = `
          <div class="spotify-playlist-search-empty">
            ${escape_html(message)}
          </div>
        `;
        return;
      }

      content_area.innerHTML = "";

      const track_list = document.createElement("div");
      track_list.className = "spotify-playlist-search-list";

      tracks.forEach((track) => {
        track_list.appendChild(this.create_track_result(track));
      });

      content_area.appendChild(track_list);
    },

    create_track_result(track) {
      const track_element = document.createElement("button");
      track_element.className = "spotify-playlist-search-song";
      track_element.type = "button";
      track_element.dataset.track_id = track.id || "";
      track_element.dataset.track_position = String(track.position);

      const artist_names = track.artists.map((artist) => artist.name);
      const album_image_html = track.album_image
        ? `<img src="${escape_html(track.album_image)}" alt="" class="spotify-playlist-search-album-image">`
        : '<div class="spotify-playlist-search-album-image-placeholder"></div>';

      track_element.innerHTML = `
        ${album_image_html}
        <span class="spotify-playlist-search-song-info">
          <span class="spotify-playlist-search-song-title">
            ${escape_html(track.name || "Unknown song")}
          </span>
          <span class="spotify-playlist-search-song-artist">
            ${escape_html(artist_names.join(", ") || "Unknown artist")}
          </span>
        </span>
        <span class="spotify-playlist-search-song-album">
          ${escape_html(track.album || "")}
        </span>
      `;

      track_element.addEventListener("click", () => {
        this.select_track(track);
      });

      return track_element;
    },

    render_current_search_state() {
      if (!search_modal) {
        return;
      }

      const search_input = search_modal.querySelector(
        ".spotify-playlist-search-input",
      );
      filtered_tracks = this.filter_tracks(search_input.value.trim());

      if (indexed_tracks.length === 0) {
        this.show_indexing_placeholder();
        return;
      }

      this.render_tracks(filtered_tracks);
    },

    show_indexing_placeholder() {
      const content_area = search_modal.querySelector(
        ".spotify-playlist-search-content",
      );
      const total_label =
        typeof page_total_count === "number" ? ` of ${page_total_count}` : "";

      content_area.innerHTML = `
        <div class="spotify-playlist-search-loading">
          Indexing ${indexed_tracks.length}${total_label} ${escape_html(get_page_label(current_page))} tracks
        </div>
      `;
    },

    handle_pathfinder_response(payload) {
      if (!payload || payload.kind !== "pathfinder-response" || !payload.ok) {
        return;
      }

      if (!this.is_current_page_payload(payload)) {
        return;
      }

      const total_count = track_index.get_total_count(payload.response_json);

      if (total_count !== null) {
        page_total_count = total_count;
      }

      const tracks = track_index.extract_page_tracks(
        payload.response_json,
        payload.variables,
      );
      const added_count = track_index.add_tracks(
        indexed_tracks,
        indexed_track_keys,
        tracks,
      );

      if (added_count > 0 && search_modal && search_modal.open) {
        this.render_current_search_state();
      }
    },

    is_current_page_payload(payload) {
      if (!current_page || !payload.playlist_id) {
        return false;
      }

      if (
        current_page.type === "liked-songs" &&
        !current_playlist_id &&
        payload.is_liked_songs
      ) {
        adopt_liked_songs_playlist(payload.playlist_id);
      }

      return payload.playlist_id === current_playlist_id;
    },

    reset_keyboard_navigation() {
      keyboard_navigation_enabled = false;
      selected_result_index = -1;
      this.update_selection_display();
    },

    navigate_to_next_result() {
      if (filtered_tracks.length === 0) {
        return;
      }

      keyboard_navigation_enabled = true;
      selected_result_index =
        (selected_result_index + 1) % filtered_tracks.length;
      this.update_selection_display();
      this.scroll_selected_into_view();
    },

    navigate_to_previous_result() {
      if (filtered_tracks.length === 0) {
        return;
      }

      keyboard_navigation_enabled = true;
      selected_result_index =
        selected_result_index <= 0
          ? filtered_tracks.length - 1
          : selected_result_index - 1;
      this.update_selection_display();
      this.scroll_selected_into_view();
    },

    select_current_result(event) {
      if (
        selected_result_index < 0 ||
        selected_result_index >= filtered_tracks.length
      ) {
        return;
      }

      event.preventDefault();
      this.select_track(filtered_tracks[selected_result_index]);
    },

    async select_track(track) {
      const track_element = await find_or_scroll_to_track_element(track);

      if (!track_element) {
        this.show_error_state(
          `Unable to find that song in ${get_page_label(current_page)}.`,
        );
        return;
      }

      click_track_play_button(track_element);
      track_element.scrollIntoView({ behavior: "smooth", block: "center" });

      setTimeout(() => {
        search_modal.close();
      }, 300);
    },

    show_error_state(message) {
      const content_area = search_modal.querySelector(
        ".spotify-playlist-search-content",
      );

      content_area.innerHTML = `
        <div class="spotify-playlist-search-error">
          ${escape_html(message)}
        </div>
      `;
    },

    update_selection_display() {
      if (!search_modal) {
        return;
      }

      const track_elements = search_modal.querySelectorAll(
        ".spotify-playlist-search-song",
      );

      track_elements.forEach((element, index) => {
        element.classList.toggle("selected", index === selected_result_index);
      });
    },

    scroll_selected_into_view() {
      if (!search_modal || selected_result_index < 0) {
        return;
      }

      const track_elements = search_modal.querySelectorAll(
        ".spotify-playlist-search-song",
      );
      const selected_element = track_elements[selected_result_index];

      if (selected_element) {
        selected_element.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      }
    },

    async jump_to_currently_playing_track() {
      const playing_track_element = find_playing_track_in_dom();

      if (playing_track_element) {
        playing_track_element.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        return;
      }

      const now_playing_track = find_now_playing_track_in_index();

      if (!now_playing_track) {
        return;
      }

      const now_playing_element =
        await find_or_scroll_to_track_element(now_playing_track);

      if (now_playing_element) {
        now_playing_element.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    },

    reset_for_navigation() {
      current_url = window.location.href;
      current_page = get_page_from_url();
      current_playlist_id = null;
      keyboard_navigation_enabled = false;
      selected_result_index = -1;
      filtered_tracks = [];
      page_total_count = null;
      indexed_tracks.length = 0;
      indexed_track_keys.clear();

      document.querySelector(".spotify-playlist-search-button")?.remove();
      document.querySelector(".spotify-jump-to-playing-button")?.remove();

      if (search_modal) {
        if (search_modal.open) {
          search_modal.close();
        }

        search_modal.remove();
        search_modal = null;
      }

      this.init();
    },
  };

  function request_cached_tracks() {
    if (!current_page) {
      return;
    }

    window.postMessage(
      {
        type: cache_request_type,
        playlist_id: current_playlist_id,
        liked_songs: current_page.type === "liked-songs",
      },
      window.location.origin,
    );
  }

  function adopt_liked_songs_playlist(playlist_id) {
    liked_songs_playlist_id = playlist_id;
    current_playlist_id = playlist_id;
    request_cached_tracks();
  }

  function synchronize_page() {
    if (get_page_from_url()?.key !== current_page?.key) {
      playlist_search.reset_for_navigation();
    }
  }

  function get_page_from_url(url_value = window.location.href) {
    const url = new URL(url_value);

    if (url.pathname === "/collection/tracks") {
      return { key: "liked-songs", type: "liked-songs" };
    }

    const path_parts = url.pathname.split("/");
    const playlist_index = path_parts.indexOf("playlist");
    const playlist_id =
      playlist_index === -1 ? null : path_parts[playlist_index + 1] || null;

    if (!playlist_id) {
      return null;
    }

    return { key: `playlist:${playlist_id}`, type: "playlist", playlist_id };
  }

  function get_page_label(page) {
    return page?.type === "liked-songs" ? "Liked Songs" : "Playlist";
  }

  function get_action_bar_view_control(action_bar) {
    const view_control = action_bar.querySelector(
      '[data-sortbox-label], button[role="combobox"]',
    );
    let insertion_point = view_control;

    while (insertion_point && insertion_point.parentElement !== action_bar) {
      insertion_point = insertion_point.parentElement;
    }

    return insertion_point;
  }

  function handle_navigation() {
    clearTimeout(navigation_timeout);
    navigation_timeout = setTimeout(() => {
      if (window.location.href === current_url) {
        schedule_ui_injection();
        return;
      }

      current_url = window.location.href;

      if (get_page_from_url()?.key !== current_page?.key) {
        playlist_search.reset_for_navigation();
        return;
      }

      schedule_ui_injection();
    }, 100);
  }

  function schedule_ui_injection() {
    if (!get_page_from_url() || ui_injection_timeout) {
      return;
    }

    ui_injection_timeout = setTimeout(() => {
      ui_injection_timeout = null;
      playlist_search.inject_search_button();
      playlist_search.inject_jump_to_playing_button();
    }, 300);
  }

  function handle_page_message(event) {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }

    if (
      !event.data ||
      event.data.source !== "spotify-playlist-page-search" ||
      event.data.type !== pathfinder_message_type
    ) {
      return;
    }

    synchronize_page();
    playlist_search.handle_pathfinder_response(event.data.payload);
  }

  async function find_or_scroll_to_track_element(track) {
    const rendered_element = find_track_element(track);

    if (rendered_element) {
      return rendered_element;
    }

    return await scroll_to_track_row(track);
  }

  function find_track_element(track) {
    const row_element = get_track_row_by_index(
      track_index.get_track_row_index(track),
    );

    if (row_element && row_matches_track(row_element, track)) {
      return row_element;
    }

    return find_track_element_by_link(track);
  }

  function find_track_element_by_link(track) {
    if (!track.id) {
      return null;
    }

    const links = document.querySelectorAll(`a[href*="/track/${track.id}"]`);

    for (const link of links) {
      const row_element = link.closest(tracklist_row_selector);

      if (row_element) {
        return row_element;
      }
    }

    return null;
  }

  // Spotify virtualizes the track list, so the target row is scrolled toward
  // repeatedly, using the rows that are rendered after each move to refine
  // where the target should be, until it appears.
  async function scroll_to_track_row(track) {
    const target_row_index = track_index.get_track_row_index(track);

    for (let attempt = 0; attempt < 12; attempt++) {
      const grid = get_track_grid();
      const scroll_container = get_scroll_container(grid);

      if (!scroll_container) {
        return null;
      }

      const rendered_rows = get_rendered_rows(grid, scroll_container);
      const rendered_signature = get_rendered_signature(rendered_rows);

      if (rendered_rows.length === 0) {
        scroll_container.scrollTo({ top: 0, behavior: "auto" });
      } else {
        const reference_row =
          target_row_index < rendered_rows[0].row_index
            ? rendered_rows[0]
            : rendered_rows[rendered_rows.length - 1];
        const row_height = track_index.estimate_row_height(
          rendered_rows,
          reference_row.height || default_row_height,
        );
        const target_top = track_index.get_scroll_target_top({
          reference_row_index: reference_row.row_index,
          reference_top: reference_row.top,
          row_height,
          target_row_index,
          client_height: scroll_container.clientHeight,
        });
        const next_scroll_top = clamp_scroll_top(scroll_container, target_top);

        if (Math.abs(next_scroll_top - scroll_container.scrollTop) >= 1) {
          scroll_container.scrollTo({ top: next_scroll_top, behavior: "auto" });
        }
      }

      // Rows render some time after the scroll, so keep waiting even when the
      // container is already at the right offset.
      await wait_for_rendered_rows_change(rendered_signature, 800);

      const row_element = find_track_element(track);

      if (row_element) {
        return row_element;
      }
    }

    return null;
  }

  // Spotify renders several grids on a page: the sidebar library, the track
  // list, and a "Recommended" block that is also marked up as a track list.
  // The playlist grid is the one whose row count matches the playlist.
  function get_track_grid() {
    const grids = [
      ...document.querySelectorAll('[role="grid"][aria-rowcount]'),
    ].filter((grid) => {
      return !grid.closest('[data-testid="recommended-track"]');
    });
    const expected_row_count =
      typeof page_total_count === "number" ? page_total_count + 1 : null;

    return (
      grids.find((grid) => get_grid_row_count(grid) === expected_row_count) ||
      grids.find((grid) => grid.querySelector(tracklist_row_selector)) ||
      null
    );
  }

  function get_grid_row_count(grid) {
    return Number(grid.getAttribute("aria-rowcount"));
  }

  function get_scroll_container(grid) {
    const anchor =
      grid ||
      document.querySelector(tracklist_row_selector) ||
      document.querySelector('div[data-testid="action-bar-row"]');
    let ancestor = anchor?.parentElement || null;

    while (ancestor) {
      if (is_scrollable(ancestor)) {
        return ancestor;
      }

      ancestor = ancestor.parentElement;
    }

    return document.scrollingElement;
  }

  function is_scrollable(element) {
    if (element.scrollHeight <= element.clientHeight + 1) {
      return false;
    }

    if (element.hasAttribute("data-overlayscrollbars-viewport")) {
      return true;
    }

    const overflow_y = window.getComputedStyle(element).overflowY;

    return overflow_y === "auto" || overflow_y === "scroll";
  }

  // Rendered rows are described relative to the scroll content, so their
  // `top` stays meaningful after the container scrolls.
  function get_rendered_rows(grid, scroll_container) {
    if (!grid) {
      return [];
    }

    const container_top =
      scroll_container.getBoundingClientRect().top - scroll_container.scrollTop;

    return [...grid.querySelectorAll('[role="row"][aria-rowindex]')]
      .map((row) => {
        const row_element = row.querySelector(tracklist_row_selector);
        const row_index = Number(row.getAttribute("aria-rowindex"));

        if (!row_element || !Number.isFinite(row_index)) {
          return null;
        }

        const rect = row.getBoundingClientRect();

        return {
          row_index,
          top: rect.top - container_top,
          height: rect.height,
        };
      })
      .filter(Boolean)
      .sort((first, second) => first.row_index - second.row_index);
  }

  function get_rendered_signature(rendered_rows) {
    return rendered_rows.map((row) => row.row_index).join(",");
  }

  function get_track_row_by_index(row_index) {
    const grid = get_track_grid();

    if (!grid) {
      return null;
    }

    return grid.querySelector(
      `[role="row"][aria-rowindex="${row_index}"] ${tracklist_row_selector}`,
    );
  }

  function row_matches_track(row_element, track) {
    const track_links = row_element.querySelectorAll('a[href*="/track/"]');

    if (track_links.length === 0 || !track.id) {
      return true;
    }

    return [...track_links].some((link) => {
      return link.getAttribute("href").includes(`/track/${track.id}`);
    });
  }

  async function wait_for_rendered_rows_change(previous_signature, timeout) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      await delay(50);

      const grid = get_track_grid();
      const scroll_container = get_scroll_container(grid);

      if (!scroll_container) {
        return;
      }

      const signature = get_rendered_signature(
        get_rendered_rows(grid, scroll_container),
      );

      if (signature !== previous_signature) {
        return;
      }
    }
  }

  function clamp_scroll_top(scroll_container, scroll_top) {
    const max_scroll_top = Math.max(
      scroll_container.scrollHeight - scroll_container.clientHeight,
      0,
    );

    return Math.min(Math.max(scroll_top, 0), max_scroll_top);
  }

  function click_track_play_button(track_element) {
    const buttons = track_element.querySelectorAll("button");

    for (const button of buttons) {
      const label = button.getAttribute("aria-label") || "";

      if (label.startsWith("Play ") || label.includes(" Play ")) {
        button.click();
        return;
      }
    }
  }

  function find_playing_track_in_dom() {
    const buttons = document.querySelectorAll(`${tracklist_row_selector} button`);

    for (const button of buttons) {
      const label = button.getAttribute("aria-label") || "";

      if (label.startsWith("Pause ")) {
        return button.closest(tracklist_row_selector);
      }
    }

    return null;
  }

  function find_now_playing_track_in_index() {
    const title_element = document.querySelector(
      '[data-testid="context-item-info-title"]',
    );

    if (!title_element) {
      return null;
    }

    const title = normalize_search_text(title_element.textContent);
    const artist_element = document.querySelector(
      '[data-testid="context-item-info-artist"]',
    );
    const artist = normalize_search_text(artist_element?.textContent || "");

    return indexed_tracks.find((track) => {
      if (normalize_search_text(track.name) !== title) {
        return false;
      }

      if (!artist) {
        return true;
      }

      return track.artists.some((track_artist) => {
        return artist.includes(normalize_search_text(track_artist.name));
      });
    });
  }

  function delay(milliseconds) {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  function normalize_search_text(value) {
    return String(value || "")
      .toLowerCase()
      .trim();
  }

  function escape_html(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => playlist_search.init(),
      { once: true },
    );
  } else {
    playlist_search.init();
  }

  window.addEventListener("popstate", handle_navigation);
  window.addEventListener("message", handle_page_message);

  const observer = new MutationObserver(handle_navigation);
  start_dom_observer();

  window.spotify_playlist_page_search_reinject = function reinject() {
    if (get_page_from_url()?.key !== current_page?.key) {
      playlist_search.reset_for_navigation();
      return;
    }

    schedule_ui_injection();
  };

  chrome.runtime.onMessage.addListener((request, sender, send_response) => {
    if (request.action === "toggle-search") {
      playlist_search.toggle_search_modal();
      send_response({ success: true });
    }
  });

  function start_dom_observer() {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      return;
    }

    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (document.body) {
          observer.observe(document.body, { childList: true, subtree: true });
        }
      },
      { once: true },
    );
  }

  function playlist_search_handle_reinjection() {
    if (typeof window.spotify_playlist_page_search_reinject === "function") {
      window.spotify_playlist_page_search_reinject();
    }
  }
})();
