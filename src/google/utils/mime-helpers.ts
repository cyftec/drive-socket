export const MIME_TO_EXTENSION = {
  "application/atom+xml": "atom",
  "application/epub+zip": "epub",
  "application/gzip": "gz",
  "application/json": "json",
  "application/ld+json": "jsonld",
  "application/msword": "doc",
  "application/octet-stream": "bin",
  "application/pdf": "pdf",
  "application/pkcs7-mime": "p7m",
  "application/pkcs8": "p8",
  "application/postscript": "ps",
  "application/rtf": "rtf",
  "application/vnd.amazon.ebook": "azw",
  "application/vnd.android.package-archive": "apk",
  "application/vnd.apple.installer+xml": "mpkg",
  "application/vnd.apple.pkpass": "pkpass",
  "application/vnd.google-apps.audio": "gdaudio",
  "application/vnd.google-apps.document": "gdoc",
  "application/vnd.google-apps.drawing": "gdraw",
  "application/vnd.google-apps.drive-sdk": "gdrive-sdk",
  "application/vnd.google-apps.file": "gfile",
  "application/vnd.google-apps.folder": "gfolder",
  "application/vnd.google-apps.form": "gform",
  "application/vnd.google-apps.fusiontable": "gtable",
  "application/vnd.google-apps.jam": "gjam",
  "application/vnd.google-apps.map": "gmap",
  "application/vnd.google-apps.photo": "gphoto",
  "application/vnd.google-apps.presentation": "gslides",
  "application/vnd.google-apps.script": "gscript",
  "application/vnd.google-apps.shortcut": "gshortcut",
  "application/vnd.google-apps.site": "gsite",
  "application/vnd.google-apps.spreadsheet": "gsheet",
  "application/vnd.google-apps.video": "gvideo",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-excel.sheet.macroenabled.12": "xlsm",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12": "pptm",
  "application/vnd.ms-word.document.macroenabled.12": "docm",
  "application/vnd.oasis.opendocument.chart": "odc",
  "application/vnd.oasis.opendocument.database": "odb",
  "application/vnd.oasis.opendocument.formula": "odf",
  "application/vnd.oasis.opendocument.graphics": "odg",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.rar": "rar",
  "application/vnd.visio": "vsd",
  "application/wasm": "wasm",
  "application/x-7z-compressed": "7z",
  "application/x-bittorrent": "torrent",
  "application/x-bzip": "bz",
  "application/x-bzip2": "bz2",
  "application/x-cdf": "cdf",
  "application/x-csh": "csh",
  "application/x-debian-package": "deb",
  "application/x-freearc": "arc",
  "application/x-gtar": "gtar",
  "application/x-httpd-php": "php",
  "application/x-msdownload": "exe",
  "application/x-sh": "sh",
  "application/x-shockwave-flash": "swf",
  "application/x-tar": "tar",
  "application/x-www-form-urlencoded": "urlencoded",
  "application/x-x509-ca-cert": "crt",
  "application/x-yaml": "yaml",
  "application/xml": "xml",
  "application/zip": "zip",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/midi": "midi",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "oga",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/webm": "weba",
  "audio/x-m4a": "m4a",
  "audio/x-wav": "wav",
  "font/collection": "ttc",
  "font/otf": "otf",
  "font/ttf": "ttf",
  "font/woff": "woff",
  "font/woff2": "woff2",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
  "image/vnd.microsoft.icon": "ico",
  "image/webp": "webp",
  "image/x-icon": "ico",
  "model/gltf+json": "gltf",
  "model/gltf-binary": "glb",
  "model/obj": "obj",
  "model/stl": "stl",
  "text/calendar": "ics",
  "text/csv": "csv",
  "text/markdown": "md",
  "text/plain": "txt",
  "text/tab-separated-values": "tsv",
  "text/vcard": "vcf",
  "text/vtt": "vtt",
  "text/xml": "xml",
  "video/3gpp": "3gp",
  "video/mp2t": "ts",
  "video/mp4": "mp4",
  "video/mpeg": "mpeg",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-flv": "flv",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
} as const;

export type SupportedMimeType = keyof typeof MIME_TO_EXTENSION;

export function supportedMimeType(
  mimeType: string,
): mimeType is SupportedMimeType {
  return mimeType in MIME_TO_EXTENSION;
}

export function mimeToExtension(mimeType: SupportedMimeType): string {
  return MIME_TO_EXTENSION[mimeType];
}

export const fileExtensionColors: Record<
  (typeof MIME_TO_EXTENSION)[SupportedMimeType],
  string
