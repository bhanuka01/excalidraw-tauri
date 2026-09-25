import { useEffect, useRef, useState, useCallback } from "react";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

interface ExcalidrawEditorProps {
  theme?: "light" | "dark";
  activeFilePath: string | null;
  onSave?: () => void;
}

export function ExcalidrawEditor({
  theme = "dark",
  activeFilePath,
  onSave,
}: ExcalidrawEditorProps) {
  const [initialData, setInitialData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  
  const saveTimeoutRef = useRef<any>(null);
  const pendingSave = useRef<{ path: string; json: string } | null>(null);

  // Flush any pending save on unmount or file switch
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (pendingSave.current) {
        const { path, json } = pendingSave.current;
        pendingSave.current = null;
        // Fire and forget flush save
        writeTextFile(path, json).catch((err) =>
          console.error("Flush save failed:", err)
        );
      }
    };
  }, [activeFilePath]);

  // Load the file content when activeFilePath changes
  useEffect(() => {
    let isMounted = true;

    async function loadFile() {
      if (!activeFilePath) return;
      
      setLoading(true);
      try {
        const content = await readTextFile(activeFilePath);
        if (!isMounted) return;

        let data = { elements: [], appState: {}, files: {} };
        try {
          data = JSON.parse(content);
        } catch (err) {
          console.error("Failed to parse JSON file content:", err);
        }

        setInitialData({
          elements: data.elements || [],
          appState: data.appState || {},
          files: data.files || {},
        });
      } catch (e) {
        console.error("Failed to read excalidraw file from disk:", e);
        if (isMounted) {
          setInitialData({ elements: [], appState: {}, files: {} });
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadFile();

    return () => {
      isMounted = false;
    };
  }, [activeFilePath]);

  // Debounced auto-save on user drawing changes
  const handleOnChange = useCallback(
    (elements: readonly any[], appState: any, files: any) => {
      if (!activeFilePath || loading) return;

      try {
        const json = serializeAsJSON(elements, appState, files, "local");
        pendingSave.current = { path: activeFilePath, json };
      } catch (err) {
        console.error("Failed to serialize:", err);
        return;
      }

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        if (!pendingSave.current) return;
        const { path, json } = pendingSave.current;
        pendingSave.current = null;
        
        try {
          await writeTextFile(path, json);
          console.log("Successfully auto-saved to:", path);
          onSave?.();
        } catch (err) {
          console.error("Auto-save failed:", err);
        }
      }, 600); // 600ms debounce
    },
    [activeFilePath, loading, onSave]
  );

  if (!activeFilePath) return null;

  if (loading || !initialData) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 bg-gray-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4"></div>
        <p>Loading drawing...</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative" style={{ isolation: "isolate" }}>
      <div className="absolute inset-0">
        <Excalidraw
          key={activeFilePath} // Forces clean remount when file changes
          initialData={initialData}
          onChange={handleOnChange}
          theme={theme}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: true,
              clearCanvas: true,
              export: { saveFileToDisk: false },
              loadScene: false,
              saveToActiveFile: false,
              toggleTheme: true,
              saveAsImage: true,
            },
          }}
        />
      </div>
    </div>
  );
}
