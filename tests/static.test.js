"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const background_source = read_source("background.js");
const content_source = read_source("content-script.js");
const interceptor_source = read_source("page-fetch-interceptor.js");
const manifest = JSON.parse(read_source("manifest.json"));

test("manifest injects on playlists and Liked Songs", () => {
  const matches = manifest.content_scripts[0].matches;

  assert(matches.includes("https://open.spotify.com/playlist/*"));
  assert(matches.includes("https://open.spotify.com/collection/tracks*"));
});

test("background admits only supported Spotify page shapes", () => {
  assert.match(background_source, /pathname\.startsWith\("\/playlist\/"\)/);
  assert.match(background_source, /pathname === "\/collection\/tracks"/);
  assert.match(background_source, /origin !== "https:\/\/open\.spotify\.com"/);
});

test("Liked Songs uses its dedicated operation and response page", () => {
  for (const source of [content_source, interceptor_source]) {
    assert.match(source, /fetchLibraryTracks/);
    assert.match(source, /data\?\.me\?\.library\?\.tracks/);
  }

  assert.match(content_source, /item\?\.track\?\.data/);
});

test("payload acceptance checks both page identity and operation", () => {
  assert.match(content_source, /payload\.page_identity\.key === current_page_identity\.key/);
  assert.match(content_source, /is_operation_for_page/);
  assert.match(interceptor_source, /page_identity: request_info\.page_identity/);
});

test("quiet replay overrides offset and limit", () => {
  assert.match(interceptor_source, /create_replay_body\(template_request\.body_json/);
  assert.match(interceptor_source, /\{\s*limit,\s*offset,\s*\}/);
  assert.match(interceptor_source, /template_request\.variables\?\.limit/);
});

function read_source(filename) {
  return fs.readFileSync(`${__dirname}/../${filename}`, "utf8");
}
