"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const track_index = require("../track-index.js");

test("Liked Songs pages merge by absolute position when they arrive out of order", () => {
  const indexed_tracks = [];
  const indexed_track_keys = new Set();

  add_liked_songs_page(indexed_tracks, indexed_track_keys, 2, ["c", "d"]);
  add_liked_songs_page(indexed_tracks, indexed_track_keys, 0, ["a", "b"]);

  assert.deepEqual(
    indexed_tracks.map((track) => track.id),
    ["a", "b", "c", "d"],
  );
  assert.deepEqual(
    indexed_tracks.map((track) => track.playlist_offset),
    [0, 1, 2, 3],
  );
  assert.equal(track_index.get_track_position(indexed_tracks, { id: "d" }, true), 3);
});

test("Liked Songs merging deduplicates overlapping pages deterministically", () => {
  const indexed_tracks = [];
  const indexed_track_keys = new Set();

  add_liked_songs_page(indexed_tracks, indexed_track_keys, 2, ["shared", "d"]);
  add_liked_songs_page(indexed_tracks, indexed_track_keys, 0, ["a", "shared"]);

  assert.deepEqual(
    indexed_tracks.map((track) => [track.id, track.playlist_offset]),
    [
      ["a", 0],
      ["shared", 1],
      ["d", 3],
    ],
  );
  assert.equal(indexed_track_keys.size, 3);
});

test("page offset prefers request variables and falls back to paging info", () => {
  assert.equal(track_index.get_page_offset({ offset: 0 }, { offset: 50 }), 0);
  assert.equal(track_index.get_page_offset({}, { offset: 50 }), 50);
  assert.equal(track_index.get_page_offset({}, {}), null);
});

test("normal playlists retain append order and index-based positions", () => {
  const indexed_tracks = [];
  const indexed_track_keys = new Set();
  const later_track = { id: "later", playlist_offset: 50 };
  const earlier_track = { id: "earlier", playlist_offset: 0 };

  track_index.add_tracks(
    indexed_tracks,
    indexed_track_keys,
    [later_track, earlier_track, later_track],
  );

  assert.deepEqual(
    indexed_tracks.map((track) => track.id),
    ["later", "earlier"],
  );
  assert.equal(track_index.get_track_position(indexed_tracks, earlier_track, false), 1);
});

function add_liked_songs_page(indexed_tracks, indexed_track_keys, offset, ids) {
  const page_offset = track_index.get_page_offset({ offset }, null);
  const tracks = track_index.position_page_items(
    ids,
    page_offset,
    (id) => ({ id }),
  );

  track_index.add_tracks(indexed_tracks, indexed_track_keys, tracks, {
    sort_by_position: true,
  });
}
