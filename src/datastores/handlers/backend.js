const API_BASE_URL = process.env.PROD ? '/api' : 'http://localhost:3000/api'

const createCollection = (name, idField = '_id') => {
  let collectionCache = null
  let collectionLock = Promise.resolve()

  const withLock = (fn) => {
    const newLock = collectionLock.then(() => fn())
    collectionLock = newLock.catch(() => {}) // prevent unhandled rejections on the main chain
    return newLock
  }

  const getAll = async () => {
    if (collectionCache === null) {
      try {
        const response = await fetch(`${API_BASE_URL}/${name}`)
        if (!response.ok) {
          throw new Error(`Failed to fetch ${name}`)
        }
        const n = await response.json()
        if (n && 'data' in n) {
          collectionCache = n
        } else {
          collectionCache = { data: [], version: 0 }
        }
      } catch (error) {
        console.error(error)
        collectionCache = { data: [], version: 0 }
      }
    }
    return collectionCache.data
  }

  const save = async () => {
    if (collectionCache === null) return

    let attempts = 0
    const maxAttempts = 3

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`${API_BASE_URL}/${name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: collectionCache.data, version: collectionCache.version }),
        })

        if (response.status === 409) {
          attempts++
          console.warn(`Conflict detected for collection ${name} (attempt ${attempts} of ${maxAttempts}). Refreshing, merging, and retrying.`)
          const localData = collectionCache.data

          collectionCache = null
          await getAll()
          const serverData = collectionCache.data

          const mergedData = new Map(serverData.map(item => [item[idField], item]))
          for (const record of localData) {
            mergedData.set(record[idField], record)
          }
          collectionCache.data = Array.from(mergedData.values())
          continue // Retry the loop
        }

        if (response.ok) {
          const result = await response.json()
          if (result && 'version' in result) {
            collectionCache.version = result.version
          }
          return // Success
        }

        // For non-conflict errors, throw immediately
        throw new Error(`Failed to save, status: ${response.status}`)
      } catch (error) {
        console.error(`Failed to save ${name}: ${error.message}`)
        // If this is the last attempt, re-throw the error. Otherwise, the loop will continue.
        if (attempts >= maxAttempts - 1) {
          throw error
        }
      }
    }
    // If the loop completes without success, throw a final error.
    throw new Error(`Failed to save collection ${name} after ${maxAttempts} attempts.`)
  }

  const find = async (query) => {
    const all = await getAll()
    if (!query) return all
    return all.filter(doc => {
      return Object.keys(query).every(key => {
        if (typeof query[key] === 'object' && query[key] !== null && '$ne' in query[key]) {
          return doc[key] !== query[key].$ne
        }
        if (typeof query[key] === 'object' && query[key] !== null && '$in' in query[key]) {
          return query[key].$in.includes(doc[key])
        }
        return doc[key] === query[key]
      })
    })
  }

  const findOne = async (query) => {
    const results = await find(query)
    return results[0] || null
  }

  const upsert = (query, doc) => withLock(async () => {
    collectionCache = null
    await getAll()
    const data = collectionCache.data
    const index = data.findIndex(d => {
      return Object.keys(query).every(key => d[key] === query[key])
    })
    if (index !== -1) {
      data[index] = { ...data[index], ...doc }
    } else {
      data.push(doc)
    }
    await save()
    return doc
  })

  const insert = (doc) => withLock(async () => {
    collectionCache = null
    await getAll()
    const data = collectionCache.data
    if (Array.isArray(doc)) {
      doc.forEach(d => {
        if (!d._id) {
          d._id = crypto.randomUUID()
        }
      })
      data.push(...doc)
    } else {
      if (!doc._id) {
        doc._id = crypto.randomUUID()
      }
      data.push(doc)
    }
    await save()
    return doc
  })

  const remove = (query, multi = false) => withLock(async () => {
    collectionCache = null
    await getAll()
    let removedCount = 0
    const newData = collectionCache.data.filter(doc => {
      const match = Object.keys(query).every(key => {
        if (typeof query[key] === 'object' && query[key] !== null && '$in' in query[key]) {
          return query[key].$in.includes(doc[key])
        }
        return doc[key] === query[key]
      })
      if (match && (multi || removedCount === 0)) {
        removedCount++
        return false
      }
      return true
    })
    if (collectionCache.data.length !== newData.length) {
      collectionCache.data = newData
      await save()
    }
  })

  const update = (query, update, options = {}) => withLock(async () => {
    collectionCache = null
    await getAll()
    const data = collectionCache.data
    let updated = false
    data.forEach(doc => {
      const match = Object.keys(query).every(key => {
        if (typeof query[key] === 'object' && query[key] !== null && '$in' in query[key]) {
          return query[key].$in.includes(doc[key])
        }
        return doc[key] === query[key]
      })
      if (match) {
        updated = true
        if (update.$set) {
          Object.assign(doc, update.$set)
        }
        if (update.$push) {
          for (const key in update.$push) {
            if (!doc[key]) doc[key] = []
            const toPush = update.$push[key]
            if (toPush.$each) {
              doc[key].push(...toPush.$each)
            } else {
              doc[key].push(toPush)
            }
          }
        }
        if (update.$pull) {
          for (const key in update.$pull) {
            if (!doc[key]) continue
            const pullQuery = update.$pull[key]
            doc[key] = doc[key].filter(item => {
              return !Object.keys(pullQuery).every(pullKey => {
                if (typeof pullQuery[pullKey] === 'object' && pullQuery[pullKey] !== null && '$in' in pullQuery[pullKey]) {
                  return pullQuery[pullKey].$in.includes(item[pullKey])
                }
                return item[pullKey] === pullQuery[pullKey]
              })
            })
          }
        }
      }
    })
    if (updated || (options.upsert && !updated)) {
      if (options.upsert && !updated) {
        const newDoc = { ...query, ...(update.$set || {}) }
        data.push(newDoc)
      }
      await save()
    }
  })

  const overwrite = (records) => withLock(async () => {
    collectionCache = null
    await getAll()
    collectionCache.data = records
    await save()
  })

  return { getAll, save, find, findOne, upsert, insert, remove, update, overwrite, collectionCache }
}

const settingsDb = createCollection('settings')
const historyDb = createCollection('history', 'videoId')
const profilesDb = createCollection('profiles')
const playlistsDb = createCollection('playlists')
const searchHistoryDb = createCollection('search-history')
const subscriptionCacheDb = createCollection('subscription-cache')

class Settings {
  static async find() {
    // We are skipping the migration logic for now.
    return settingsDb.find({ _id: { $ne: 'bounds' } })
  }

  static upsert(_id, value) {
    return settingsDb.upsert({ _id }, { _id, value })
  }

  // Electron-specific methods are not implemented for now.
}

class History {
  static async find() {
    const history = await historyDb.getAll()
    return history.sort((a, b) => b.timeWatched - a.timeWatched)
  }

  static upsert(record) {
    return historyDb.upsert({ videoId: record.videoId }, record)
  }

  static overwrite(records) {
    return historyDb.overwrite(records)
  }

  static updateWatchProgress(videoId, watchProgress) {
    return historyDb.update({ videoId }, { $set: { watchProgress } }, { upsert: true })
  }

  static updateLastViewedPlaylist(videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId) {
    return historyDb.update({ videoId }, { $set: { lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId } }, { upsert: true })
  }

  static delete(videoId) {
    return historyDb.remove({ videoId })
  }

  static deleteAll() {
    return historyDb.overwrite([])
  }
}

class Profiles {
  static create(profile) {
    return profilesDb.insert(profile)
  }

  static find() {
    return profilesDb.getAll()
  }

  static upsert(profile) {
    return profilesDb.upsert({ _id: profile._id }, profile)
  }

  static addChannelToProfiles(channel, profileIds) {
    return profilesDb.update({ _id: { $in: profileIds } }, { $push: { subscriptions: channel } }, { multi: true })
  }

  static removeChannelFromProfiles(channelId, profileIds) {
    return profilesDb.update({ _id: { $in: profileIds } }, { $pull: { subscriptions: { id: channelId } } }, { multi: true })
  }

  static delete(id) {
    return profilesDb.remove({ _id: id })
  }
}

class Playlists {
  static create(playlists) {
    return playlistsDb.insert(playlists)
  }

  static find() {
    return playlistsDb.getAll()
  }

  static upsert(playlist) {
    return playlistsDb.update({ _id: playlist._id }, { $set: playlist }, { upsert: true })
  }

  static upsertVideoByPlaylistId(_id, videoData) {
    return playlistsDb.update({ _id }, { $push: { videos: videoData } }, { upsert: true })
  }

  static upsertVideosByPlaylistId(_id, videos) {
    return playlistsDb.update({ _id }, { $push: { videos: { $each: videos } } }, { upsert: true })
  }

  static delete(_id) {
    return playlistsDb.remove({ _id, protected: { $ne: true } })
  }

  static deleteVideoIdByPlaylistId(_id, videoId, playlistItemId) {
    if (playlistItemId != null) {
      return playlistsDb.update({ _id }, { $pull: { videos: { playlistItemId } } }, { upsert: true })
    } else if (videoId != null) {
      return playlistsDb.update({ _id }, { $pull: { videos: { videoId } } }, { upsert: true })
    } else {
      throw new Error(`Both videoId & playlistItemId are absent, _id: ${_id}`)
    }
  }

  static deleteVideoIdsByPlaylistId(_id, playlistItemIds) {
    return playlistsDb.update({ _id }, { $pull: { videos: { playlistItemId: { $in: playlistItemIds } } } }, { upsert: true })
  }

  static deleteAllVideosByPlaylistId(_id) {
    return playlistsDb.update({ _id }, { $set: { videos: [] } }, { upsert: true })
  }

  static deleteMultiple(ids) {
    return playlistsDb.remove({ _id: { $in: ids }, protected: { $ne: true } }, true)
  }

  static deleteAll() {
    return playlistsDb.overwrite([])
  }
}

class SearchHistory {
  static async find() {
    const history = await searchHistoryDb.getAll()
    return history.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
  }

  static upsert(searchHistoryEntry) {
    return searchHistoryDb.upsert({ _id: searchHistoryEntry._id }, searchHistoryEntry)
  }

  static delete(_id) {
    return searchHistoryDb.remove({ _id: _id })
  }

  static deleteAll() {
    return searchHistoryDb.overwrite([])
  }
}

class SubscriptionCache {
  static find() {
    return subscriptionCacheDb.getAll()
  }

  static updateVideosByChannelId(channelId, entries, timestamp) {
    return subscriptionCacheDb.update({ _id: channelId }, { $set: { videos: entries, videosTimestamp: timestamp } }, { upsert: true })
  }

  static updateLiveStreamsByChannelId(channelId, entries, timestamp) {
    return subscriptionCacheDb.update({ _id: channelId }, { $set: { liveStreams: entries, liveStreamsTimestamp: timestamp } }, { upsert: true })
  }

  static updateShortsByChannelId(channelId, entries, timestamp) {
    return subscriptionCacheDb.update({ _id: channelId }, { $set: { shorts: entries, shortsTimestamp: timestamp } }, { upsert: true })
  }

  static async updateShortsWithChannelPageShortsByChannelId(channelId, entries) {
    const doc = await subscriptionCacheDb.findOne({ _id: channelId })
    if (doc == null) { return }

    const shorts = doc.shorts
    const cacheShorts = Array.isArray(shorts) ? shorts : []

    cacheShorts.forEach(cachedVideo => {
      const channelVideo = entries.find(short => cachedVideo.videoId === short.videoId)
      if (!channelVideo) { return }

      cachedVideo.title = channelVideo.title
      cachedVideo.author = channelVideo.author

      if (channelVideo.viewCount > cachedVideo.viewCount) {
        cachedVideo.viewCount = channelVideo.viewCount
      }
    })

    await subscriptionCacheDb.update({ _id: channelId }, { $set: { shorts: cacheShorts } }, { upsert: true })
  }

  static updateCommunityPostsByChannelId(channelId, entries, timestamp) {
    return subscriptionCacheDb.update({ _id: channelId }, { $set: { communityPosts: entries, communityPostsTimestamp: timestamp } }, { upsert: true })
  }

  static deleteMultipleChannels(channelIds) {
    return subscriptionCacheDb.remove({ _id: { $in: channelIds } }, true)
  }

  static deleteAll() {
    return subscriptionCacheDb.overwrite([])
  }
}

function compactAllDatastores() {
  // This is no longer needed with the backend.
  return Promise.resolve()
}

export {
  Settings as settings,
  History as history,
  Profiles as profiles,
  Playlists as playlists,
  SearchHistory as searchHistory,
  SubscriptionCache as subscriptionCache,

  compactAllDatastores,
}
