# Spotify Playlist Page Search - Google Chrome Extension

- **Author:** Kellen Mace
- **Author URL:** https://kellenmace.com/
- **License:** MIT
- **GitHub URL:** https://github.com/kellenmace/spotify-playlist-page-search/
- **Chrome Web Store URL:** https://chrome.google.com/webstore/detail/spotify-playlist-page-search/pdchbnnadgiagmpcakgfjopkglpechek

## Description

The native Spotify Web Player does not allow users to search for songs within a playlist. This extension provides a robust search experience on playlist pages, as well as a convenient "Jump to playing song" button.

## How to Use

### Search feature

1. Visit any Spotify playlist page
2. Click the magnifying glass icon or press the keyboard shortcut (ctrl/cmd + shift + s) to perform a search
3. Search for a song by title, artist, or album
4. Click or press Enter on the song you want to play
5. That song is immediately scrolled into view and starts playing

### "Jump to playing song" feature

Click the "Jump to playing song" button to scroll the currently playing song into view. This feature is useful for when you want to quickly jump to the currently playing song in the list.

## Initial Setup

In order for this extension to be able to access the list of songs that exist within the playlist, it needs to be connected to Spotify by following the steps below.

### 1. Create a Spotify app

Create a Spotify app at https://developer.spotify.com/dashboard using the field values below:

- App name: "Spotify Playlist Page Search"
- App description: "Spotify Playlist Page Search Google Chrome extension"
- Redirect URIs: "https://pdchbnnadgiagmpcakgfjopkglpechek.chromiumapp.org/"
- Which API/SDKs are you planning to use?: Check the "Web API" box

Click the Save button, then copy the Client ID for the Spotify app you created.

### 2. Connect the extension to Spotify

- In the web browser, click the extension icon to open the popup.
- Paste in your Spotify app's Client ID and click the button to save it.
- Click the "Connect to Spotify" button.
- In the Spotify page that is displayed, click the "Agree" button to allow the extension to connect to your Spotify app.

The Spotify Playlist Page Search extension will now be connected to your Spotify app and you can begin using it.

## FAQ

> Why do I need to create a Spotify app for this extension to work?

This extension only uses the connected Spotify app for one thing: to fetch the list of songs for the current playlist. This is necessary to get each song title, artist, album, and links that the extension displays in its search popup.

> How can I customize the keyboard shortcut?

This extension provides a ctrl/cmd + shift + s keyboard shortcut you can use to show/hide the search popup. To customize the keyboard shortcut to something else, go to the Chrome "Keyboard shortcuts" page by navigating to `chrome://extensions/shortcuts` in a browser tab. Find the "Spotify Playlist Page Search" extension on the list and click the pencil icon to set your own custom keyboard shortcut.
