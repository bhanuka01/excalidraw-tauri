import { useState, useEffect, useCallback } from "react";
import { ExcalidrawEditor } from "./components/editor/ExcalidrawEditor";
import { FileExplorer } from "./components/sidebar/FileExplorer";
import { writeTextFile, readDir } from "@tauri-apps/plugin-fs";
import { joinPath, normalizePath, getNextDrawFileName, getBaseName } from "./utils/pathUtils";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import "./App.css";

const STORAGE_KEY_WORKSPACE = "excalidraw_tauri_last_workspace";
const STORAGE_KEY_FILE = "excalidraw_tauri_last_file";
const STORAGE_KEY_SIDEBAR_WIDTH = "excalidraw_tauri_sidebar_width";
const STORAGE_KEY_SIDEBAR_OPEN = "excalidraw_tauri_sidebar_open";

function App() {
  const [theme] = useState<"light" | "dark">("dark");

  // Restore last opened workspace folder and active file from localStorage
  const [workspacePath, setWorkspacePath] = useState<string | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_WORKSPACE);
    return saved ? normalizePath(saved) : null;
  });

  const [activeFilePath, setActiveFilePath] = useState<string | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_FILE);
    return saved ? normalizePath(saved) : null;
  });

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    const val = localStorage.getItem(STORAGE_KEY_SIDEBAR_OPEN);
    return val !== "false";
  });
  
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const val = localStorage.getItem(STORAGE_KEY_SIDEBAR_WIDTH);
    return val ? parseInt(val, 10) : 256;
  });

  const [isResizing, setIsResizing] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SIDEBAR_OPEN, String(isSidebarOpen));
  }, [isSidebarOpen]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SIDEBAR_WIDTH, String(sidebarWidth));
  }, [sidebarWidth]);

  const startResizing = useCallback(() => {
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (isResizing) {
        setSidebarWidth(Math.min(Math.max(e.clientX, 150), 800));
      }
    },
    [isResizing]
  );

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
      // Prevent text selection while resizing
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    } else {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing, resize, stopResizing]);

  // Persist workspacePath when changed
  const handleWorkspaceChange = (path: string | null) => {
    const normalized = path ? normalizePath(path) : null;
    setWorkspacePath(normalized);
    if (normalized) {
      localStorage.setItem(STORAGE_KEY_WORKSPACE, normalized);
    } else {
      localStorage.removeItem(STORAGE_KEY_WORKSPACE);
      setActiveFilePath(null);
    }
  };

  // Persist activeFilePath when changed
  const handleFileSelect = (path: string | null) => {
    const normalized = path ? normalizePath(path) : null;
    setActiveFilePath(normalized);
    if (normalized) {
      localStorage.setItem(STORAGE_KEY_FILE, normalized);
    } else {
      localStorage.removeItem(STORAGE_KEY_FILE);
    }
  };

  const handleNewFile = async (targetDir?: string) => {
    const dir = targetDir || workspacePath;
    if (!dir) return;

    let existingNames: string[] = [];
    try {
      const entries = await readDir(dir);
      existingNames = entries.filter((e) => !e.name?.startsWith(".")).map((e) => e.name || "");
    } catch {
      // fallback if directory reading fails
    }

    const name = getNextDrawFileName(existingNames);
    const newFilePath = joinPath(dir, name);

    const emptyState = JSON.stringify(
      {
        type: "excalidraw",
        version: 2,
        source: "excalidraw-tauri",
        elements: [],
        appState: { viewBackgroundColor: "#ffffff" },
        files: {},
      },
      null,
      2
    );

    try {
      await writeTextFile(newFilePath, emptyState);
      handleFileSelect(newFilePath);
      setRefreshTrigger((prev) => prev + 1);
    } catch (e) {
      console.error("Failed to create new file:", e);
      alert(`Error creating file: ${e}`);
    }
  };

  return (
    <main className="flex h-screen w-screen bg-gray-900 overflow-hidden">
      {isSidebarOpen && (
        <>
          <aside 
            className="border-r border-gray-800 bg-gray-900/50 flex flex-col p-4 text-white select-none shrink-0"
            style={{ width: `${sidebarWidth}px` }}
          >
            <div className="flex items-center justify-between mb-6">
              <h1
                className="text-xl font-bold tracking-tight truncate"
                title={workspacePath || "Tauri Workspace"}
              >
                {workspacePath ? getBaseName(workspacePath) : "Tauri Workspace"}
              </h1>
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                title="Close Sidebar"
              >
                <PanelLeftClose size={20} />
              </button>
            </div>

            <FileExplorer
              workspacePath={workspacePath}
              activeFilePath={activeFilePath}
              refreshTrigger={refreshTrigger}
              onWorkspaceChange={handleWorkspaceChange}
              onFileSelect={handleFileSelect}
              onNewFile={handleNewFile}
            />
          </aside>
          <div
            className="w-1 cursor-col-resize bg-gray-800 hover:bg-blue-500 active:bg-blue-600 transition-colors shrink-0 z-10"
            onMouseDown={startResizing}
          />
        </>
      )}

      <section className="flex-1 h-full relative bg-gray-900 min-w-0">
        {!isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="absolute top-1/2 -translate-y-1/2 left-0 z-50 p-1 bg-gray-800 hover:bg-gray-700 border border-l-0 border-gray-700 rounded-r-md text-gray-400 hover:text-white shadow-md transition-all"
            title="Open Sidebar"
          >
            <PanelLeftOpen size={20} />
          </button>
        )}
        
        {activeFilePath ? (
          <ExcalidrawEditor theme={theme} activeFilePath={activeFilePath} />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 select-none">
            <h2 className="text-2xl mb-2 font-semibold text-gray-300">No file opened</h2>
            <p className="text-sm text-gray-400">
              Open a workspace folder or create a new file to start drawing.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