> = {
  atom: "#E6652F", // Atom feed / XML-orange
  epub: "#8E44AD", // ebook / EPUB
  json: "#F7DF1E", // JSON's familiar yellow
  jsonld: "#F7DF1E",
  doc: "#185ABD", // Microsoft Word blue
  pdf: "#E2231A", // Adobe PDF red
  ps: "#E2231A", // PostScript / Adobe red
  rtf: "#185ABD", // document / Word blue

  gdoc: "#4285F4", // Google Docs blue
  gdraw: "#F4B400", // Google Drawings yellow
  gform: "#673AB7", // Google Forms purple
  gtable: "#34A853", // Google Tables / spreadsheet green
  gjam: "#F4B400", // Jamboard yellow
  gmap: "#34A853", // Google Maps / Google green
  gphoto: "#4285F4", // Google Photos blue
  gslides: "#F4B400", // Google Slides yellow/orange
  gscript: "#4285F4", // Apps Script / Google blue
  gshortcut: "#5F6368", // neutral Google gray
  gsite: "#4285F4", // Google Sites blue
  gsheet: "#34A853", // Google Sheets green
  gvideo: "#EA4335", // Google video / red
  gdaudio: "#A142F4", // Google audio / purple
  "gdrive-sdk": "#5F6368",
  gfile: "#5F6368",
  gfolder: "#5F6368",

  xls: "#107C41", // Excel green
  xlsm: "#107C41",
  xlsx: "#107C41",

  ppt: "#D24726", // PowerPoint orange
  pptm: "#D24726",
  pptx: "#D24726",

  docm: "#185ABD",
  docx: "#185ABD",

  odc: "#0F9D58", // OpenDocument chart → green
  odb: "#795548", // OpenDocument database → brown
  odf: "#9E9E9E", // formula → neutral
  odg: "#F4B400", // graphics → yellow
  odp: "#D24726", // presentation → orange
  ods: "#107C41", // spreadsheet → green
  odt: "#185ABD", // text document → blue

  vsd: "#3955A3", // Microsoft Visio blue

  // ─────────────────────────────────────
  // Packages / archives / binaries
  // ─────────────────────────────────────

  gz: "#607D8B", // gzip
  bin: "#607D8B", // generic binary
  p7m: "#607D8B", // cryptographic container
  p8: "#607D8B",
  azw: "#FF9900", // Amazon / Kindle orange
  apk: "#3DDC84", // Android green
  mpkg: "#A2AAAD", // Apple installer / neutral Apple gray
  pkpass: "#111111", // Apple Wallet black
  rar: "#315A9E", // WinRAR blue
  "7z": "#555555", // 7-Zip neutral/dark
  torrent: "#05A8E0", // BitTorrent cyan
  bz: "#607D8B",
  bz2: "#607D8B",
  cdf: "#607D8B",
  deb: "#A80030", // Debian red
  arc: "#607D8B",
  gtar: "#607D8B",
  tar: "#607D8B",
  zip: "#F4B400", // archive yellow/gold

  // ─────────────────────────────────────
  // Programming / web / data
  // ─────────────────────────────────────

  wasm: "#654FF0", // WebAssembly purple
  csh: "#4EAA25", // shell / Unix green
  php: "#777BB4", // PHP purple
  exe: "#0078D4", // Windows / Microsoft blue
  sh: "#4EAA25", // shell green
  swf: "#FF0000", // Flash red
  urlencoded: "#607D8B",
  crt: "#607D8B", // certificate
  yaml: "#CB171E", // YAML red
  xml: "#F16529", // XML / markup orange

  md: "#24292F", // Markdown / GitHub dark
  txt: "#666666", // neutral text
  csv: "#107C41", // spreadsheet green
  tsv: "#107C41",
  ics: "#4285F4", // calendar blue
  vcf: "#4285F4", // contacts blue
  vtt: "#607D8B", // subtitles/captions

  // ─────────────────────────────────────
  // Audio
  // ─────────────────────────────────────

  aac: "#A142F4", // purple
  flac: "#A142F4",
  midi: "#7E57C2",
  m4a: "#A142F4",
  mp3: "#A142F4",
  oga: "#A142F4",
  opus: "#7E57C2",
  wav: "#7E57C2",
  weba: "#7E57C2",

  // ─────────────────────────────────────
  // Fonts
  // ─────────────────────────────────────

  ttc: "#607D8B",
  otf: "#607D8B",
  ttf: "#607D8B",
  woff: "#607D8B",
  woff2: "#607D8B",

  // ─────────────────────────────────────
  // Images
  // ─────────────────────────────────────

  avif: "#00A4EF",
  bmp: "#1976D2",
  gif: "#9C27B0",
  heic: "#607D8B",
  heif: "#607D8B",
  jpg: "#4285F4",
  png: "#1976D2",
  svg: "#FF8A00",
  tiff: "#607D8B",
  ico: "#607D8B",
  webp: "#4285F4",

  // ─────────────────────────────────────
  // 3D / CAD / models
  // ─────────────────────────────────────

  gltf: "#FF6F00",
  glb: "#FF6F00",
  obj: "#607D8B",
  stl: "#607D8B",

  // ─────────────────────────────────────
  // Video
  // ─────────────────────────────────────

  "3gp": "#E53935",
  ts: "#E53935",
  mp4: "#E53935",
  mpeg: "#E53935",
  ogv: "#E53935",
  mov: "#1976D2",
  webm: "#1976D2",
  flv: "#E53935",
  mkv: "#7E57C2",
  avi: "#1976D2",
};
