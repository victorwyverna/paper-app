import { gunzipSync } from 'node:zlib';

const fixtures = {
  jpeg: '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIIAeC//2Q==',
  png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  webp: 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
  gif: 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  animatedWebp:
    'UklGRoQAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAD/////AABBTk1GKAAAAAAAAAAAAAEAAAEAADIAAAJWUDhMDwAAAC8BQAAABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAEAAAEAAFAAAABWUDhMDwAAAC8BQAAABxDR//4HIqL/AQA=',
  animatedGif:
    'R0lGODlhAgACAIAAAExpcf8AACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFBQAAACwAAAAAAgACAAACAoxTACH5BAUIAAAALAAAAAACAAIAgExpcQAA/wICjFMAOw==',
} as const;

const compressedFixtures = {
  oversizedWebp:
    'H4sIAAAAAAACEwvydHOrYWNgCHd1CggLsPApYGNg0A+/fZuVPaAxhEOBgWvWv+M6io5N/89LKyuZBjo1Hfn/vNfli30j08fv8q4ux+r//32+//+/z/fr//98v///v9+oBEj87/dRYpQYJUaJUWKUoJgAVTN/sEv+VwQArizQts8GAAA=',
  oversizedAnimatedWebp:
    'H4sIAAAAAAACEwvydHPLYWdgCHd1CggLsIjgYmBgYGJgYJgsyNAuzODo5+nLxsDA8P////8MDI5+vm5zmBmgAKIihYGBKSzAwqeZmYFBf/LFhyzsAn/7/7F7e0x48P/jtQ4PX4EJKn//y7t9sW9k+vhd3tXlWP3/v9/n///3+709MuN+/SgxSowSlBD/uxlx5VEGtDx68f9oHh0lRokByaMAEURoeXQHAAA=',
} as const;

function decode(name: keyof typeof fixtures): Buffer {
  return Buffer.from(fixtures[name], 'base64');
}

function decodeCompressed(name: keyof typeof compressedFixtures): Buffer {
  return gunzipSync(Buffer.from(compressedFixtures[name], 'base64'));
}

export const jpegFixture = () => decode('jpeg');
export const pngFixture = () => decode('png');
export const webpFixture = () => decode('webp');
export const gifFixture = () => decode('gif');
export const animatedWebpFixture = () => decode('animatedWebp');
export const animatedGifFixture = () => decode('animatedGif');
export const oversizedWebpFixture = () => decodeCompressed('oversizedWebp');
export const oversizedAnimatedWebpFixture = () =>
  decodeCompressed('oversizedAnimatedWebp');

export function corruptedLaterFrameAnimatedGifFixture(): Buffer {
  const corrupted = animatedGifFixture();
  // This byte belongs to the second frame's LZW payload; frame one is intact.
  corrupted[87] = 0xff;
  return corrupted;
}

export function corruptedFixture(source: Buffer): Buffer {
  const corrupted = Buffer.from(source);
  corrupted.fill(0, Math.min(12, corrupted.length));
  return corrupted;
}

export function truncatedFixture(source: Buffer): Buffer {
  return source.subarray(0, Math.max(1, Math.floor(source.length / 2)));
}
