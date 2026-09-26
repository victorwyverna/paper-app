import sharp from 'sharp';

export const SUPPORTED_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type SupportedImageContentType =
  (typeof SUPPORTED_IMAGE_CONTENT_TYPES)[number];

type ImageExtension = 'jpg' | 'png' | 'webp' | 'gif';

export type ValidatedImage = {
  detectedContentType: SupportedImageContentType;
  extension: ImageExtension;
  byteSize: number;
};

export class UnsupportedImageError extends Error {
  constructor() {
    super('Unsupported image content');
  }
}

export class ImageDimensionsTooLargeError extends Error {
  constructor() {
    super('Image dimensions are too large');
  }
}

const MAX_DECODED_PIXELS = 40_000_000;
const contentTypePattern =
  /^\s*(image\/(?:jpeg|png|webp|gif))\s*(?:;\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+\s*=\s*(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[\t !#-[\]-~]|\\[\t -~])*")\s*)*$/i;

const detectedFormats = {
  jpeg: { detectedContentType: 'image/jpeg', extension: 'jpg' },
  png: { detectedContentType: 'image/png', extension: 'png' },
  webp: { detectedContentType: 'image/webp', extension: 'webp' },
  gif: { detectedContentType: 'image/gif', extension: 'gif' },
} as const;

export function parseClaimedImageContentType(
  value: string | undefined
): SupportedImageContentType | null {
  if (!value || value.includes(',')) return null;

  const match = contentTypePattern.exec(value);
  if (!match?.[1]) return null;

  return match[1].toLowerCase() as SupportedImageContentType;
}

export async function inspectImage(
  bytes: Buffer,
  claimedContentType: SupportedImageContentType
): Promise<ValidatedImage> {
  try {
    const image = sharp(bytes, {
      animated: true,
      failOn: 'warning',
      limitInputPixels: true,
    });
    const metadata = await image.metadata();
    const format = metadata.format as keyof typeof detectedFormats | undefined;
    const detected = format ? detectedFormats[format] : undefined;

    if (!detected || detected.detectedContentType !== claimedContentType) {
      throw new UnsupportedImageError();
    }

    const width = metadata.width;
    const pageHeight = metadata.pageHeight ?? metadata.height;
    const pages = metadata.pages ?? 1;

    if (
      !width ||
      !pageHeight ||
      !Number.isSafeInteger(width * pageHeight * pages)
    ) {
      throw new UnsupportedImageError();
    }

    if (width * pageHeight * pages > MAX_DECODED_PIXELS) {
      throw new ImageDimensionsTooLargeError();
    }

    await image.stats();

    return {
      ...detected,
      byteSize: bytes.byteLength,
    };
  } catch (error) {
    if (
      error instanceof UnsupportedImageError ||
      error instanceof ImageDimensionsTooLargeError
    ) {
      throw error;
    }

    throw new UnsupportedImageError();
  }
}
