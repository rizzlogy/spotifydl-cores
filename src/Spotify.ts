import { promises, unlink } from 'fs-extra'
import SpotifyApi, { IAuth, UserObjectPublic } from './lib/API'
import Artist from './lib/details/Atrist'
import Playlist from './lib/details/Playlist'
import SongDetails from './lib/details/Track'
import axios from 'axios'
import { downloadYT, downloadYTAndSave } from './lib/download'
import SpotifyDlError from './lib/Error'
import getYtlink from './lib/getYtlink'
import metadata from './lib/metadata'

export default class SpotifyFetcher extends SpotifyApi {
    constructor(auth: IAuth) {
        super(auth)
    }

    private async getOriginalUrl(url: string): Promise<string> {
        if (url.includes('spotify.link')) {
            const response = await axios.get(url)
            const html: string = response.data
            const hrefMatch = html.match(/<a class="secondary-action" href="(.*?)"/)
            if (hrefMatch && hrefMatch[1]) {
                const hrefValue: string = hrefMatch[1]
                return hrefValue.includes('?') ? hrefValue.split('?')[0] : hrefValue
            } else {
                throw new Error('Failed to extract the original URL')
            }
        }
        return url.includes('?') ? url.split('?')[0] : url
    }

    /**
     * Get the track details of the given track URL
     * @param url
     * @returns {SongDetails} Track
     */
    getTrack = async (url: string): Promise<SongDetails> => {
        await this.verifyCredentials()
        const originalUrl = await this.getOriginalUrl(url)
        const splits = originalUrl.split('/')
        return await this.extractTrack(splits[splits.length - 1])
    }

    /**
     * Gets the info the given album URL
     * @param url
     * @returns {Playlist} Album
     */
    getAlbum = async (url: string): Promise<Playlist> => {
        await this.verifyCredentials()
        const originalUrl = await this.getOriginalUrl(url)
        const splits = originalUrl.split('/')
        return await this.extractAlbum(splits[splits.length - 1])
    }

    /**
     * Gets the info of the given Artist URL
     * @param url
     * @returns {Artist} Artist
     */
    getArtist = async (url: string): Promise<Artist> => {
        await this.verifyCredentials()
        const originalUrl = await this.getOriginalUrl(url)
        const splits = originalUrl.split('/')
        return await this.extractArtist(splits[splits.length - 1])
    }

    /**
     * Gets the list of albums from the given Artists URL
     * @param url
     * @returns {Playlist[]} Albums
     */
    getArtistAlbums = async (
        url: string
    ): Promise<{
        albums: Playlist[]
        artist: Artist
    }> => {
        await this.verifyCredentials()
        const artistResult = await this.getArtist(url)
        const albumsResult = await this.extractArtistAlbums(artistResult.id)
        const albumIds = albumsResult.map((album) => album.id)
        const albumInfos = []
        for (let x = 0; x < albumIds.length; x++) {
            albumInfos.push(await this.extractAlbum(albumIds[x]))
        }
        return {
            albums: albumInfos,
            artist: artistResult
        }
    }

    /**
     * Gets the playlist info from URL
     * @param url URL of the playlist
     * @returns
     */
    getPlaylist = async (url: string): Promise<Playlist> => {
        await this.verifyCredentials()
        const originalUrl = await this.getOriginalUrl(url)
        const splits = originalUrl.split('/')
        return await this.extractPlaylist(splits[splits.length - 1])
    }

    /**
     * Downloads the given spotify track
     * @param url Url to download
     * @param filename file to save to
     * @returns `buffer` if no filename is provided and `string` if it is
     */
    downloadTrack = async <T extends undefined | string>(
        url: string,
        filename?: T
    ): Promise<T extends undefined ? Buffer : string> => {
        await this.verifyCredentials()
        const info = await this.getTrack(url)
        const link = await getYtlink(`${info.name} ${info.artists[0]}`)
        if (!link) throw new SpotifyDlError(`Couldn't get a download URL for the track: ${info.name}`)
        const data = await downloadYTAndSave(link, filename)
        await metadata(info, data)
        if (!filename) {
            const buffer = await promises.readFile(data)
            unlink(data)
            /* eslint-disable @typescript-eslint/no-explicit-any */
            return buffer as any
        }
        /* eslint-disable @typescript-eslint/no-explicit-any */
        return data as any
    }

    /**
     * Gets the Buffer of track from the info
     * @param info info of the track got from `spotify.getTrack()`
     * @returns
     */
    downloadTrackFromInfo = async (info: SongDetails): Promise<Buffer> => {
        const link = await getYtlink(`${info.name} ${info.artists[0]}`)
        if (!link) throw new SpotifyDlError(`Couldn't get a download URL for the track: ${info.name}`)
        return await downloadYT(link)
    }

    private downloadBatch = async (url: string, type: 'album' | 'playlist'): Promise<(string | Buffer)[]> => {
        await this.verifyCredentials()
        const playlist = await this[type === 'album' ? 'getAlbum' : 'getPlaylist'](url)
        return Promise.all(
            playlist.tracks.map(async (track) => {
                try {
                    return await this.downloadTrack(track)
                } catch (err) {
                    return ''
                }
            })
        )
    }

    /**
     * Downloads the tracks of a playlist
     * @param url URL of the playlist
     * @returns `Promise<(string|Buffer)[]>`
     */
    downloadPlaylist = async (url: string): Promise<(string | Buffer)[]> => await this.downloadBatch(url, 'playlist')

    /**
     * Downloads the tracks of a Album
     * @param url URL of the Album
     * @returns `Promise<(string|Buffer)[]>`
     */
    downloadAlbum = async (url: string): Promise<(string | Buffer)[]> => await this.downloadBatch(url, 'album')

    /**
     * Gets the info of tracks from playlist URL
     * @param url URL of the playlist
     */
    getTracksFromPlaylist = async (
        url: string
    ): Promise<{ name: string; total_tracks: number; tracks: SongDetails[] }> => {
        await this.verifyCredentials()
        const playlist = await this.getPlaylist(url)
        const tracks = await Promise.all(playlist.tracks.map((track) => this.getTrack(track)))
        return {
            name: playlist.name,
            total_tracks: playlist.total_tracks,
            tracks
        }
    }

    /**
     * Gets the info of tracks from Album URL
     * @param url URL of the playlist
     */
    getTracksFromAlbum = async (
        url: string
    ): Promise<{ name: string; total_tracks: number; tracks: SongDetails[] }> => {
        await this.verifyCredentials()
        const playlist = await this.getAlbum(url)
        const tracks = await Promise.all(playlist.tracks.map((track) => this.getTrack(track)))
        return {
            name: playlist.name,
            total_tracks: playlist.total_tracks,
            tracks
        }
    }

    getSpotifyUser = async (id: string): Promise<UserObjectPublic> => await this.getUser(id)
}
