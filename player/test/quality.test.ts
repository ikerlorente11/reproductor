// node --experimental-strip-types test/quality.test.ts
import assert from 'node:assert/strict'
import { quality } from '../src/lib/quality.ts'
import { JellyfinSource, SubsonicSource } from '../src/lib/remote.ts'

const fetch = (async () => new Response('{}')) as any
const nd = new SubsonicSource({ id: 'n', kind: 'subsonic', name: 'Navidrome', url: 'https://nd.example', username: 'u' } as any, 'p', fetch)
const jf = new JellyfinSource({ id: 'j', kind: 'jellyfin', name: 'Jellyfin', url: 'https://jf.example', username: 'u' } as any, 'p', fetch)

// the original: no limit asked
quality.wifi = 'original'
assert.ok(!nd.streamUrl('1').includes('maxBitRate'))
assert.ok(!jf.streamUrl('1').includes('MaxStreamingBitrate'))
// lower: Navidrome recodes to maxBitRate (kbps), Jellyfin to MaxStreamingBitrate (bps)
quality.wifi = 'normal'
assert.ok(new URL(nd.streamUrl('1')).searchParams.get('maxBitRate') === '160')
assert.ok(new URL(jf.streamUrl('1')).searchParams.get('MaxStreamingBitrate') === '160000')
quality.wifi = 'low'
assert.ok(new URL(nd.streamUrl('1')).searchParams.get('maxBitRate') === '96')
// a computer (no mobile data): the mobile setting does not count
quality.wifi = 'original'
quality.mobile = 'low'
assert.ok(!nd.streamUrl('1').includes('maxBitRate'))

console.log('quality: ok')
