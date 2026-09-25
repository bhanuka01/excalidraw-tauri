export function normalizePath(p: string): string {
  if (!p) return "";
  let clean = p.replace(/\\/g, "/");
  // Normalize drive letter to uppercase on Windows (e.g., c:/ -> C:/)
  clean = clean.replace(/^([a-zA-Z]):/, (_, letter) => `${letter.toUpperCase()}:`);
  // Remove trailing slashes (except root like "C:/" or "/")
  if (clean.length > 3 && clean.endsWith("/")) {
    clean = clean.replace(/\/+$/, "");
  }
  return clean;
}

export function joinPath(dir: string, filename: string): string {
  const cleanDir = normalizePath(dir);
  const cleanFile = filename.replace(/^[/\\]+/, "").replace(/[/\\]+$/, "");
  if (!cleanDir) return cleanFile;
  if (cleanDir.endsWith("/")) {
    return `${cleanDir}${cleanFile}`;
  }
  return `${cleanDir}/${cleanFile}`;
}

export function getParentDir(p: string): string {
  const clean = normalizePath(p);
  const lastSlash = clean.lastIndexOf("/");
  if (lastSlash === -1) return clean;
  // If it's a drive root like "C:/", return "C:/"
  if (lastSlash === 2 && clean[1] === ":") {
    return clean.slice(0, 3);
  }
  if (lastSlash === 0) {
    return "/";
  }
  return clean.slice(0, lastSlash);
}

export function getBaseName(p: string): string {
  const clean = normalizePath(p);
  const lastSlash = clean.lastIndexOf("/");
  if (lastSlash === -1) return clean;
  const name = clean.slice(lastSlash + 1);
  return name || clean;
}

export function isSamePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

export function isParentOrSame(parent: string, child: string): boolean {
  const normParent = normalizePath(parent).toLowerCase();
  const normChild = normalizePath(child).toLowerCase();
  if (normParent === normChild) return true;
  const parentPrefix = normParent.endsWith("/") ? normParent : normParent + "/";
  return normChild.startsWith(parentPrefix);
}

/**
 * Generates sequential short drawing file names:
 * "Draw 01.excalidraw", "Draw 02.excalidraw", ...
 */
export function getNextDrawFileName(existingNames: string[]): string {
  const existingSet = new Set(existingNames.map((n) => n.toLowerCase()));
  let i = 1;
  while (true) {
    const numStr = String(i).padStart(2, "0");
    const candidate = `Draw ${numStr}.excalidraw`;
    if (!existingSet.has(candidate.toLowerCase())) {
      return candidate;
    }
    i++;
  }
}

/**
 * Generates a unique name when a collision occurs during move/drop:
 * "Draw 01.excalidraw" -> "Draw 01_1.excalidraw"
 * If "Draw 01_1.excalidraw" already exists -> "Draw 01_2.excalidraw", etc.
 */
export function getUniqueFileName(
  existingNames: string[],
  originalName: string,
  isDir: boolean
): string {
  const lowerSet = new Set(existingNames.map((n) => n.toLowerCase()));
  if (!lowerSet.has(originalName.toLowerCase())) {
    return originalName;
  }

  const ext = !isDir && originalName.toLowerCase().endsWith(".excalidraw") ? ".excalidraw" : "";
  const rawBase = ext ? originalName.slice(0, -ext.length) : originalName;

  // Check if rawBase already ends in "_N", e.g. "Draw 01_1" -> base "Draw 01", start counter 2
  const match = rawBase.match(/^(.*)_(\d+)$/);
  const base = match ? match[1] : rawBase;
  let counter = match ? parseInt(match[2], 10) + 1 : 1;

  let candidate = `${base}_${counter}${ext}`;
  while (lowerSet.has(candidate.toLowerCase())) {
    counter++;
    candidate = `${base}_${counter}${ext}`;
  }
  return candidate;
}
