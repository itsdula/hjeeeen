// Center-crop a base64-encoded PNG to a target aspect ratio + output dimensions.
// Returns the cropped image as base64 (without data URL prefix).

export async function cropImageToTarget(
  b64: string,
  targetWidth: number,
  targetHeight: number,
): Promise<string> {
  const img = await loadImage(`data:image/png;base64,${b64}`);
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const srcAspect = srcW / srcH;
  const tgtAspect = targetWidth / targetHeight;

  // Compute crop region from source
  let sx: number, sy: number, sw: number, sh: number;
  if (Math.abs(srcAspect - tgtAspect) < 0.001) {
    // Already matches — no crop needed, but may downscale
    sx = 0; sy = 0; sw = srcW; sh = srcH;
  } else if (srcAspect > tgtAspect) {
    // Source is wider — crop horizontally
    sh = srcH;
    sw = Math.round(sh * tgtAspect);
    sx = Math.round((srcW - sw) / 2);
    sy = 0;
  } else {
    // Source is taller — crop vertically
    sw = srcW;
    sh = Math.round(sw / tgtAspect);
    sx = 0;
    sy = Math.round((srcH - sh) / 2);
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context');

  // Image smoothing for downscale quality
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.split(',')[1];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = e => reject(new Error(`Image load failed: ${e}`));
    img.src = src;
  });
}
