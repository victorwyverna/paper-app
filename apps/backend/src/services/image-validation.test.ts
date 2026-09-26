import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ImageDimensionsTooLargeError,
  UnsupportedImageError,
  inspectImage,
  parseClaimedImageContentType,
  type SupportedImageContentType,
} from './image-validation.js';
import {
  animatedGifFixture,
  animatedWebpFixture,
  corruptedLaterFrameAnimatedGifFixture,
  corruptedFixture,
  gifFixture,
  jpegFixture,
  oversizedAnimatedWebpFixture,
  oversizedWebpFixture,
  pngFixture,
  truncatedFixture,
  webpFixture,
} from '../test-utils/image-fixtures.js';

test('claimed image content type accepts canonical values case-insensitively with parameters', () => {
  assert.equal(parseClaimedImageContentType('image/jpeg'), 'image/jpeg');
  assert.equal(parseClaimedImageContentType('IMAGE/PNG'), 'image/png');
  assert.equal(
    parseClaimedImageContentType('image/webp; charset=binary'),
    'image/webp'
  );
  assert.equal(
    parseClaimedImageContentType(' image/gif ; name="story.gif" '),
    'image/gif'
  );
});

for (const value of [
  undefined,
  '',
  'image/jpeg, image/png',
  'image/jpg',
  'image/svg+xml',
  'image/avif',
  'text/plain',
]) {
  test(`claimed image content type rejects ${JSON.stringify(value)}`, () => {
    assert.equal(parseClaimedImageContentType(value), null);
  });
}

const formats = [
  ['image/jpeg', 'jpg', jpegFixture],
  ['image/png', 'png', pngFixture],
  ['image/webp', 'webp', webpFixture],
  ['image/gif', 'gif', gifFixture],
] as const;

for (const [contentType, extension, fixture] of formats) {
  test(`image validation fully decodes ${contentType}`, async () => {
    const bytes = fixture();

    assert.deepEqual(await inspectImage(bytes, contentType), {
      detectedContentType: contentType,
      extension,
      byteSize: bytes.byteLength,
    });
  });
}

for (const [detectedType, , fixture] of formats) {
  for (const [claimedType] of formats) {
    if (detectedType === claimedType) continue;

    test(`image validation rejects ${detectedType} bytes claimed as ${claimedType}`, async () => {
      await assert.rejects(
        inspectImage(fixture(), claimedType),
        UnsupportedImageError
      );
    });
  }
}

for (const [name, bytes, claimedType] of [
  ['random bytes', Buffer.from('not an image'), 'image/png'],
  ['JPEG signature only', Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'],
  [
    'PNG signature only',
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'image/png',
  ],
  ['corrupt JPEG', corruptedFixture(jpegFixture()), 'image/jpeg'],
  ['corrupt PNG', corruptedFixture(pngFixture()), 'image/png'],
  ['corrupt WebP', corruptedFixture(webpFixture()), 'image/webp'],
  ['corrupt GIF', corruptedFixture(gifFixture()), 'image/gif'],
  ['truncated JPEG', truncatedFixture(jpegFixture()), 'image/jpeg'],
  ['truncated PNG', truncatedFixture(pngFixture()), 'image/png'],
  ['truncated WebP', truncatedFixture(webpFixture()), 'image/webp'],
  ['truncated GIF', truncatedFixture(gifFixture()), 'image/gif'],
] as const satisfies readonly [string, Buffer, SupportedImageContentType][]) {
  test(`image validation rejects ${name}`, async () => {
    await assert.rejects(
      inspectImage(bytes, claimedType),
      UnsupportedImageError
    );
  });
}

for (const [name, contentType, fixture] of [
  ['animated WebP', 'image/webp', animatedWebpFixture],
  ['animated GIF', 'image/gif', animatedGifFixture],
] as const) {
  test(`image validation decodes every frame of ${name}`, async () => {
    const bytes = fixture();
    const result = await inspectImage(bytes, contentType);

    assert.equal(result.detectedContentType, contentType);
    await assert.rejects(
      inspectImage(truncatedFixture(bytes), contentType),
      UnsupportedImageError
    );
  });
}

test('image validation rejects corruption isolated to a later animated frame', async () => {
  await assert.rejects(
    inspectImage(corruptedLaterFrameAnimatedGifFixture(), 'image/gif'),
    UnsupportedImageError
  );
});

test('image validation rejects more than 40 million decoded pixels', async () => {
  await assert.rejects(
    inspectImage(oversizedWebpFixture(), 'image/webp'),
    ImageDimensionsTooLargeError
  );
});

test('image validation sums decoded pixels across animated frames', async () => {
  await assert.rejects(
    inspectImage(oversizedAnimatedWebpFixture(), 'image/webp'),
    ImageDimensionsTooLargeError
  );
});
