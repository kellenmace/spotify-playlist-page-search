(function initialize_track_index(root, factory) {
  "use strict";

  const track_index = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = track_index;
  }

  if (root) {
    root.spotify_playlist_track_index = track_index;
  }
})(typeof globalThis === "object" ? globalThis : this, function create_track_index() {
  "use strict";

  // Spotify renders the column header as aria-rowindex 1, so the first track
  // in a playlist is aria-rowindex 2.
  const first_track_row_index = 2;

  function extract_page_tracks(response_json, variables) {
    const content = get_playlist_content(response_json);
    const items = content?.items;

    if (!Array.isArray(items)) {
      return [];
    }

    const page_offset = get_page_offset(variables, content.pagingInfo);
    const tracks = [];

    items.forEach((item, item_index) => {
      const track = normalize_track(item, page_offset + item_index);

      if (track) {
        tracks.push(track);
      }
    });

    return tracks;
  }

  function get_total_count(response_json) {
    const total_count = get_playlist_content(response_json)?.totalCount;

    return Number.isFinite(total_count) ? total_count : null;
  }

  function is_liked_songs_response(response_json) {
    return response_json?.data?.playlistV2?.format === "liked-songs";
  }

  function get_playlist_content(response_json) {
    return response_json?.data?.playlistV2?.content || null;
  }

  function get_page_offset(variables, paging_info) {
    const offsets = [variables?.offset, paging_info?.offset];

    for (const offset of offsets) {
      if (Number.isFinite(offset) && offset >= 0) {
        return offset;
      }
    }

    return 0;
  }

  function normalize_track(item, position) {
    const track_data = get_track_data(item);

    if (!track_data) {
      return null;
    }

    const uri = get_string(track_data.uri);
    const id = uri.split(":").pop();

    return {
      key: get_string(item?.uid) || `${id}:${position}`,
      id,
      uri,
      position,
      name: get_string(track_data.name),
      artists: normalize_artists(track_data),
      album: get_string(track_data.albumOfTrack?.name),
      album_url: get_spotify_url_from_uri(
        get_string(track_data.albumOfTrack?.uri),
      ),
      album_image: normalize_album_image(track_data),
      duration: normalize_duration(track_data),
    };
  }

  function get_track_data(item) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const candidates = [
      item.itemV2?.data,
      item.itemV3?.data,
      item.item?.data,
      item.track?.data,
      item.data,
      item,
    ];

    for (const candidate of candidates) {
      const uri = get_string(candidate?.uri);

      if (uri.startsWith("spotify:track:")) {
        return candidate;
      }
    }

    return null;
  }

  function normalize_artists(track_data) {
    const artist_items =
      track_data.artists?.items ||
      track_data.albumOfTrack?.artists?.items ||
      [];

    if (!Array.isArray(artist_items)) {
      return [];
    }

    return artist_items
      .map((artist) => {
        const name = get_string(artist?.profile?.name || artist?.name);
        const uri = get_string(artist?.uri);

        if (!name) {
          return null;
        }

        return { name, uri, url: get_spotify_url_from_uri(uri) };
      })
      .filter(Boolean);
  }

  function normalize_album_image(track_data) {
    const sources = track_data.albumOfTrack?.coverArt?.sources;

    if (!Array.isArray(sources) || sources.length === 0) {
      return "";
    }

    const sorted_sources = [...sources].sort((first, second) => {
      return (
        (first.width || Number.MAX_SAFE_INTEGER) -
        (second.width || Number.MAX_SAFE_INTEGER)
      );
    });

    return get_string(sorted_sources[0]?.url);
  }

  function normalize_duration(track_data) {
    const total_milliseconds = track_data.trackDuration?.totalMilliseconds;

    return Number.isFinite(total_milliseconds) ? total_milliseconds : null;
  }

  function add_tracks(indexed_tracks, indexed_track_keys, tracks) {
    let added_count = 0;

    for (const track of tracks) {
      if (!track.key || indexed_track_keys.has(track.key)) {
        continue;
      }

      indexed_track_keys.add(track.key);
      indexed_tracks.push(track);
      added_count++;
    }

    if (added_count > 0) {
      indexed_tracks.sort(compare_track_positions);
    }

    return added_count;
  }

  function compare_track_positions(first_track, second_track) {
    if (first_track.position !== second_track.position) {
      return first_track.position - second_track.position;
    }

    return first_track.key.localeCompare(second_track.key);
  }

  function get_track_row_index(track) {
    return track.position + first_track_row_index;
  }

  function estimate_row_height(rendered_rows, fallback_height) {
    if (rendered_rows.length >= 2) {
      const first_row = rendered_rows[0];
      const last_row = rendered_rows[rendered_rows.length - 1];
      const row_span = last_row.row_index - first_row.row_index;
      const estimated_height = (last_row.top - first_row.top) / row_span;

      if (Number.isFinite(estimated_height) && estimated_height > 0) {
        return estimated_height;
      }
    }

    return fallback_height;
  }

  // Given one rendered row's position within the scroll content, work out the
  // scroll offset that centers the target row in the viewport.
  function get_scroll_target_top(options) {
    const {
      reference_row_index,
      reference_top,
      row_height,
      target_row_index,
      client_height,
    } = options;
    const target_top =
      reference_top + (target_row_index - reference_row_index) * row_height;

    return Math.max(target_top - (client_height - row_height) / 2, 0);
  }

  function get_spotify_url_from_uri(uri) {
    const parts = uri.split(":");

    if (parts.length < 3) {
      return "";
    }

    return `https://open.spotify.com/${parts[1]}/${parts[2]}`;
  }

  function get_string(value) {
    return typeof value === "string" ? value : "";
  }

  return {
    add_tracks,
    estimate_row_height,
    extract_page_tracks,
    get_page_offset,
    get_scroll_target_top,
    get_total_count,
    get_track_row_index,
    is_liked_songs_response,
  };
});
