import React, { useEffect, useState, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, remove, rename, stat, mkdir } from "@tauri-apps/plugin-fs";
import { FolderOpen, File, Plus, Pencil, Trash2, Check, X, Folder, FolderPlus, ChevronRight, ChevronDown } from "lucide-react";
import { joinPath, normalizePath, getParentDir, isSamePath, isParentOrSame, getUniqueFileName } from "../../utils/pathUtils";

interface FileEntry {
  name: string;
  path: string;
  mtimeMs: number;
  isDir: boolean;
}

interface FileExplorerProps {
  workspacePath: string | null;
  activeFilePath: string | null;
  onWorkspaceChange: (path: string | null) => void;
  onFileSelect: (path: string | null) => void;
  onNewFile: (targetDir?: string) => void;
  refreshTrigger: number;
}

export function FileExplorer({
  workspacePath,
  activeFilePath,
  onWorkspaceChange,
  onFileSelect,
  onNewFile,
  refreshTrigger,
}: FileExplorerProps) {
  const [folderContents, setFolderContents] = useState<Record<string, FileEntry[]>>({});
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [selectedNode, setSelectedNode] = useState<FileEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Drag and Drop state & synchronous ref
  const [draggedNode, setDraggedNode] = useState<FileEntry | null>(null);
  const draggedNodeRef = useRef<FileEntry | null>(null);
  const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null);

  // Rename state
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [newNameInput, setNewNameInput] = useState("");

  const normWorkspace = workspacePath ? normalizePath(workspacePath) : null;

  const loadFolder = async (dirPath: string) => {
    const normDir = normalizePath(dirPath);
    try {
      const entries = await readDir(normDir);
      const relevantEntries = entries.filter(
        (e) =>
          !e.name?.startsWith(".") &&
          (e.isDirectory || (e.isFile && e.name?.toLowerCase().endsWith(".excalidraw")))
      );

      const fileListWithStat: FileEntry[] = await Promise.all(
        relevantEntries.map(async (e) => {
          const name = e.name || "Unknown";
          const path = joinPath(normDir, name);
          let mtimeMs = 0;

          if (!e.isDirectory) {
            try {
              const s = await stat(path);
              if (s.mtime) {
                mtimeMs = typeof s.mtime === "number" ? s.mtime : new Date(s.mtime).getTime();
              }
            } catch {
              // fallback
            }
          }

          return { name, path, mtimeMs, isDir: e.isDirectory };
        })
      );

      fileListWithStat.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      });

      setFolderContents((prev) => ({ ...prev, [normDir]: fileListWithStat }));
      setError(null);
    } catch (err) {
      console.error(`Failed to read directory ${normDir}:`, err);
      if (isSamePath(normDir, workspacePath)) {
        setError("Failed to read directory");
      }
    }
  };

  useEffect(() => {
    if (normWorkspace) {
      setFolderContents({});
      setExpandedFolders({});
      setSelectedNode(null);
      loadFolder(normWorkspace);
    } else {
      setFolderContents({});
      setExpandedFolders({});
      setSelectedNode(null);
    }
  }, [workspacePath]);

  useEffect(() => {
    if (normWorkspace && refreshTrigger > 0) {
      loadFolder(normWorkspace);
      Object.keys(expandedFolders).forEach((dir) => {
        if (expandedFolders[dir]) {
          loadFolder(dir);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  const handleOpenFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === "string") {
        onWorkspaceChange(normalizePath(selected));
      }
    } catch (err) {
      console.error("Failed to open dialog:", err);
    }
  };

  const getTargetDir = () => {
    if (!selectedNode) return normWorkspace;
    if (selectedNode.isDir) return normalizePath(selectedNode.path);
    return getParentDir(selectedNode.path);
  };

  const handleNewFolder = async () => {
    const targetDir = getTargetDir();
    if (!targetDir) return;

    let baseName = "New Folder";
    let name = baseName;
    let i = 1;
    let newPath = joinPath(targetDir, name);

    const existingChildren = folderContents[targetDir] || [];
    while (existingChildren.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      name = `${baseName} (${i})`;
      newPath = joinPath(targetDir, name);
      i++;
    }

    try {
      await mkdir(newPath);

      // Auto expand parent
      setExpandedFolders((prev) => ({ ...prev, [targetDir]: true }));
      await loadFolder(targetDir);

      setRenamingPath(newPath);
      setNewNameInput(name);
    } catch (err) {
      console.error("Failed to create folder:", err);
      alert(`Could not create folder: ${err}`);
    }
  };

  const handleDelete = async (e: React.MouseEvent, file: FileEntry) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete this ${file.isDir ? "folder" : "drawing"}?`)) return;

    try {
      if (normWorkspace) {
        // Move to hidden .bin trash folder at the workspace root
        const binDir = joinPath(normWorkspace, ".bin");
        try {
          await mkdir(binDir);
        } catch {
          // .bin already exists
        }

        // Get unique name in .bin to avoid overwriting previously deleted items
        let existingInBin: string[] = [];
        try {
          const binEntries = await readDir(binDir);
          existingInBin = binEntries.map((entry) => entry.name || "");
        } catch {
          // fallback if reading bin fails
        }

        const destName = getUniqueFileName(existingInBin, file.name, file.isDir);
        const targetBinPath = joinPath(binDir, destName);

        await rename(file.path, targetBinPath);
      } else {
        // Fallback to permanent remove if no workspace is active
        if (file.isDir) {
          await remove(file.path, { recursive: true } as any);
        } else {
          await remove(file.path);
        }
      }

      if (activeFilePath && (isSamePath(activeFilePath, file.path) || isParentOrSame(file.path, activeFilePath))) {
        onFileSelect(null);
      }
      if (selectedNode && (isSamePath(selectedNode.path, file.path) || isParentOrSame(file.path, selectedNode.path))) {
        setSelectedNode(null);
      }

      const parentDir = getParentDir(file.path);
      if (parentDir) {
        loadFolder(parentDir);
      }
      if (normWorkspace && (!parentDir || !isSamePath(parentDir, normWorkspace))) {
        loadFolder(normWorkspace);
      }
    } catch (err) {
      console.error("Failed to delete file/folder:", err);
      alert(`Could not delete: ${err}`);
    }
  };

  const startRenaming = (e: React.MouseEvent, file: FileEntry) => {
    e.stopPropagation();
    setRenamingPath(file.path);
    setNewNameInput(file.isDir ? file.name : file.name.replace(/\.excalidraw$/i, ""));
  };

  const submitRename = async (node: FileEntry) => {
    const oldPath = normalizePath(node.path);
    const parentDir = getParentDir(oldPath);
    if (!parentDir || !newNameInput.trim()) {
      setRenamingPath(null);
      return;
    }

    let cleanName = newNameInput.trim();
    if (!node.isDir && !cleanName.toLowerCase().endsWith(".excalidraw")) {
      cleanName += ".excalidraw";
    }

    const newPath = joinPath(parentDir, cleanName);

    if (isSamePath(newPath, oldPath)) {
      setRenamingPath(null);
      return;
    }

    try {
      await rename(oldPath, newPath);
      setRenamingPath(null);

      if (!node.isDir && activeFilePath && isSamePath(activeFilePath, oldPath)) {
        onFileSelect(newPath);
      } else if (node.isDir && activeFilePath && isParentOrSame(oldPath, activeFilePath)) {
        const rel = activeFilePath.slice(oldPath.length);
        onFileSelect(newPath + rel);
      }

      if (selectedNode && isSamePath(selectedNode.path, oldPath)) {
        setSelectedNode({ ...node, name: cleanName, path: newPath });
      }

      loadFolder(parentDir);
    } catch (err) {
      console.error("Failed to rename:", err);
      alert(`Could not rename: ${err}`);
    }
  };

  const handleNodeClick = (e: React.MouseEvent, node: FileEntry) => {
    e.stopPropagation();
    setSelectedNode(node);
    if (node.isDir) {
      const isExpanded = expandedFolders[node.path];
      if (!isExpanded) {
        setExpandedFolders((prev) => ({ ...prev, [node.path]: true }));
        loadFolder(node.path);
      } else {
        setExpandedFolders((prev) => ({ ...prev, [node.path]: false }));
      }
    } else {
      onFileSelect(node.path);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, node: FileEntry) => {
    e.stopPropagation();
    setDraggedNode(node);
    draggedNodeRef.current = node;
    e.dataTransfer.setData("text/plain", node.path);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    setDraggedNode(null);
    draggedNodeRef.current = null;
    setDropTargetFolder(null);
  };

  const handleDragOverNode = (e: React.DragEvent, targetNode: FileEntry) => {
    const current = draggedNodeRef.current || draggedNode;
    if (!current) return;

    e.preventDefault();
    e.stopPropagation();

    // Determine target directory: if targetNode is a folder, use its path; otherwise use its parent folder
    const targetDir = targetNode.isDir ? targetNode.path : getParentDir(targetNode.path);
    const sourceParent = getParentDir(current.path);

    // Invalid drop targets:
    // 1. Dropping into same folder
    // 2. Dropping onto self
    // 3. Dropping a folder into itself or its own subfolder
    if (
      isSamePath(current.path, targetDir) ||
      isSamePath(sourceParent, targetDir) ||
      (current.isDir && isParentOrSame(current.path, targetDir))
    ) {
      e.dataTransfer.dropEffect = "none";
      if (dropTargetFolder !== null) setDropTargetFolder(null);
      return;
    }

    e.dataTransfer.dropEffect = "move";
    if (!isSamePath(dropTargetFolder, targetDir)) {
      setDropTargetFolder(targetDir);
    }
  };

  const handleDragOverRoot = (e: React.DragEvent) => {
    const current = draggedNodeRef.current || draggedNode;
    if (!current || !normWorkspace) return;

    const sourceParent = getParentDir(current.path);
    if (isSamePath(sourceParent, normWorkspace)) {
      e.dataTransfer.dropEffect = "none";
      if (dropTargetFolder !== null) setDropTargetFolder(null);
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (!isSamePath(dropTargetFolder, normWorkspace)) {
      setDropTargetFolder(normWorkspace);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetDirOverride?: string) => {
    e.preventDefault();
    e.stopPropagation();

    const currentDragged = draggedNodeRef.current || draggedNode;
    const targetDir = targetDirOverride !== undefined ? targetDirOverride : dropTargetFolder;

    setDraggedNode(null);
    draggedNodeRef.current = null;
    setDropTargetFolder(null);

    if (!currentDragged || !targetDir) return;

    const normalizedTarget = normalizePath(targetDir);
    const normalizedSource = normalizePath(currentDragged.path);
    const sourceParent = getParentDir(normalizedSource);

    // Validation
    if (
      isSamePath(normalizedSource, normalizedTarget) ||
      isSamePath(sourceParent, normalizedTarget) ||
      (currentDragged.isDir && isParentOrSame(normalizedSource, normalizedTarget))
    ) {
      return;
    }

    // Check for naming collisions in target folder (e.g. Draw 01 -> Draw 01_1)
    const existingChildren = folderContents[normalizedTarget] || [];
    const destName = getUniqueFileName(
      existingChildren.map((child) => child.name),
      currentDragged.name,
      currentDragged.isDir
    );

    const newPath = joinPath(normalizedTarget, destName);

    try {
      await rename(normalizedSource, newPath);

      // If active file was moved, update activeFilePath to follow it
      if (!currentDragged.isDir && activeFilePath && isSamePath(activeFilePath, normalizedSource)) {
        onFileSelect(newPath);
      } else if (currentDragged.isDir && activeFilePath && isParentOrSame(normalizedSource, activeFilePath)) {
        const relativePart = activeFilePath.slice(normalizedSource.length);
        onFileSelect(newPath + relativePart);
      }

      // Refresh source parent directory and destination directory
      await loadFolder(sourceParent);
      if (!isSamePath(sourceParent, normalizedTarget)) {
        await loadFolder(normalizedTarget);
      }

      // Automatically expand target directory so the moved item is visible
      if (normWorkspace && !isSamePath(normalizedTarget, normWorkspace)) {
        setExpandedFolders((prev) => ({ ...prev, [normalizedTarget]: true }));
      }

      // Highlight the moved node
      setSelectedNode({
        name: destName,
        path: newPath,
        mtimeMs: Date.now(),
        isDir: currentDragged.isDir,
      });
    } catch (err) {
      console.error("Failed to move file/folder:", err);
      alert(`Could not move: ${err}`);
    }
  };

  const renderNode = (node: FileEntry, level: number) => {
    const isExpanded = expandedFolders[node.path];
    const isSelected = selectedNode ? isSamePath(selectedNode.path, node.path) : false;
    const isActive = !node.isDir && activeFilePath ? isSamePath(activeFilePath, node.path) : false;
    const isRenaming = renamingPath ? isSamePath(renamingPath, node.path) : false;
    const activeDrag = draggedNodeRef.current || draggedNode;
    const isDragging = activeDrag ? isSamePath(activeDrag.path, node.path) : false;
    const isDropTarget = node.isDir && dropTargetFolder ? isSamePath(dropTargetFolder, node.path) : false;
    const displayName = node.isDir ? node.name : node.name.replace(/\.excalidraw$/i, "");
    const children = folderContents[node.path] || [];

    return (
      <React.Fragment key={node.path}>
        <li
          className="group relative"
          draggable={!isRenaming}
          onDragStart={(e) => handleDragStart(e, node)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOverNode(e, node)}
          onDrop={(e) => handleDrop(e, node.isDir ? node.path : getParentDir(node.path))}
        >
          {isRenaming ? (
            <div
              className="flex items-center gap-1 py-1 pr-2 bg-gray-800 rounded border border-blue-500/50"
              style={{ paddingLeft: `${level * 12 + 8}px` }}
            >
              {node.isDir ? (
                <Folder size={14} className="text-yellow-500 shrink-0 ml-[20px]" />
              ) : (
                <File size={14} className="text-blue-400 shrink-0 ml-[20px]" />
              )}
              <input
                type="text"
                value={newNameInput}
                onChange={(e) => setNewNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename(node);
                  if (e.key === "Escape") setRenamingPath(null);
                }}
                autoFocus
                className="bg-transparent text-xs text-white outline-none flex-1 min-w-0 ml-1"
              />
              <button
                onClick={() => submitRename(node)}
                className="text-green-400 hover:text-green-300 p-0.5"
              >
                <Check size={14} />
              </button>
              <button
                onClick={() => setRenamingPath(null)}
                className="text-gray-400 hover:text-gray-200 p-0.5"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div
              onClick={(e) => handleNodeClick(e, node)}
              className={`w-full flex items-center justify-between py-1.5 pr-2 rounded text-sm cursor-pointer transition-all ${
                isDragging ? "opacity-35" : ""
              } ${
                isDropTarget
                  ? "bg-blue-600/30 ring-2 ring-blue-500 border border-blue-400 text-white font-medium shadow-sm"
                  : isSelected && !isActive
                  ? "bg-gray-800 text-white font-medium"
                  : isActive
                  ? "bg-blue-600/20 text-blue-400 font-medium"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
              style={{ paddingLeft: `${level * 12 + 8}px` }}
            >
              <div className="flex items-center gap-1 min-w-0 flex-1">
                {node.isDir ? (
                  <>
                    <div className="text-gray-400 hover:text-gray-200 p-0.5 rounded transition-colors">
                      {isExpanded ? (
                        <ChevronDown size={14} className="shrink-0" />
                      ) : (
                        <ChevronRight size={14} className="shrink-0" />
                      )}
                    </div>
                    <Folder
                      size={14}
                      className={`shrink-0 transition-colors ${
                        isDropTarget ? "text-yellow-400 fill-yellow-400/20" : "text-yellow-500 opacity-90"
                      }`}
                    />
                  </>
                ) : (
                  <>
                    <span className="w-[22px] shrink-0" /> {/* Spacer for file icon alignment */}
                    <File
                      size={14}
                      className={isActive ? "text-blue-400 shrink-0" : "opacity-70 shrink-0"}
                    />
                  </>
                )}
                <span className="truncate ml-1" title={displayName}>
                  {displayName}
                </span>
                {isDropTarget && (
                  <span className="ml-auto text-[10px] text-blue-300 uppercase tracking-wider font-semibold mr-1">
                    Drop to move
                  </span>
                )}
              </div>

              {!isDropTarget && (
                <div className="hidden group-hover:flex items-center gap-1 shrink-0 ml-1">
                  <button
                    onClick={(e) => startRenaming(e, node)}
                    className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                    title="Rename"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, node)}
                    className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          )}
        </li>
        {node.isDir && isExpanded && children.map((child) => renderNode(child, level + 1))}
      </React.Fragment>
    );
  };

  const rootFiles = normWorkspace ? folderContents[normWorkspace] || [] : [];
  const isRootDropTarget = normWorkspace !== null && dropTargetFolder ? isSamePath(dropTargetFolder, normWorkspace) : false;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Explorer
        </h2>
        <div className="flex gap-2">
          {normWorkspace && (
            <>
              <button
                onClick={() => {
                  const target = getTargetDir();
                  if (target) onNewFile(target);
                }}
                className="p-1 hover:bg-gray-800 rounded text-gray-300 hover:text-white transition-colors"
                title="New File"
              >
                <Plus size={16} />
              </button>
              <button
                onClick={handleNewFolder}
                className="p-1 hover:bg-gray-800 rounded text-gray-300 hover:text-white transition-colors"
                title="New Folder"
              >
                <FolderPlus size={16} />
              </button>
            </>
          )}
          <button
            onClick={handleOpenFolder}
            className="p-1 hover:bg-gray-800 rounded text-gray-300 hover:text-white transition-colors"
            title="Open Folder"
          >
            <FolderOpen size={16} />
          </button>
        </div>
      </div>

      <div
        className={`flex-1 overflow-y-auto rounded transition-colors ${
          isRootDropTarget ? "bg-blue-600/10 border-2 border-dashed border-blue-400 p-1" : ""
        }`}
        onClick={() => setSelectedNode(null)}
        onDragOver={handleDragOverRoot}
        onDrop={(e) => handleDrop(e, normWorkspace || undefined)}
      >
        {!normWorkspace ? (
          <div className="text-sm text-gray-500 text-center mt-8 select-none">
            <FolderOpen size={32} className="mx-auto mb-2 opacity-50" />
            <p>No workspace opened</p>
            <button
              onClick={handleOpenFolder}
              className="mt-3 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors"
            >
              Open Folder
            </button>
          </div>
        ) : error ? (
          <div className="text-sm text-red-400 text-center mt-4">{error}</div>
        ) : rootFiles.length === 0 ? (
          <div className="text-sm text-gray-500 text-center mt-4 flex flex-col items-center select-none">
            <p className="mb-2">Workspace is empty</p>
          </div>
        ) : (
          <ul className="space-y-0.5 pb-4">
            {rootFiles.map((file) => renderNode(file, 0))}
          </ul>
        )}
      </div>
    </div>
  );
}
