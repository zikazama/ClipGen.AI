export interface PreparedImage {
  file: File;
  base64: string;
  /** Object URL for previews; revoke with URL.revokeObjectURL when discarded. */
  preview: string;
  /** The untouched upload, kept so the crop can be redone when the aspect ratio changes. */
  source: File;
}

/** Width / height for an aspect ratio label such as '9:16'. */
export const ratioOf = (aspect: '16:9' | '9:16') => (aspect === '16:9' ? 16 / 9 : 9 / 16);

/**
 * Centre-crops an image to the video's aspect ratio (Veo letterboxes anything else, leaving black bars),
 * downscales it so uploads stay small, and encodes it as JPEG.
 */
export async function prepareImage(source: File, aspect: '16:9' | '9:16', maxSide = 1920): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(source);
  const target = ratioOf(aspect);
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (sw / sh > target) sw = Math.round(sh * target);
  else sh = Math.round(sw / target);
  const sx = Math.round((bitmap.width - sw) / 2);
  const sy = Math.round((bitmap.height - sh) / 2);

  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  canvas.getContext('2d')!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Image conversion failed.'))), 'image/jpeg', 0.9));
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const file = new File([blob], source.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  return { file, base64, preview: URL.createObjectURL(file), source };
}

/** Downscales a logo and keeps transparency by exporting PNG (the server overlays it on the video). */
export async function prepareLogo(file: File, maxSide = 512): Promise<{ base64: string; preview: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Image conversion failed.'))), 'image/png'));
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { base64, preview: URL.createObjectURL(blob) };
}
