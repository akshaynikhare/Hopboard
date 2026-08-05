/**
 * Thumbnail generation — entirely local, no server, no upload.
 *
 * The thumbnail is the ONLY part of a file that travels automatically. It is
 * small enough to ride inside the normal encrypted envelope, which is what lets
 * the 5 MB original stay put until someone actually asks for it.
 *
 * Privacy note (PRD OI-15): a 160 px preview of a screenshot is often perfectly
 * legible. That is why `settings.thumbs` exists.
 */

import { FILES } from "../core/config.js";

export async function make(file) {
  if (!file.type?.startsWith("image/")) return null;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(FILES.THUMB_PX / bmp.width, FILES.THUMB_PX / bmp.height, 1);
    const canvas = document.createElement("canvas");
    canvas.width  = Math.max(1, Math.round(bmp.width  * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return canvas.toDataURL("image/jpeg", FILES.THUMB_QUALITY);
  } catch {
    return null;    // decode failure, e.g. a corrupt or unsupported image
  }
}

const ICONS = {
  pdf:"📄", txt:"📄", log:"📄", md:"📄",
  zip:"🗜", rar:"🗜", "7z":"🗜", tar:"🗜", gz:"🗜",
  doc:"📝", docx:"📝", rtf:"📝",
  xls:"📊", xlsx:"📊", csv:"📊",
  mp4:"🎬", mov:"🎬", mkv:"🎬", avi:"🎬",
  mp3:"🎵", wav:"🎵", flac:"🎵", m4a:"🎵",
  json:"⚙", yml:"⚙", yaml:"⚙", xml:"⚙",
  js:"📜", ts:"📜", py:"📜", html:"📜", css:"📜",
};

export function iconFor(name) {
  return ICONS[String(name).split(".").pop().toLowerCase()] || "📁";
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
