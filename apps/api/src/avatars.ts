export const AVATAR_MAX_BYTES = 512 * 1024;
export const AVATAR_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AvatarContentType = typeof AVATAR_CONTENT_TYPES[number];

// The stored content type comes from the bytes, never the request header, so an upload
// labelled image/png cannot smuggle SVG or HTML into a response served from the API origin.
export function detectAvatarType(image: Buffer): AvatarContentType | undefined {
  if (image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) return "image/jpeg";
  if (image.length >= 12 && image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return undefined;
}

// The version query string changes with every upload, so clients can cache each URL forever.
export const avatarUrl = (userId: string, updatedAt: Date | string | null | undefined) =>
  updatedAt ? `/api/users/${encodeURIComponent(userId)}/avatar?v=${new Date(updatedAt).getTime()}` : undefined;
