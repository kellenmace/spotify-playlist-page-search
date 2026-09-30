"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const background_source = read_source("background.js");
const content_source = read_source("content-script.js");
const manifest = JSON.parse(read_source("manifest.json"));

test("the fetch interceptor runs in the page before Spotify loads", () => {
  const interceptor = manifest.content_scripts.find((script) =>
    script.js.includes("page-fetch-interceptor.js"),
  );
  const content = manifest.content_scripts.find((script) =>
    script.js.includes("content-script.js"),
  );

  for (const script of [interceptor, content]) {
    assert(script.matches.includes("https://open.spotify.com/*"));
    assert.equal(script.run_at, "document_start");
  }

  assert.equal(interceptor.world, "MAIN");
  assert.deepEqual(content.js, ["track-index.js", "content-script.js"]);
});

test("background injects on playlist and Liked Songs pages only", () => {
  assert.match(background_source, /pathname\.startsWith\("\/playlist\/"\)/);
  assert.match(background_source, /pathname === "\/collection\/tracks"/);
  assert.match(background_source, /origin !== "https:\/\/open\.spotify\.com"/);
  assert.match(background_source, /files: \["track-index\.js", "content-script\.js"\]/);
});

test("the content script recognises both page types", () => {
  assert.match(content_source, /url\.pathname === "\/collection\/tracks"/);
  assert.match(content_source, /path_parts\.indexOf\("playlist"\)/);
  assert.match(content_source, /liked_songs: current_page\.type === "liked-songs"/);
});

test("the search button follows Spotify's action buttons", () => {
  assert.match(
    content_source,
    /action_bar\.insertBefore\(\s*this\.create_search_button\(\),\s*get_action_bar_view_control\(action_bar\),\s*\)/,
  );
});

test("tracks are located by their row index in the virtualized list", () => {
  assert.match(content_source, /aria-rowindex="\$\{row_index\}"/);
  assert.match(content_source, /track_index\.get_track_row_index\(track\)/);
});

function read_source(filename) {
  return fs.readFileSync(`${__dirname}/../${filename}`, "utf8");
}
