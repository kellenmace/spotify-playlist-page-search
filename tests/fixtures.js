"use strict";

// Builds pathfinder responses shaped like the ones Spotify's web player
// receives for fetchPlaylist and fetchPlaylistContents (captured September
// 2026). Liked Songs is served as a hidden playlist with format "liked-songs".
function create_playlist_response(options) {
  const {
    playlist_id,
    total_count,
    offset = 0,
    limit = 25,
    format = null,
    include_metadata = true,
  } = options;
  const item_count = Math.max(Math.min(limit, total_count - offset), 0);
  const items = [...new Array(item_count)].map((_, index) => {
    return create_playlist_item(offset + index);
  });
  const playlist = {
    __typename: "Playlist",
    content: {
      __typename: "PlaylistItemsPage",
      items,
      pagingInfo: { limit, offset },
      totalCount: total_count,
    },
  };

  if (include_metadata) {
    Object.assign(playlist, {
      attributes: [],
      description: "",
      format,
      name: format === "liked-songs" ? "Liked Songs" : `Playlist ${playlist_id}`,
      ownerV2: { data: { __typename: "User", name: "kellenmace" } },
      uri: `spotify:playlist:${playlist_id}`,
    });
  }

  return { data: { playlistV2: playlist } };
}

function create_playlist_item(position) {
  const track_id = `track${position}`;

  return {
    addedAt: { isoString: "2026-09-05T18:48:27Z" },
    attributes: [],
    itemV2: {
      __typename: "TrackResponseWrapper",
      data: {
        __typename: "Track",
        albumOfTrack: {
          artists: {
            items: [
              {
                profile: { name: `Artist ${position}` },
                uri: `spotify:artist:artist${position}`,
              },
            ],
          },
          coverArt: {
            sources: [
              { height: 300, url: `https://i.scdn.co/image/${position}-300`, width: 300 },
              { height: 64, url: `https://i.scdn.co/image/${position}-64`, width: 64 },
            ],
          },
          name: `Album ${position}`,
          uri: `spotify:album:album${position}`,
        },
        artists: {
          items: [
            {
              profile: { name: `Artist ${position}` },
              uri: `spotify:artist:artist${position}`,
            },
          ],
        },
        contentRating: { label: "NONE" },
        name: `Song ${position}`,
        playability: { playable: true, reason: "PLAYABLE" },
        trackDuration: { totalMilliseconds: 200000 + position },
        uri: `spotify:track:${track_id}`,
      },
    },
    itemV3: { __typename: "EntityResponseWrapper", data: {} },
    uid: `uid${position}`,
  };
}

module.exports = { create_playlist_item, create_playlist_response };
