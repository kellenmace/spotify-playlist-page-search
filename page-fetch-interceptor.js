(function () {
  "use strict";

  const installed_key = "__spotify_playlist_page_search_fetch_interceptor__";
  const message_type = "spotify-playlist-page-search:pathfinder-response";
  const pathfinder_url = "https://api-partner.spotify.com/pathfinder/v2/query";
  const max_quiet_index_tracks = 6000;
  const quiet_index_batch_size = 1000;
  const quiet_index_concurrency = 2;

  if (window[installed_key]) {
    return;
  }

  window[installed_key] = true;

  const original_fetch = window.fetch;
  const page_states = new Map();

  window.fetch = async function spotify_playlist_page_search_fetch(
    input,
    init
  ) {
    const request_info = await get_request_info(input, init);
    const response = await original_fetch.apply(this, arguments);

    if (is_pathfinder_request(request_info)) {
      inspect_response(request_info, response);
      maybe_store_page_request(request_info);
      maybe_start_quiet_indexing(request_info.page_identity);
    }

    return response;
  };

  function is_pathfinder_request(request_info) {
    return (
      request_info.url === pathfinder_url &&
      request_info.method.toUpperCase() === "POST"
    );
  }

  async function get_request_info(input, init) {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : String(input);
    const method =
      init?.method || request?.method || (init?.body ? "POST" : "GET");
    const headers = sanitize_replay_headers(
      serialize_headers(init?.headers || request?.headers)
    );
    const body_text = await get_request_body_text(input, init);
    const body_json = parse_json(body_text);
    const variables = normalize_variables(body_json?.variables);
    const playlist_id = get_playlist_id_from_variables(variables);
    const page_identity = get_page_identity(window.location.href, playlist_id);

    return {
      url,
      method,
      headers,
      body_text,
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
      operation_name: body_json?.operationName || null,
      variables,
      playlist_id,
      page_identity,
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

  function inspect_response(request_info, response) {
    response
      .clone()
      .json()
      .then((response_json) => {
        const page_identity = resolve_page_identity(
          request_info,
          response_json
        );
        const scoped_request_info = {
          ...request_info,
          page_identity,
        };
        handle_observed_response(scoped_request_info, response_json);
        post_pathfinder_response(scoped_request_info, response, response_json);
      })
      .catch((error) => {
        post_message({
          kind: "parse-error",
          operation_name: request_info.operation_name,
          playlist_id: request_info.playlist_id,
          page_identity: request_info.page_identity,
          status: response.status,
          error: error.message,
        });
      });
  }

  function post_pathfinder_response(request_info, response, response_json) {
    post_message({
      kind: "pathfinder-response",
      url: request_info.url,
      method: request_info.method,
      operation_name: request_info.operation_name,
      playlist_id: request_info.playlist_id,
      page_identity: request_info.page_identity,
      variables: request_info.variables,
      quiet_replay: Boolean(request_info.quiet_replay),
      quiet_replay_offset: request_info.quiet_replay_offset ?? null,
      status: response.status,
      ok: response.ok,
      response_json,
    });
  }

  function handle_observed_response(request_info, response_json) {
    if (!is_operation_for_page(request_info)) {
      return;
    }

    const page_identity = resolve_page_identity(request_info, response_json);

    if (!page_identity) {
      return;
    }

    const total_count = get_page_total_count(page_identity, response_json);

    if (!Number.isFinite(total_count)) {
      return;
    }

    const state = get_page_state(page_identity);
    state.total_count = total_count;
    maybe_start_quiet_indexing(page_identity);
  }

  function maybe_store_page_request(request_info) {
    if (!is_page_content_operation(request_info)) {
      return;
    }

    if (!request_info.page_identity || !request_info.body_json) {
      return;
    }

    const state = get_page_state(request_info.page_identity);
    state.template_request = request_info;
  }

  function maybe_start_quiet_indexing(page_identity) {
    if (!page_identity) {
      return;
    }

    const state = get_page_state(page_identity);

    if (state.started || !Number.isFinite(state.total_count)) {
      return;
    }

    if (!state.template_request) {
      return;
    }

    state.started = true;
    replay_page_contents(state.template_request, state.total_count);
  }

  async function replay_page_contents(template_request, total_count) {
    const capped_total = Math.min(total_count, max_quiet_index_tracks);
    const batch_size = get_quiet_batch_size(template_request);
    const offsets = [];

    for (let offset = 0; offset < capped_total; offset += batch_size) {
      offsets.push(offset);
    }

    post_quiet_replay_status("started", template_request.page_identity, {
      page_total_count: total_count,
      max_quiet_index_tracks,
      batch_size,
      request_count: offsets.length,
      concurrency: quiet_index_concurrency,
    });

    try {
      await run_with_concurrency(offsets, quiet_index_concurrency, async (offset) => {
        await replay_page_contents_page(
          template_request,
          offset,
          Math.min(batch_size, capped_total - offset)
        );
      });

      post_quiet_replay_status("completed", template_request.page_identity, {
        page_total_count: total_count,
        requested_track_count: capped_total,
      });
    } catch (error) {
      post_quiet_replay_status("failed", template_request.page_identity, {
        reason: error.message,
        page_total_count: total_count,
      });
    }
  }

  async function replay_page_contents_page(
    template_request,
    offset,
    limit
  ) {
    const replay_body = create_replay_body(template_request.body_json, {
      limit,
      offset,
    });

    if (!replay_body) {
      throw new Error("Unable to create replay body");
    }

    const replay_body_json = JSON.parse(replay_body);
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

    post_pathfinder_response(
      {
        ...template_request,
        body_text: replay_body,
        body_json: replay_body_json,
        variables: normalize_variables(replay_body_json.variables),
        playlist_id: template_request.playlist_id,
        page_identity: template_request.page_identity,
        quiet_replay: true,
        quiet_replay_offset: offset,
      },
      response,
      response_json
    );

    if (!response.ok) {
      throw new Error(`Quiet replay request failed with ${response.status}`);
    }
  }

  function get_quiet_batch_size(template_request) {
    if (template_request.page_identity.type === "playlist") {
      return quiet_index_batch_size;
    }

    const observed_limit = template_request.variables?.limit;

    return Number.isFinite(observed_limit) && observed_limit > 0
      ? observed_limit
      : 50;
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
    if (!body_json || !body_json.variables) {
      return "";
    }

    const replay_body = structuredClone(body_json);
    const variables_are_string = typeof replay_body.variables === "string";
    const variables = normalize_variables(replay_body.variables);

    if (!variables) {
      return "";
    }

    const replay_variables = {
      ...variables,
      ...overrides,
    };
    replay_body.variables = variables_are_string
      ? JSON.stringify(replay_variables)
      : replay_variables;

    return JSON.stringify(replay_body);
  }

  function get_page_state(page_identity) {
    if (!page_states.has(page_identity.key)) {
      page_states.set(page_identity.key, {
        started: false,
        template_request: null,
        total_count: null,
      });
    }

    return page_states.get(page_identity.key);
  }

  function post_quiet_replay_status(status, page_identity, details) {
    post_message({
      kind: "quiet-replay-status",
      page_identity,
      operation_name:
        page_identity.type === "liked-songs"
          ? "fetchLibraryTracks"
          : "fetchPlaylistContents",
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
    if (!variables) {
      return null;
    }

    if (typeof variables === "string") {
      return parse_json(variables);
    }

    if (typeof variables === "object") {
      return variables;
    }

    return null;
  }

  function get_playlist_id_from_variables(variables) {
    const uri = variables?.uri || variables?.playlistUri;

    if (typeof uri !== "string") {
      return null;
    }

    if (!uri.startsWith("spotify:playlist:")) {
      return null;
    }

    return uri.split(":").pop();
  }

  function get_playlist_id_from_response(response_json) {
    const uri = response_json?.data?.playlistV2?.uri;

    if (typeof uri === "string" && uri.startsWith("spotify:playlist:")) {
      return uri.split(":").pop();
    }

    return null;
  }

  function get_page_identity(url_value, playlist_id) {
    const url = new URL(url_value);

    if (url.pathname === "/collection/tracks") {
      return { key: "liked-songs", type: "liked-songs" };
    }

    if (!url.pathname.startsWith("/playlist/") || !playlist_id) {
      return null;
    }

    return {
      key: `playlist:${playlist_id}`,
      playlist_id,
      type: "playlist",
    };
  }

  function resolve_page_identity(request_info, response_json) {
    if (request_info.page_identity?.type === "liked-songs") {
      return request_info.page_identity;
    }

    const playlist_id =
      request_info.playlist_id || get_playlist_id_from_response(response_json);

    return get_page_identity(window.location.href, playlist_id);
  }

  function is_operation_for_page(request_info) {
    if (request_info.page_identity?.type === "liked-songs") {
      return request_info.operation_name === "fetchLibraryTracks";
    }

    return request_info.operation_name === "fetchPlaylist";
  }

  function is_page_content_operation(request_info) {
    if (request_info.page_identity?.type === "liked-songs") {
      return request_info.operation_name === "fetchLibraryTracks";
    }

    return request_info.operation_name === "fetchPlaylistContents";
  }

  function get_page_total_count(page_identity, response_json) {
    if (page_identity.type === "liked-songs") {
      return response_json?.data?.me?.library?.tracks?.totalCount;
    }

    return response_json?.data?.playlistV2?.content?.totalCount;
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
