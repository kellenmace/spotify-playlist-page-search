(function () {
  "use strict";

  const pathfinder_message_type =
    "spotify-playlist-page-search:pathfinder-response";

  let current_url = window.location.href;
  let current_playlist_id = null;
  let search_modal = null;
  let navigation_timeout = null;
  let keyboard_navigation_enabled = false;
  let selected_result_index = -1;
  let filtered_tracks = [];
  let playlist_total_count = null;
  let indexing_state = "idle";
  const indexed_tracks = [];
  const indexed_track_keys = new Set();

  const playlist_search = {
    init() {
      current_playlist_id = get_playlist_id_from_url();
      indexing_state = "listening";
      inject_page_fetch_interceptor();
      this.inject_search_button();
      this.inject_jump_to_playing_button();
    },

    inject_search_button() {
      const existing_search_button = document.querySelector(
        ".spotify-playlist-search-button",
      );

      if (existing_search_button) {
        existing_search_button.remove();
      }

      let target_element = document.querySelector(
        'button[data-testid="more-button"]',
      );

      if (!target_element) {
        const action_bar = document.querySelector(
          'div[data-testid="action-bar-row"]',
        );

        if (action_bar) {
          const buttons = action_bar.querySelectorAll("button");
          target_element = buttons[buttons.length - 1];
        }
      }

      if (!target_element || !target_element.parentNode) {
        setTimeout(() => this.inject_search_button(), 1000);
        return;
      }

      target_element.parentNode.insertBefore(
        this.create_search_button(),
        target_element,
      );
    },

    create_search_button() {
      const button = document.createElement("button");
      button.className = "spotify-playlist-search-button";
      button.type = "button";
      button.setAttribute("aria-label", "Search playlist");
      button.setAttribute("title", "Search playlist");
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
      const existing_button = document.querySelector(
        ".spotify-jump-to-playing-button",
      );

      if (existing_button) {
        existing_button.remove();
      }

      const target_element = document.querySelector(
        'button[data-testid="lyrics-button"]',
      );

      if (!target_element || !target_element.parentNode) {
        setTimeout(() => this.inject_jump_to_playing_button(), 1000);
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

    async open_search_modal() {
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
            <h2>Search Playlist</h2>
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
          : "Playlist tracks are still being indexed.";

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
      track_element.dataset.track_uri = track.uri || "";

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

      track_element.addEventListener("click", async () => {
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
        typeof playlist_total_count === "number"
          ? ` of ${playlist_total_count}`
          : "";

      content_area.innerHTML = `
        <div class="spotify-playlist-search-loading">
          Indexing ${indexed_tracks.length}${total_label} playlist tracks
        </div>
      `;
    },

    handle_pathfinder_response(payload) {
      if (!payload) {
        return;
      }

      if (!this.is_current_playlist_payload(payload)) {
        return;
      }

      if (payload.kind === "quiet-replay-status") {
        this.handle_quiet_replay_status(payload);
        return;
      }

      if (payload.kind !== "pathfinder-response" || !payload.ok) {
        return;
      }

      const total_count = get_playlist_total_count(payload.response_json);

      if (typeof total_count === "number") {
        playlist_total_count = total_count;
      }

      const tracks = extract_tracks_from_response(payload.response_json);
      const added_count = add_tracks_to_index(tracks);

      if (
        typeof playlist_total_count === "number" &&
        indexed_tracks.length >= playlist_total_count
      ) {
        indexing_state = "ready";
      }

      if (search_modal && search_modal.open) {
        this.render_current_search_state();
      }
    },

    is_current_playlist_payload(payload) {
      if (!payload.playlist_id) {
        return false;
      }

      return payload.playlist_id === current_playlist_id;
    },

    handle_quiet_replay_status(payload) {
      if (payload.status === "started") {
        indexing_state = "quiet-indexing";
      }

      if (payload.status === "failed") {
        indexing_state = "listening";
      }

      if (payload.status === "completed") {
        indexing_state = "ready";
      }

      if (search_modal && search_modal.open && indexed_tracks.length === 0) {
        this.show_indexing_placeholder();
      }
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
      const track_element = await this.find_or_scroll_to_track_element(track);

      if (!track_element) {
        this.show_error_state("Unable to find that song in the playlist.");
        return;
      }

      this.click_track_play_button(track_element);
      track_element.scrollIntoView({ behavior: "smooth", block: "center" });

      setTimeout(() => {
        search_modal.close();
      }, 300);
    },

    async find_or_scroll_to_track_element(track) {
      let track_element = this.find_track_element(track);

      if (track_element) {
        return track_element;
      }

      const scroll_container = get_playlist_scroll_container();

      if (!scroll_container) {
        return null;
      }

      const track_index = get_indexed_track_position(track);

      if (track_index === -1) {
        return null;
      }

      await scroll_to_indexed_track(scroll_container, track_index);
      track_element = await wait_for_track_element(track, 1500);

      if (track_element) {
        return track_element;
      }

      return await nudge_until_track_is_rendered(scroll_container, track);
    },

    find_track_element(track) {
      const track_id = track.id || get_track_id(track);

      if (!track_id) {
        return null;
      }

      const links = document.querySelectorAll(`a[href*="/track/${track_id}"]`);

      for (const link of links) {
        const row =
          link.closest('[data-testid="tracklist-row"]') ||
          link.closest('[role="row"]');

        if (row) {
          return row;
        }
      }

      return null;
    },

    click_track_play_button(track_element) {
      const buttons = track_element.querySelectorAll("button");

      for (const button of buttons) {
        const label = button.getAttribute("aria-label") || "";

        if (label.startsWith("Play ") || label.includes("Play ")) {
          button.click();
          return;
        }
      }
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
      const playing_track = this.find_playing_track_in_dom();

      if (playing_track) {
        playing_track.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        return;
      }

      const now_playing_track = this.find_now_playing_track_in_index();

      if (!now_playing_track) {
        return;
      }

      const now_playing_element =
        await this.find_or_scroll_to_track_element(now_playing_track);

      if (now_playing_element) {
        now_playing_element.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    },

    find_playing_track_in_dom() {
      const buttons = document.querySelectorAll(
        '[data-testid="tracklist-row"] button',
      );

      for (const button of buttons) {
        const label = button.getAttribute("aria-label");

        if (label && label.includes("Pause")) {
          return button.closest('[role="row"]');
        }
      }

      return null;
    },

    find_now_playing_track_in_index() {
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
    },

    reset_for_navigation() {
      current_playlist_id = get_playlist_id_from_url();
      keyboard_navigation_enabled = false;
      selected_result_index = -1;
      filtered_tracks = [];
      playlist_total_count = null;
      indexing_state = "listening";
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

      setTimeout(() => this.init(), 500);
    },
  };

  function inject_page_fetch_interceptor() {
    const existing_script = document.querySelector(
      'script[data-spotify-playlist-page-search="fetch-interceptor"]',
    );

    if (existing_script) {
      return;
    }

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-fetch-interceptor.js");
    script.dataset.spotifyPlaylistPageSearch = "fetch-interceptor";
    script.onload = function handle_script_load() {
      script.remove();
    };

    (document.head || document.documentElement).appendChild(script);
  }

  function get_playlist_id_from_url() {
    const url = new URL(window.location.href);
    const path_parts = url.pathname.split("/");
    const playlist_index = path_parts.indexOf("playlist");

    if (playlist_index === -1) {
      return null;
    }

    return path_parts[playlist_index + 1] || null;
  }

  function handle_navigation() {
    clearTimeout(navigation_timeout);
    navigation_timeout = setTimeout(() => {
      if (window.location.href === current_url) {
        return;
      }

      current_url = window.location.href;

      if (get_playlist_id_from_url() !== current_playlist_id) {
        playlist_search.reset_for_navigation();
      }
    }, 100);
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

    playlist_search.handle_pathfinder_response(event.data.payload);
  }

  function get_playlist_total_count(response_json) {
    const total_count = response_json?.data?.playlistV2?.content?.totalCount;

    return Number.isFinite(total_count) ? total_count : null;
  }

  function extract_tracks_from_response(response_json) {
    const tracks = [];
    const seen_objects = new WeakSet();
    walk_response(response_json, seen_objects, (value) => {
      const track = normalize_track(value);

      if (track) {
        tracks.push(track);
      }
    });

    return tracks;
  }

  function walk_response(value, seen_objects, visitor) {
    if (!value || typeof value !== "object") {
      return;
    }

    if (seen_objects.has(value)) {
      return;
    }

    seen_objects.add(value);
    visitor(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        walk_response(item, seen_objects, visitor);
      }

      return;
    }

    for (const child of Object.values(value)) {
      walk_response(child, seen_objects, visitor);
    }
  }

  function normalize_track(value) {
    const track_data = get_track_data(value);

    if (!track_data) {
      return null;
    }

    const uri = get_string(track_data.uri || track_data.itemUri);
    const id = get_track_id(track_data);

    if (!id && !uri) {
      return null;
    }

    const name = get_string(
      track_data.name || track_data.title || track_data.profile?.name,
    );

    return {
      id,
      uri,
      name,
      artists: normalize_artists(track_data),
      album: normalize_album_name(track_data),
      album_url: normalize_album_url(track_data),
      album_image: normalize_album_image(track_data),
      duration: normalize_duration(track_data),
      playlist_offset: normalize_playlist_offset(value),
    };
  }

  function get_track_data(value) {
    const candidates = [
      value,
      value.item,
      value.itemV2,
      value.itemV2?.data,
      value.track,
      value.track?.data,
    ];

    for (const candidate of candidates) {
      const uri = get_string(candidate?.uri || candidate?.itemUri);

      if (uri && uri.startsWith("spotify:track:")) {
        return candidate;
      }
    }

    return null;
  }

  function get_track_id(track_data) {
    const id = get_string(track_data.id);

    if (id) {
      return id;
    }

    const uri = get_string(track_data.uri || track_data.itemUri);

    if (!uri || !uri.startsWith("spotify:track:")) {
      return null;
    }

    return uri.split(":").pop();
  }

  function normalize_artists(track_data) {
    const artist_items =
      track_data.artists?.items ||
      track_data.artists ||
      track_data.firstArtist?.items ||
      [];

    if (!Array.isArray(artist_items)) {
      return [];
    }

    return artist_items
      .map((artist) => {
        const artist_data = artist?.profile ? artist : artist?.data || artist;
        const name = get_string(
          artist_data?.profile?.name || artist_data?.name,
        );
        const uri = get_string(artist_data?.uri);

        if (!name) {
          return null;
        }

        return {
          name,
          uri,
          url: uri ? get_spotify_url_from_uri(uri) : "",
        };
      })
      .filter(Boolean);
  }

  function normalize_album_name(track_data) {
    return get_string(
      track_data.albumOfTrack?.name ||
        track_data.album?.name ||
        track_data.albumOfTrack?.profile?.name ||
        track_data.album?.profile?.name,
    );
  }

  function normalize_album_url(track_data) {
    const uri = get_string(
      track_data.albumOfTrack?.uri || track_data.album?.uri,
    );

    return uri ? get_spotify_url_from_uri(uri) : "";
  }

  function normalize_album_image(track_data) {
    const sources =
      track_data.albumOfTrack?.coverArt?.sources ||
      track_data.album?.coverArt?.sources ||
      track_data.albumOfTrack?.coverArt?.extractedColors?.sources ||
      track_data.coverArt?.sources ||
      [];

    if (!Array.isArray(sources) || sources.length === 0) {
      return "";
    }

    const sorted_sources = [...sources].sort((a, b) => {
      return (
        (a.width || Number.MAX_SAFE_INTEGER) -
        (b.width || Number.MAX_SAFE_INTEGER)
      );
    });

    return get_string(sorted_sources[0]?.url);
  }

  function normalize_duration(track_data) {
    const total_milliseconds =
      track_data.duration?.totalMilliseconds ||
      track_data.duration_ms ||
      track_data.durationMs;

    return Number.isFinite(total_milliseconds) ? total_milliseconds : null;
  }

  function normalize_playlist_offset(value) {
    const offset =
      value.offset ||
      value.position ||
      value.index ||
      value.rowIndex ||
      value.uid;

    return Number.isFinite(offset) ? offset : null;
  }

  function add_tracks_to_index(tracks) {
    let added_count = 0;

    for (const track of tracks) {
      const key = track.id || track.uri;

      if (!key || indexed_track_keys.has(key)) {
        continue;
      }

      indexed_track_keys.add(key);
      indexed_tracks.push(track);
      added_count++;
    }

    return added_count;
  }

  function get_string(value) {
    return typeof value === "string" ? value : "";
  }

  function get_spotify_url_from_uri(uri) {
    const parts = uri.split(":");

    if (parts.length < 3) {
      return "";
    }

    return `https://open.spotify.com/${parts[1]}/${parts[2]}`;
  }

  function get_indexed_track_position(track) {
    const track_id = track.id || "";
    const track_uri = track.uri || "";

    if (!track_id && !track_uri) {
      return -1;
    }

    return indexed_tracks.findIndex((indexed_track) => {
      return (
        (track_id && indexed_track.id === track_id) ||
        (track_uri && indexed_track.uri === track_uri)
      );
    });
  }

  async function scroll_to_indexed_track(scroll_container, track_index) {
    const row_height = get_estimated_track_row_height();
    const header_offset = get_tracklist_header_offset();
    const target_top = Math.max(
      header_offset +
        track_index * row_height -
        scroll_container.clientHeight / 2,
      0,
    );

    scroll_container.scrollTo({
      top: Math.min(target_top, get_max_scroll_top(scroll_container)),
      behavior: "auto",
    });

    await delay(250);
  }

  function get_estimated_track_row_height() {
    const rows = [
      ...document.querySelectorAll('[data-testid="tracklist-row"]'),
    ];

    if (rows.length >= 2) {
      const first_rect = rows[0].getBoundingClientRect();
      const last_rect = rows[rows.length - 1].getBoundingClientRect();
      const estimated_height =
        (last_rect.top - first_rect.top) / (rows.length - 1);

      if (estimated_height >= 36 && estimated_height <= 96) {
        return estimated_height;
      }
    }

    if (rows.length === 1) {
      const row_height = rows[0].getBoundingClientRect().height;

      if (row_height >= 36 && row_height <= 96) {
        return row_height;
      }
    }

    return 56;
  }

  function get_tracklist_header_offset() {
    const first_row = document.querySelector('[data-testid="tracklist-row"]');
    const scroll_container = get_playlist_scroll_container();

    if (!first_row || !scroll_container) {
      return 96;
    }

    return Math.max(first_row.offsetTop - scroll_container.offsetTop, 0);
  }

  async function wait_for_track_element(track, timeout) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const track_element = playlist_search.find_track_element(track);

      if (track_element) {
        return track_element;
      }

      await delay(100);
    }

    return null;
  }

  async function nudge_until_track_is_rendered(scroll_container, track) {
    const row_height = get_estimated_track_row_height();
    const nudge_offsets = [
      row_height * 6,
      -row_height * 6,
      row_height * 12,
      -row_height * 12,
      row_height * 20,
      -row_height * 20,
    ];

    for (const offset of nudge_offsets) {
      scroll_container.scrollTo({
        top: clamp_scroll_top(
          scroll_container,
          scroll_container.scrollTop + offset,
        ),
        behavior: "auto",
      });

      const track_element = await wait_for_track_element(track, 500);

      if (track_element) {
        return track_element;
      }
    }

    return null;
  }

  function get_max_scroll_top(scroll_container) {
    return Math.max(
      scroll_container.scrollHeight - scroll_container.clientHeight,
      0,
    );
  }

  function clamp_scroll_top(scroll_container, scroll_top) {
    return Math.min(
      Math.max(scroll_top, 0),
      get_max_scroll_top(scroll_container),
    );
  }

  function get_playlist_scroll_container() {
    const candidates = get_scrollable_candidates();

    return candidates[0] || null;
  }

  function get_scrollable_candidates() {
    const candidates = [];
    const seen_elements = new Set();

    add_scrollable_candidate(
      candidates,
      seen_elements,
      document.querySelector('[data-testid="playlist-tracklist"]'),
    );

    document
      .querySelectorAll("[data-overlayscrollbars-viewport]")
      .forEach((element) => {
        add_scrollable_candidate(candidates, seen_elements, element);
      });

    const row = document.querySelector('[data-testid="tracklist-row"]');

    if (row) {
      let ancestor = row.parentElement;

      while (ancestor) {
        add_scrollable_candidate(candidates, seen_elements, ancestor);
        ancestor = ancestor.parentElement;
      }
    }

    add_scrollable_candidate(
      candidates,
      seen_elements,
      document.querySelector('[role="grid"]'),
    );

    add_scrollable_candidate(
      candidates,
      seen_elements,
      document.scrollingElement,
    );

    return candidates.sort((first, second) => {
      return (
        get_scroll_candidate_score(second) - get_scroll_candidate_score(first)
      );
    });
  }

  function add_scrollable_candidate(candidates, seen_elements, element) {
    if (!element || seen_elements.has(element)) {
      return;
    }

    seen_elements.add(element);

    if (!is_scrollable_candidate(element)) {
      return;
    }

    candidates.push(element);
  }

  function is_scrollable_candidate(element) {
    if (element.clientHeight < 250) {
      return false;
    }

    if (element.scrollHeight <= element.clientHeight + 100) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const overflow_y = style.overflowY;

    return (
      overflow_y === "auto" ||
      overflow_y === "scroll" ||
      element === document.scrollingElement ||
      element.hasAttribute("data-overlayscrollbars-viewport")
    );
  }

  function get_scroll_candidate_score(element) {
    let score = 0;

    if (element.hasAttribute("data-overlayscrollbars-viewport")) {
      score += 100;
    }

    if (element.querySelector('[data-testid="tracklist-row"]')) {
      score += 80;
    }

    if (element.querySelector('[data-testid="playlist-tracklist"]')) {
      score += 40;
    }

    score += Math.min(
      element.scrollHeight / Math.max(element.clientHeight, 1),
      20,
    );

    return score;
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
      {
        once: true,
      },
    );
  } else {
    playlist_search.init();
  }

  window.addEventListener("popstate", handle_navigation);
  window.addEventListener("message", handle_page_message);

  const observer = new MutationObserver(handle_navigation);
  observer.observe(document.body, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((request, sender, send_response) => {
    if (request.action === "toggle-search") {
      playlist_search.toggle_search_modal();
      send_response({ success: true });
    }
  });
})();
