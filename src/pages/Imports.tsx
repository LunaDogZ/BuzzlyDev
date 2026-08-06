import { UploadCloud, Sparkles, Info } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ImportDropzone } from "@/components/imports/ImportDropzone";
import { ImportJobsList } from "@/components/imports/ImportJobsList";
import { useImportJobs, type ImportPlatform } from "@/hooks/useImportJobs";
import { getErrorMessage } from "@/lib/utils";

/**
 * Fallback ingestion path: when a merchant cannot connect a platform API,
 * they upload the report file they already have and Buzzly ingests it.
 */
export default function Imports() {
  const { jobs, isLoading, error, teamId, createImportJob } = useImportJobs();

  function handleUpload(file: File, platform: ImportPlatform) {
    createImportJob.mutate(
      { file, platform },
      {
        onSuccess: (job) => {
          toast.success("File uploaded", {
            description: `${job.original_filename} is queued for processing.`,
          });
        },
        onError: (uploadError) => {
          toast.error("Upload failed", { description: getErrorMessage(uploadError) });
        },
      }
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 p-4 md:p-8">
      {/* HEADER */}
      <div className="flex flex-col gap-4 border-b pb-8 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Data Sources
          </div>
          <h1 className="text-4xl font-black tracking-tight">IMPORTS</h1>
          <p className="text-muted-foreground">
            No API connection? Upload the report file you already have and we will do the rest.
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{getErrorMessage(error)}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* LEFT: UPLOAD */}
        <div className="lg:col-span-5">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest">
                <UploadCloud className="h-4 w-4" /> Upload a report
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <ImportDropzone
                onUpload={handleUpload}
                isUploading={createImportJob.isPending}
                disabled={!teamId}
              />
              <Alert className="rounded-xl">
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {/* This promised the old behaviour: bad rows skipped, the rest
                      imported. A file now commits in full or not at all, so
                      "skipped" here would have merchants expecting a partial
                      import that can no longer happen — and the one thing they
                      must understand before uploading is that a rejected row
                      holds back the whole file. */}
                  Thai column headers, Buddhist-era dates and ฿ amounts are handled automatically.
                  Nothing is guessed: if any row cannot be read the file is not imported at all, and
                  you get a report naming every row to fix.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: HISTORY */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
              Recent imports
            </h3>
          </div>
          <ImportJobsList jobs={jobs} isLoading={isLoading} />
        </div>
      </div>
    </div>
  );
}
