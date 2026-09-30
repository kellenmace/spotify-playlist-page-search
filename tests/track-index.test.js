"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const track_index = require("../track-index.js");
const { create_playlist_item, create_playlist_response } = require("./fixtures.js");

test("tracks are extracted from a playlist page with absolute positions", () => {
  const response_json = create_playlist_response({
    playlist_id: "coding",
    total_count: 59,
    offset: 25,
    limit: 50,
    include_metadata: false,
  });

  const tracks = track_index.extract_page_tracks(response_json, { offset: 25, limit: 50 });

  assert.equal(tracks.length, 34);
  assert.deepEqual(tracks[0], {
    key: "uid25",
    id: "track25",
    uri: "spotify:track:track25",
    position: 25,
    name: "Song 25",
    artists: [
      {
        name: "Artist 25",
        uri: "spotify:artist:artist25",
        url: "https://open.spotify.com/artist/artist25",
      },
    ],
    album: "Album 25",
    album_url: "https://open.spotify.com/album/album25",
    album_image: "https://i.scdn.co/image/25-64",
    duration: 200025,
  });
  assert.equal(tracks.at(-1).position, 58);
  assert.equal(track_index.get_total_count(response_json), 59);
});

test("the page offset falls back to paging info and then to zero", () => {
  const response_json = create_playlist_response({
    playlist_id: "coding",
    total_count: 10,
    offset: 5,
    limit: 5,
  });

  assert.equal(track_index.extract_page_tracks(response_json, null)[0].position, 5);
  assert.equal(track_index.get_page_offset({}, {}), 0);
  assert.equal(track_index.get_page_offset({ offset: 2 }, { offset: 7 }), 2);
});

test("Liked Songs responses are recognised by their format", () => {
  const liked = create_playlist_response({
    playlist_id: "liked",
    total_count: 1,
    format: "liked-songs",
  });
  const playlist = create_playlist_response({ playlist_id: "coding", total_count: 1 });

  assert.equal(track_index.is_liked_songs_response(liked), true);
  assert.equal(track_index.is_liked_songs_response(playlist), false);
  assert.equal(track_index.is_liked_songs_response(null), false);
});

test("items without track data are skipped", () => {
  const response_json = create_playlist_response({ playlist_id: "coding", total_count: 2 });
  response_json.data.playlistV2.content.items[0].itemV2.data.uri = "spotify:episode:abc";

  const tracks = track_index.extract_page_tracks(response_json, { offset: 0 });

  assert.deepEqual(tracks.map((track) => track.position), [1]);
  assert.deepEqual(track_index.extract_page_tracks({ data: {} }, {}), []);
});

test("pages merge by position when they arrive out of order and overlap", () => {
  const indexed_tracks = [];
  const indexed_track_keys = new Set();

  const add_page = (offset, limit) => {
    const response_json = create_playlist_response({
      playlist_id: "coding",
      total_count: 100,
      offset,
      limit,
    });

    return track_index.add_tracks(
      indexed_tracks,
      indexed_track_keys,
      track_index.extract_page_tracks(response_json, { offset, limit }),
    );
  };

  assert.equal(add_page(50, 50), 50);
  assert.equal(add_page(0, 25), 25);
  assert.equal(add_page(25, 50), 25);

  assert.equal(indexed_tracks.length, 100);
  assert.deepEqual(
    indexed_tracks.map((track) => track.position),
    [...new Array(100)].map((_, index) => index),
  );
});

test("the same song at two positions is kept twice", () => {
  const first = create_playlist_item(0);
  const second = create_playlist_item(1);
  second.itemV2.data.uri = first.itemV2.data.uri;
  const response_json = {
    data: { playlistV2: { content: { items: [first, second], totalCount: 2 } } },
  };
  const indexed_tracks = [];

  track_index.add_tracks(
    indexed_tracks,
    new Set(),
    track_index.extract_page_tracks(response_json, { offset: 0 }),
  );

  assert.equal(indexed_tracks.length, 2);
  assert.equal(indexed_tracks[0].id, indexed_tracks[1].id);
});

test("track rows follow the header row in Spotify's grid", () => {
  assert.equal(track_index.get_track_row_index({ position: 0 }), 2);
  assert.equal(track_index.get_track_row_index({ position: 25 }), 27);
});

test("row height is estimated from rendered rows", () => {
  const rows = [
    { row_index: 27, top: 1400 },
    { row_index: 30, top: 1568 },
    { row_index: 60, top: 3248 },
  ];

  assert.equal(track_index.estimate_row_height(rows, 40), 56);
  assert.equal(track_index.estimate_row_height(rows.slice(0, 1), 40), 40);
  assert.equal(track_index.estimate_row_height([], 40), 40);
});

test("the scroll target centers the requested row", () => {
  const scroll_top = track_index.get_scroll_target_top({
    reference_row_index: 27,
    reference_top: 1400,
    row_height: 56,
    target_row_index: 52,
    client_height: 556,
  });

  assert.equal(scroll_top, 1400 + 25 * 56 - 250);
  assert.equal(
    track_index.get_scroll_target_top({
      reference_row_index: 27,
      reference_top: 1400,
      row_height: 56,
      target_row_index: 2,
      client_height: 556,
    }),
    0,
  );
});
