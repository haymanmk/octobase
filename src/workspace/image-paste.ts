/**
 * Clipboard image → clips directory. Shared by the note editor's paste
 * handler and the whiteboard's paste-to-card: normalizes any pasted raster
 * (PNG, JPEG, …) to a PNG data URL via a canvas — the clip:save IPC only
 * accepts PNG — and hands back the stored file ref.
 */
import { getPdfBridge } from "./electron-bridge.ts";

export interface SavedPastedImage {
  file: string;
  w: number;
  h: number;
}

/** First image in a clipboard/drop payload, if any. */
export function imageFileOf(data: DataTransfer | null): File | null {
  return [...(data?.files ?? [])].find((f) => f.type.startsWith("image/")) ?? null;
}

/** Persist a pasted image file into the clips store. Null without a bridge
 *  (non-Electron) or on failure. */
export async function savePastedImage(file: File): Promise<SavedPastedImage | null> {
  const bridge = getPdfBridge();
  if (!bridge) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("undecodable image"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return await bridge.clipSave({
      dataUrl: canvas.toDataURL("image/png"),
      w: canvas.width,
      h: canvas.height,
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
