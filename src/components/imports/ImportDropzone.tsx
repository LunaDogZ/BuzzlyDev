import { useRef, useState } from "react";
import { UploadCloud, FileSpreadsheet, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ACCEPTED_IMPORT_EXTENSIONS,
  IMPORT_PLATFORMS,
  MAX_IMPORT_FILE_BYTES,
  formatBytes,
  validateImportFile,
  type ImportPlatform,
} from "@/hooks/useImportJobs";

interface ImportDropzoneProps {
  onUpload: (file: File, platform: ImportPlatform) => void;
  isUploading: boolean;
  disabled?: boolean;
}

export function ImportDropzone({ onUpload, isUploading, disabled }: ImportDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState<ImportPlatform | "">("");
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const selectPlatform = IMPORT_PLATFORMS.find((p) => p.value === platform);

  function acceptFile(candidate: File | undefined) {
    if (!candidate) return;
    const error = validateImportFile(candidate);
    if (error) {
      setFileError(error);
      setFile(null);
      return;
    }
    setFileError(null);
    setFile(candidate);
  }

  function clearFile() {
    setFile(null);
    setFileError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleSubmit() {
    if (!file || !platform) return;
    onUpload(file, platform);
    clearFile();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="import-platform" className="text-xs font-black uppercase tracking-widest">
          What kind of file is this?
        </Label>
        <Select
          value={platform}
          onValueChange={(value) => setPlatform(value as ImportPlatform)}
          disabled={disabled || isUploading}
        >
          <SelectTrigger id="import-platform" className="h-11 rounded-xl">
            <SelectValue placeholder="Select the report type" />
          </SelectTrigger>
          <SelectContent>
            {IMPORT_PLATFORMS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectPlatform && (
          <p className="text-xs text-muted-foreground">{selectPlatform.description}</p>
        )}
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="Choose a file to import"
        onClick={() => !disabled && !isUploading && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled && !isUploading) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (disabled || isUploading) return;
          acceptFile(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-border",
          disabled || isUploading ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-primary/60"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={ACCEPTED_IMPORT_EXTENSIONS.join(",")}
          disabled={disabled || isUploading}
          onChange={(event) => acceptFile(event.target.files?.[0])}
        />
        <UploadCloud className="h-8 w-8 text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-bold">Drop your report here, or click to browse</p>
          <p className="text-xs text-muted-foreground">
            {ACCEPTED_IMPORT_EXTENSIONS.join(" · ")} — up to {formatBytes(MAX_IMPORT_FILE_BYTES)}
          </p>
        </div>
      </div>

      {fileError && <p className="text-sm font-medium text-destructive">{fileError}</p>}

      {file && (
        <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/40 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <FileSpreadsheet className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove selected file"
            onClick={clearFile}
            disabled={isUploading}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Button
        onClick={handleSubmit}
        disabled={!file || !platform || isUploading || disabled}
        className="h-11 w-full rounded-xl shadow-lg shadow-primary/20"
      >
        {isUploading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…
          </>
        ) : (
          <>
            <UploadCloud className="mr-2 h-4 w-4" /> Start import
          </>
        )}
      </Button>
      {!platform && file && (
        <p className="-mt-4 text-xs text-muted-foreground">Pick a report type to continue.</p>
      )}
    </div>
  );
}
