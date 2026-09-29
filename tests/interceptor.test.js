"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const { create_playlist_response } = require("./fixtures.js");

const source = fs.readFileSync(`${__dirname}/../page-fetch-interceptor.js`, "utf8");
const liked_songs_id = "37i9dQZF1F5p3rmiWPIYgZ";

test("a playlist is fully indexed in batches once the content script asks for it", async () => {
  const harness = create_harness({ coding: { total_count: 2500 } });

  await harness.fetch_playlist("fetchPlaylist", "coding", { offset: 0, limit: 25 });
  await flush_responses();
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.pages().length, 1);

  harness.request_cache({ playlist_id: "coding" });
  await flush_responses();

  const replays = harness.requests.slice(1).map((request) => request.variables);
  assert.deepEqual(
    replays.map((variables) => [variables.offset, variables.limit]).sort((a, b) => a[0] - b[0]),
    [[0, 1000], [1000, 1000], [2000, 500]],
  );
  assert(replays.every((variables) => variables.uri === "spotify:playlist:coding"));
  assert(replays.every((variables) => variables.enableWatchFeedEntrypoint === true));

  const quiet_pages = harness.pages().filter((page) => page.quiet_replay);
  assert.equal(quiet_pages.length, 3);
  assert(quiet_pages.every((page) => page.playlist_id === "coding" && page.ok));
  assert.equal(
    quiet_pages.reduce((sum, page) => sum + page.response_json.data.playlistV2.content.items.length, 0),
    2500,
  );
  assert.deepEqual(
    harness.statuses().map((status) => status.status),
    ["started", "completed"],
  );
});

test("indexing is capped at 6000 tracks", async () => {
  const harness = create_harness({ huge: { total_count: 9000 } });

  harness.request_cache({ playlist_id: "huge" });
  await harness.fetch_playlist("fetchPlaylist", "huge", { offset: 0, limit: 25 });
  await flush_responses();

  const replays = harness.requests.slice(1);
  assert.equal(replays.length, 6);
  assert.equal(harness.statuses().at(-1).details.requested_track_count, 6000);
});

test("playlists Spotify fetches for other surfaces are observed but not replayed", async () => {
  const harness = create_harness({ coding: { total_count: 400 }, sidebar: { total_count: 400 } });

  harness.request_cache({ playlist_id: "coding" });
  await harness.fetch_playlist("fetchPlaylist", "coding", { offset: 0, limit: 25 });
  await harness.fetch_playlist("fetchPlaylist", "sidebar", { offset: 0, limit: 100 });
  await flush_responses();

  const replayed_uris = harness.requests
    .filter((request) => request.variables.limit === 400)
    .map((request) => request.variables.uri);
  assert.deepEqual(replayed_uris, ["spotify:playlist:coding"]);

  const sidebar_pages = harness.pages().filter((page) => page.playlist_id === "sidebar");
  assert.equal(sidebar_pages.length, 1);
  assert.equal(sidebar_pages[0].quiet_replay, false);
});

test("Liked Songs is recognised by its format and indexed when wanted", async () => {
  const harness = create_harness({ [liked_songs_id]: { total_count: 59, format: "liked-songs" } });

  harness.request_cache({ liked_songs: true });
  assert.equal(harness.messages.length, 0);

  await harness.fetch_playlist("fetchPlaylist", liked_songs_id, { offset: 0, limit: 25 });
  await flush_responses();

  const pages = harness.pages();
  assert(pages.length >= 2);
  assert(pages.every((page) => page.is_liked_songs === true));
  assert(pages.every((page) => page.playlist_id === liked_songs_id));
  assert.equal(harness.requests.at(-1).variables.limit, 59);
  assert.equal(harness.requests.at(-1).variables.offset, 0);

  harness.messages.length = 0;
  harness.request_cache({ liked_songs: true });
  assert.equal(harness.pages().length, 2);
  assert(harness.pages().every((page) => page.is_liked_songs === true));
});

test("fetchPlaylistContents pages for a playlist are attributed to it", async () => {
  const harness = create_harness({ coding: { total_count: 59 } });

  await harness.fetch_playlist("fetchPlaylistContents", "coding", { offset: 25, limit: 50 }, {
    include_metadata: false,
  });
  await flush_responses();

  const [page] = harness.pages();
  assert.equal(page.playlist_id, "coding");
  assert.equal(page.operation_name, "fetchPlaylistContents");
  assert.equal(page.variables.offset, 25);
  assert.equal(page.response_json.data.playlistV2.content.items.length, 34);
});

