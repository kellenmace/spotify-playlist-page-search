(function () {
  "use strict";

  const installed_key = "__spotify_playlist_page_search_fetch_interceptor__";
  const message_type = "spotify-playlist-page-search:pathfinder-response";
  const cache_request_type = "spotify-playlist-page-search:request-cache";
  const pathfinder_url = "https://api-partner.spotify.com/pathfinder/v2/query";
  const playlist_operations = new Set(["fetchPlaylist", "fetchPlaylistContents"]);
  const max_quiet_index_tracks = 6000;
  const quiet_index_batch_size = 1000;
  const quiet_index_concurrency = 2;

  if (window[installed_key]) {
    return;
  }

  window[installed_key] = true;

  const original_fetch = window.fetch;
  const playlist_states = new Map();
  // Spotify serves Liked Songs as a hidden playlist. Its id is only learned
  // from a fetchPlaylist response whose format is "liked-songs".
  let liked_songs_playlist_id = null;
  let liked_songs_wanted = false;

  window.addEventListener("message", handle_cache_request);

  window.fetch = async function spotify_playlist_page_search_fetch(
    input,
    init
  ) {
    const request_info = await get_request_info(input, init);
    const response = await original_fetch.apply(this, arguments);

    if (request_info) {
      observe_playlist_response(request_info, response);
    }

    return response;
  };

  async function get_request_info(input, init) {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : String(input);
    const method = (init?.method || request?.method || "GET").toUpperCase();

    if (url !== pathfinder_url || method !== "POST") {
      return null;
    }

    const body_text = await get_request_body_text(input, init);
    const body_json = parse_json(body_text);
    const variables = normalize_variables(body_json?.variables);
    const operation_name = body_json?.operationName || null;
    const playlist_id = get_playlist_id_from_uri(variables?.uri);

    if (!playlist_operations.has(operation_name) || !playlist_id) {
      return null;
    }

    return {
      url,
      method,
      headers: sanitize_replay_headers(
        serialize_headers(init?.headers || request?.headers)
      ),
      body_json,
      credentials: init?.credentials || request?.credentials || "same-origin",
      mode: init?.mode || request?.mode || "cors",
      cache: init?.cache || request?.cache || "default",
      redirect: init?.redirect || request?.redirect || "follow",
      referrer: init?.referrer || request?.referrer || document.referrer,
      referrer_policy:
        init?.referrerPolicy ||
        request?.referrerPolicy ||
        "strict-origin-when-cross-origin",
      operation_name,
      variables,
      playlist_id,
      quiet_replay: false,
    };
  }

  async function get_request_body_text(input, init) {
    if (typeof init?.body === "string") {
      return init.body;
    }

    if (init?.body instanceof URLSearchParams) {
      return init.body.toString();
    }

    if (input instanceof Request) {
      try {
        return await input.clone().text();
      } catch (error) {
        return "";
      }
    }

    return "";
  }

  function serialize_headers(headers) {
    if (!headers) {
      return {};
    }

    if (headers instanceof Headers) {
      return Object.fromEntries(headers.entries());
    }

    if (Array.isArray(headers)) {
      return Object.fromEntries(headers);
    }

    return { ...headers };
  }

  function sanitize_replay_headers(headers) {
    const sanitized_headers = {};
    const blocked_prefixes = ["sec-", "proxy-"];
    const blocked_names = new Set([
      "accept-encoding",
      "connection",
      "content-length",
      "cookie",
      "host",
      "origin",
      "referer",
    ]);

    for (const [name, value] of Object.entries(headers)) {
      const lower_name = name.toLowerCase();

      if (
        blocked_names.has(lower_name) ||
        blocked_prefixes.some((prefix) => lower_name.startsWith(prefix))
      ) {
        continue;
      }

      sanitized_headers[name] = value;
    }

    return sanitized_headers;
  }

  function observe_playlist_response(request_info, response) {
    response
      .clone()
      .json()
      .then((response_json) => {
        handle_playlist_response(request_info, response, response_json);
      })
      .catch((error) => {
        post_message({
          kind: "parse-error",
          operation_name: request_info.operation_name,
          playlist_id: request_info.playlist_id,
          status: response.status,
          error: error.message,
        });
      });
  }

  function handle_playlist_response(request_info, response, response_json) {
    const state = get_playlist_state(request_info.playlist_id);
    const playlist = response_json?.data?.playlistV2;
    const total_count = playlist?.content?.totalCount;

    if (playlist?.format === "liked-songs") {
      state.is_liked_songs = true;
      liked_songs_playlist_id = request_info.playlist_id;

      if (liked_songs_wanted) {
        state.wanted = true;
      }
    }

    if (response.ok && Number.isFinite(total_count)) {
      state.total_count = total_count;
    }

    if (response.ok && request_info.body_json && !request_info.quiet_replay) {
      state.template_request = request_info;
    }

    post_playlist_page(state, request_info, response, response_json);
    maybe_start_quiet_indexing(state);
  }

  function post_playlist_page(state, request_info, response, response_json) {
    const payload = {
      kind: "pathfinder-response",
      operation_name: request_info.operation_name,
      playlist_id: request_info.playlist_id,
      is_liked_songs: state.is_liked_songs,
      variables: request_info.variables,
      quiet_replay: request_info.quiet_replay,
      status: response.status,
      ok: response.ok,
      response_json,
    };

    if (response.ok) {
      const offset = request_info.variables?.offset || 0;
      const limit = request_info.variables?.limit || 0;
      state.responses.set(`${offset}:${limit}`, payload);
    }

    post_message(payload);
  }

  function handle_cache_request(event) {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data?.type !== cache_request_type
    ) {
      return;
    }

    if (event.data.liked_songs) {
      liked_songs_wanted = true;
    }

    const playlist_id = event.data.liked_songs
      ? liked_songs_playlist_id
      : event.data.playlist_id;

    if (!playlist_id) {
      return;
    }

    // Only playlists the content script asks about are fully indexed, so the
    // playlists Spotify fetches for its sidebar or Home page are left alone.
    const state = get_playlist_state(playlist_id);
    state.wanted = true;

    for (const payload of state.responses.values()) {
      post_message({ ...payload, is_liked_songs: state.is_liked_songs });
    }

    maybe_start_quiet_indexing(state);
  }

  function maybe_start_quiet_indexing(state) {
    if (
      state.started ||
      !state.wanted ||
      !state.template_request ||
      !Number.isFinite(state.total_count)
    ) {
      return;
    }

    state.started = true;
    replay_playlist_contents(state.template_request, state.total_count);
  }

  async function replay_playlist_contents(template_request, total_count) {
    const capped_total = Math.min(total_count, max_quiet_index_tracks);
    const offsets = [];

    for (
      let offset = 0;
      offset < capped_total;
      offset += quiet_index_batch_size
    ) {
      offsets.push(offset);
    }

    post_quiet_replay_status("started", template_request.playlist_id, {
      total_count,
      max_quiet_index_tracks,
      batch_size: quiet_index_batch_size,
      request_count: offsets.length,
      concurrency: quiet_index_concurrency,
    });

    try {
      await run_with_concurrency(
        offsets,
        quiet_index_concurrency,
        async (offset) => {
          await replay_playlist_page(
            template_request,
            offset,
            Math.min(quiet_index_batch_size, capped_total - offset)
          );
        }
      );

      post_quiet_replay_status("completed", template_request.playlist_id, {
        total_count,
        requested_track_count: capped_total,
      });
    } catch (error) {
      post_quiet_replay_status("failed", template_request.playlist_id, {
        reason: error.message,
        total_count,
      });
    }
  }

  async function replay_playlist_page(template_request, offset, limit) {
    const replay_body = create_replay_body(template_request.body_json, {
      limit,
      offset,
    });

    if (!replay_body) {
      throw new Error("Unable to create replay body");
    }

    const response = await original_fetch.call(window, template_request.url, {
      method: template_request.method,
      headers: template_request.headers,
      body: replay_body,
      credentials: template_request.credentials,
      mode: template_request.mode,
      cache: template_request.cache,
      redirect: template_request.redirect,
      referrer: template_request.referrer,
      referrerPolicy: template_request.referrer_policy,
    });
    const response_json = await response.clone().json();
    const replay_body_json = JSON.parse(replay_body);

    handle_playlist_response(
      {
        ...template_request,
        body_json: replay_body_json,
        variables: normalize_variables(replay_body_json.variables),
        quiet_replay: true,
      },
      response,
      response_json
    );

    if (!response.ok) {
      throw new Error(`Quiet replay request failed with ${response.status}`);
    }
  }

  async function run_with_concurrency(items, concurrency, worker) {
    let next_index = 0;
    const workers = [...new Array(Math.min(concurrency, items.length))].map(
      async () => {
        while (next_index < items.length) {
          const item = items[next_index];
          next_index++;
          await worker(item);
        }
      }
    );

    await Promise.all(workers);
  }

  function create_replay_body(body_json, overrides) {
    const variables = normalize_variables(body_json?.variables);

    if (!variables) {
      return "";
    }

    const replay_body = structuredClone(body_json);
    const replay_variables = { ...variables, ...overrides };
    replay_body.variables =
      typeof body_json.variables === "string"
        ? JSON.stringify(replay_variables)
        : replay_variables;

    return JSON.stringify(replay_body);
  }

  function get_playlist_state(playlist_id) {
    if (!playlist_states.has(playlist_id)) {
      playlist_states.set(playlist_id, {
        started: false,
        wanted: false,
        is_liked_songs: false,
        template_request: null,
        total_count: null,
        responses: new Map(),
      });
    }

    return playlist_states.get(playlist_id);
  }

  function post_quiet_replay_status(status, playlist_id, details) {
    post_message({
      kind: "quiet-replay-status",
      playlist_id,
      status,
      details,
    });
  }

  function post_message(payload) {
    window.postMessage(
      {
        type: message_type,
        source: "spotify-playlist-page-search",
        payload,
      },
      window.location.origin
    );
  }

  function normalize_variables(variables) {
    if (typeof variables === "string") {
      return parse_json(variables);
    }

    if (variables && typeof variables === "object") {
      return variables;
    }

    return null;
  }

  function get_playlist_id_from_uri(uri) {
    if (typeof uri !== "string" || !uri.startsWith("spotify:playlist:")) {
      return null;
    }

    return uri.split(":").pop() || null;
  }

  function parse_json(text) {
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  }
})();
