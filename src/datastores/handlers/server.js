const API_URL = process.env.API_URL || 'http://localhost:3000'; // URL of the mock server

class Profiles {
  static create(profile) {
    return fetch(`${API_URL}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    }).then(response => response.json());
  }

  static find() {
    return fetch(`${API_URL}/profiles`).then(response => response.json());
  }

  static upsert(profile) {
    return fetch(`${API_URL}/profiles/${profile._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    }).then(response => response.json());
  }

  static async addChannelToProfiles(channel, profileIds) {
    for (const profileId of profileIds) {
      const profile = await fetch(`${API_URL}/profiles/${profileId}`).then(res => res.json());
      profile.subscriptions.push(channel);
      await fetch(`${API_URL}/profiles/${profileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      });
    }
  }

  static async removeChannelFromProfiles(channelId, profileIds) {
    for (const profileId of profileIds) {
      const profile = await fetch(`${API_URL}/profiles/${profileId}`).then(res => res.json());
      profile.subscriptions = profile.subscriptions.filter(sub => sub.id !== channelId);
      await fetch(`${API_URL}/profiles/${profileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      });
    }
  }

  static delete(id) {
    return fetch(`${API_URL}/profiles/${id}`, {
      method: 'DELETE',
    }).then(response => response.json());
  }
}

class History {
  static find() {
    return fetch(`${API_URL}/history`).then(response => response.json());
  }

  static upsert(record) {
    return fetch(`${API_URL}/history/${record.videoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    }).then(response => response.json());
  }

  static async overwrite(records) {
    await History.deleteAll();
    for (const record of records) {
      await fetch(`${API_URL}/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });
    }
  }

  static updateWatchProgress(videoId, watchProgress) {
    return fetch(`${API_URL}/history/${videoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watchProgress }),
    }).then(response => response.json());
  }

  static updateLastViewedPlaylist(videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId) {
    return fetch(`${API_URL}/history/${videoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId }),
    }).then(response => response.json());
  }

  static delete(videoId) {
    return fetch(`${API_URL}/history/${videoId}`, {
      method: 'DELETE',
    }).then(response => response.json());
  }

  static async deleteAll() {
    const records = await History.find();
    for (const record of records) {
      await History.delete(record.videoId);
    }
  }
}

class Playlists {
  static create(playlist) {
    return fetch(`${API_URL}/playlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(playlist),
    }).then(response => response.json());
  }

  static find() {
    return fetch(`${API_URL}/playlists`).then(response => response.json());
  }

  static upsert(playlist) {
    return fetch(`${API_URL}/playlists/${playlist._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(playlist),
    }).then(response => response.json());
  }

  static async upsertVideoByPlaylistId(_id, videoData) {
    const playlist = await fetch(`${API_URL}/playlists/${_id}`).then(res => res.json());
    playlist.videos.push(videoData);
    return Playlists.upsert(playlist);
  }

  static async upsertVideosByPlaylistId(_id, videos) {
    const playlist = await fetch(`${API_URL}/playlists/${_id}`).then(res => res.json());
    playlist.videos.push(...videos);
    return Playlists.upsert(playlist);
  }

  static delete(_id) {
    return fetch(`${API_URL}/playlists/${_id}`, {
      method: 'DELETE',
    }).then(response => response.json());
  }

  static async deleteVideoIdByPlaylistId(_id, videoId, playlistItemId) {
    const playlist = await fetch(`${API_URL}/playlists/${_id}`).then(res => res.json());
    if (playlistItemId != null) {
      playlist.videos = playlist.videos.filter(v => v.playlistItemId !== playlistItemId);
    } else if (videoId != null) {
      playlist.videos = playlist.videos.filter(v => v.videoId !== videoId);
    }
    return Playlists.upsert(playlist);
  }

  static async deleteVideoIdsByPlaylistId(_id, playlistItemIds) {
    const playlist = await fetch(`${API_URL}/playlists/${_id}`).then(res => res.json());
    playlist.videos = playlist.videos.filter(v => !playlistItemIds.includes(v.playlistItemId));
    return Playlists.upsert(playlist);
  }

  static async deleteAllVideosByPlaylistId(_id) {
    const playlist = await fetch(`${API_URL}/playlists/${_id}`).then(res => res.json());
    playlist.videos = [];
    return Playlists.upsert(playlist);
  }

  static async deleteMultiple(ids) {
    for (const id of ids) {
      await Playlists.delete(id);
    }
  }

  static async deleteAll() {
    const playlists = await Playlists.find();
    for (const playlist of playlists) {
      await Playlists.delete(playlist._id);
    }
  }
}

class SearchHistory {
  static find() {
    return fetch(`${API_URL}/search-history`).then(response => response.json());
  }

  static upsert(searchHistoryEntry) {
    return fetch(`${API_URL}/search-history/${searchHistoryEntry._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(searchHistoryEntry),
    }).then(response => response.json());
  }

  static delete(_id) {
    return fetch(`${API_URL}/search-history/${_id}`, {
      method: 'DELETE',
    }).then(response => response.json());
  }

  static async deleteAll() {
    const entries = await SearchHistory.find();
    for (const entry of entries) {
      await SearchHistory.delete(entry._id);
    }
  }
}

export {
  Profiles as profiles,
  History as history,
  Playlists as playlists,
  SearchHistory as searchHistory,
};
