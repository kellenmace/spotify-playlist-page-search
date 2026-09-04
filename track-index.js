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

  function add_tracks(indexed_tracks, indexed_track_keys, tracks, options = {}) {
    let added_count = 0;

    for (const track of tracks) {
      const key = get_track_key(track);

      if (!key) {
        continue;
      }

      if (indexed_track_keys.has(key)) {
        if (options.sort_by_position) {
          update_existing_position(indexed_tracks, key, track);
        }

        continue;
      }

      indexed_track_keys.add(key);
      indexed_tracks.push(track);
      added_count++;
    }

    if (options.sort_by_position) {
      indexed_tracks.sort(compare_track_positions);
    }

    return added_count;
  }

  function get_track_position(indexed_tracks, track, use_absolute_position) {
    const key = get_track_key(track);

    if (!key) {
      return -1;
    }

    const indexed_position = indexed_tracks.findIndex((indexed_track) => {
      return get_track_key(indexed_track) === key;
    });

    if (indexed_position === -1) {
      return -1;
    }

    const absolute_position = indexed_tracks[indexed_position].playlist_offset;

    return use_absolute_position && Number.isFinite(absolute_position)
      ? absolute_position
      : indexed_position;
  }

  function get_page_offset(variables, paging_info) {
    const offsets = [variables?.offset, paging_info?.offset];

    for (const offset of offsets) {
      if (Number.isFinite(offset) && offset >= 0) {
        return offset;
      }
    }

    return null;
  }

  function position_page_items(items, page_offset, normalize_item) {
    return items
      .map((item, item_index) => {
        const track = normalize_item(item);

        if (!track || !Number.isFinite(page_offset)) {
          return track;
        }

        return {
          ...track,
          playlist_offset: page_offset + item_index,
        };
      })
      .filter(Boolean);
  }

  function update_existing_position(indexed_tracks, key, track) {
    const existing_track = indexed_tracks.find((indexed_track) => {
      return get_track_key(indexed_track) === key;
    });

    if (!existing_track || !Number.isFinite(track.playlist_offset)) {
      return;
    }

    if (
      !Number.isFinite(existing_track.playlist_offset) ||
      track.playlist_offset < existing_track.playlist_offset
    ) {
      existing_track.playlist_offset = track.playlist_offset;
    }
  }

  function compare_track_positions(first_track, second_track) {
    const first_position = get_sort_position(first_track);
    const second_position = get_sort_position(second_track);

    if (first_position !== second_position) {
      return first_position - second_position;
    }

    return get_track_key(first_track).localeCompare(get_track_key(second_track));
  }

  function get_sort_position(track) {
    return Number.isFinite(track.playlist_offset)
      ? track.playlist_offset
      : Number.MAX_SAFE_INTEGER;
  }

  function get_track_key(track) {
    return track?.id || track?.uri || "";
  }

  return {
    add_tracks,
    get_page_offset,
    get_track_position,
    position_page_items,
  };
});