test("cached pages are replayed to the content script on request", async () => {
  const harness = create_harness({ coding: { total_count: 30 } });

  await harness.fetch_playlist("fetchPlaylist", "coding", { offset: 0, limit: 25 });
  await harness.fetch_playlist("fetchPlaylistContents", "coding", { offset: 25, limit: 50 }, {
    include_metadata: false,
  });
  await flush_responses();
  harness.messages.length = 0;

  harness.request_cache({ playlist_id: "other" });
  assert.equal(harness.messages.length, 0);

  harness.request_cache({ playlist_id: "coding" });
  const cached_pages = harness.pages();
  assert.deepEqual(
    cached_pages.map((page) => [page.variables.offset, page.quiet_replay]),
    [[0, false], [25, false]],
  );
});

test("string-encoded variables survive replay", async () => {
  const harness = create_harness({ coding: { total_count: 30 } });

  harness.request_cache({ playlist_id: "coding" });
  await harness.window.fetch("https://api-partner.spotify.com/pathfinder/v2/query", {
    method: "POST",
    body: JSON.stringify({
      operationName: "fetchPlaylist",
      variables: JSON.stringify({ uri: "spotify:playlist:coding", offset: 0, limit: 25 }),
    }),
  });
  await flush_responses();

  const replay = harness.raw_requests.at(-1);
  assert.equal(typeof replay.variables, "string");
  assert.deepEqual(JSON.parse(replay.variables), {
    uri: "spotify:playlist:coding",
    offset: 0,
    limit: 30,
  });
});

test("requests that are not playlist operations are ignored", async () => {
  const harness = create_harness({ coding: { total_count: 30 } });

  await harness.window.fetch("https://api-partner.spotify.com/pathfinder/v2/query", {
    method: "POST",
    body: JSON.stringify({
      operationName: "libraryV3",
      variables: { limit: 50, offset: 0 },
    }),
  });
  await harness.window.fetch("https://open.spotify.com/", { method: "GET" });
  await flush_responses();

  assert.equal(harness.messages.length, 0);
});

test("the interceptor installs only once", () => {
  const harness = create_harness({});
  const first_fetch = harness.window.fetch;

  vm.runInNewContext(source, harness.context);

  assert.equal(harness.window.fetch, first_fetch);
});

function create_harness(playlists) {
  const requests = [];
  const raw_requests = [];
  const messages = [];
  const listeners = new Map();
  const window = {
    location: {
      href: "https://open.spotify.com/collection/tracks",
      origin: "https://open.spotify.com",
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    postMessage(message, target_origin) {
      assert.equal(target_origin, window.location.origin);
      messages.push(message.payload);
    },
    async fetch(url, init) {
      const body = init?.body ? JSON.parse(init.body) : {};
      const variables =
        typeof body.variables === "string" ? JSON.parse(body.variables) : body.variables;
      raw_requests.push(body);
      requests.push({ ...body, variables });

      if (
        url !== "https://api-partner.spotify.com/pathfinder/v2/query" ||
        typeof variables?.uri !== "string"
      ) {
        return new Response("{}");
      }

      const playlist_id = variables.uri.split(":").pop();
      const playlist = playlists[playlist_id];

      if (!playlist) {
        return new Response(JSON.stringify({ data: { playlistV2: null } }));
      }

      const response_json = create_playlist_response({
        playlist_id,
        total_count: playlist.total_count,
        format: playlist.format || null,
        offset: variables.offset,
        limit: variables.limit,
        include_metadata: body.operationName === "fetchPlaylist",
      });

      return new Response(JSON.stringify(response_json));
    },
  };
  const context = {
    window,
    document: { referrer: "" },
    URL,
    URLSearchParams,
    Request,
    Headers,
    structuredClone,
  };

  vm.runInNewContext(source, context);

  return {
    window,
    context,
    requests,
    raw_requests,
    messages,
    fetch_playlist,
    request_cache,
    pages,
    statuses,
  };

  async function fetch_playlist(operation_name, playlist_id, variables, options = {}) {
    await window.fetch("https://api-partner.spotify.com/pathfinder/v2/query", {
      method: "POST",
      headers: { authorization: "Bearer token", cookie: "secret" },
      body: JSON.stringify({
        operationName: operation_name,
        variables: {
          uri: `spotify:playlist:${playlist_id}`,
          enableWatchFeedEntrypoint: true,
          ...variables,
        },
        ...options,
      }),
    });
  }

  function request_cache(data) {
    listeners.get("message")({
      source: window,
      origin: window.location.origin,
      data: { type: "spotify-playlist-page-search:request-cache", ...data },
    });
  }

  function pages() {
    return messages.filter((message) => message.kind === "pathfinder-response");
  }

  function statuses() {
    return messages.filter((message) => message.kind === "quiet-replay-status");
  }
}

async function flush_responses() {
  // Response cloning and quiet replay run asynchronously after fetch resolves.
  for (let iteration = 0; iteration < 40; iteration++) {
    await new Promise(setImmediate);
  }
}
