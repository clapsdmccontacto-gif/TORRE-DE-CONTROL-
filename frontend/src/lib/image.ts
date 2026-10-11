/** Lado mayor de las fotos de entrega y peso objetivo (el servidor acepta hasta 1 MB). */
const MAX_SIDE_PX = 1280;
const TARGET_BYTES = 300_000;

const bytesOf = (dataUrl: string) =>
  Math.round(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

/**
 * Comprime en el teléfono la foto de la cámara: JPEG de unos 1280 px y menos de ~300 KB
 * (respeta la orientación de la foto). Devuelve un data URL.
 */
export async function compressPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('No se pudo leer la foto. Intente de nuevo con la cámara.');
  });
  let scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
  let result = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.72, 0.6, 0.5]) {
      result = canvas.toDataURL('image/jpeg', quality);
      if (bytesOf(result) <= TARGET_BYTES) {
        bitmap.close();
        return result;
      }
    }
    scale *= 0.8;
  }
  bitmap.close();
  return result;
}

export { bytesOf };
