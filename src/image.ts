export interface PreparedImage {
  file: File;
  base64: string;
  /** Object URL for previews; revoke with URL.revokeObjectURL when discarded. */
  preview: string;
}

/** Downscales large images client-side so uploads stay small and within request limits. */
export async function prepareImage(file: File, maxSide = 1920): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Image conversion failed.'))), 'image/jpeg', 0.9));
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const prepared = new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  return { file: prepared, base64, preview: URL.createObjectURL(prepared) };
}
