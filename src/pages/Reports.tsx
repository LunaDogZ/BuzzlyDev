import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Download,
  FileText,
  Calendar,
  Plus,
  MoreHorizontal,
  Eye,
  Share2,
  Trash2,
  FileSpreadsheet,
  BarChart3,
  DollarSign,
  Smartphone,
  ArrowRight,
  Sparkles,
  FileCheck,
  Loader2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PlanRestrictedPage } from "@/components/PlanRestrictedPage";
import { useReports } from "@/hooks/useReports";
import { useDashboardMetrics, type DashboardMetrics } from "@/hooks/useDashboardMetrics";
import { useAdPersonas } from "@/hooks/useAdPersonas";
import { useRevenueMetrics, type DerivedRevenue } from "@/hooks/useRevenueMetrics";
import { formatTHB } from "@/lib/money";
import { formatRoas } from "@/lib/roas";
import { format } from "date-fns";
import { toast } from "sonner";
import { generatePdfFromElement, uploadReportPdf, uploadReportFile, downloadPdfBlob, downloadBlob, downloadStoredReport } from "@/lib/reportPdf";
import { generateExcelFromReportData, generateCsvFromReportData } from "@/lib/reportExcel";
import { logError } from "@/services/errorLogger";
import { ReportChartBlocks, REPORT_CHART_OPTIONS, type ReportChartId } from "@/components/reports/ReportChartBlocks";
import { Checkbox } from "@/components/ui/checkbox";

const reportTemplates = [
  { id: "campaign", name: "Campaign Performance", description: "Conversion & CTR from Campaign", icon: BarChart3, color: "text-blue-500", bg: "bg-blue-500/10" },
  { id: "roi", name: "ROI Analysis", description: "Graphs from Analytics page", icon: DollarSign, color: "text-amber-500", bg: "bg-amber-500/10" },
  { id: "channel", name: "Persona", description: "Persona & Platform", icon: Smartphone, color: "text-purple-500", bg: "bg-purple-500/10" },
];

function formatMetricValue(value: number, type: "number" | "percent" | "currency"): string {
  if (type === "percent") return `${value.toFixed(2)}%`;
  if (type === "currency") return formatTHB(value);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function getDateRangeValue(
  mode: string,
  dateFrom: string,
  dateTo: string
): string {
  if (mode === "custom" && dateFrom && dateTo) {
    return `custom:${dateFrom}:${dateTo}`;
  }
  return mode;
}

function getDateRangeLabel(mode: string, dateFrom: string, dateTo: string): string {
  if (mode === "custom" && dateFrom && dateTo) {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    return `${format(from, "MMM d, yyyy")} — ${format(to, "MMM d, yyyy")}`;
  }
  const labels: Record<string, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" };
  return labels[mode] ?? mode;
}

function ReportsContent() {
  const [reportDateMode, setReportDateMode] = useState<"7d" | "30d" | "90d" | "custom">("30d");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0]!;
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]!);
  const reportDateRange = getDateRangeValue(reportDateMode, dateFrom, dateTo);

  const { reports, isLoading, createReport, deleteReport, updateReportFileUrl } = useReports();
  const { data: metrics } = useDashboardMetrics(reportDateRange);
  const { revenueMetrics } = useRevenueMetrics();
  const { personaData, totalImpressions: personaImpressions } = useAdPersonas({ mode: "all" });
  const reportRef = useRef<HTMLDivElement>(null);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewReport, setPreviewReport] = useState<string | null>(null);
  const [previewReportType, setPreviewReportType] = useState<string>("campaign");
  const [filterFormat, setFilterFormat] = useState("all");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editingReportId, setEditingReportId] = useState<string | null>(null);

  // Custom report form state
  const [newReportName, setNewReportName] = useState("");
  const [newReportType, setNewReportType] = useState("campaign");
  const [newReportFormat, setNewReportFormat] = useState("pdf");
  const [selectedCharts, setSelectedCharts] = useState<ReportChartId[]>(
    REPORT_CHART_OPTIONS.map((c) => c.id)
  );

  const toggleChart = (id: ReportChartId) => {
    setSelectedCharts((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleQuickGenerate = (typeId: string, reportName?: string, reportId?: string) => {
    setPreviewReport(reportName ?? typeId);
    setPreviewReportType(typeId);
    setEditingReportId(reportId ?? null);
    setIsPreviewOpen(true);
  };

  const handleDownloadPDF = async (saveToReports = false) => {
    if (!reportRef.current) return;
    setIsDownloading(true);
    try {
      const blob = await generatePdfFromElement(reportRef.current);
      const fileName = `report_${Date.now()}.pdf`;
      const safeName = (previewReport ?? "report").replace(/[^a-zA-Z0-9ก-๙\s-]/g, "_");

      if (saveToReports) {
        const filePath = await uploadReportPdf(blob, fileName);
        if (editingReportId) {
          await updateReportFileUrl.mutateAsync({ reportId: editingReportId, fileUrl: filePath });
        } else {
          await createReport.mutateAsync({
            name: previewReport ?? "Marketing Report",
            report_type: previewReportType,
            file_format: "pdf",
            file_url: filePath,
          });
        }
      }

      downloadPdfBlob(blob, `${safeName}.pdf`);
      toast.success(saveToReports ? "Report saved and downloaded" : "PDF downloaded");
      if (saveToReports) {
        setIsPreviewOpen(false);
        setEditingReportId(null);
      }
    } catch (err) {
      toast.error("Failed to generate PDF", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadExcel = () => {
    const payload = {
      reportName: previewReport ?? "Marketing Report",
      reportType: previewReportType,
      dateRangeLabel: getDateRangeLabel(reportDateMode, dateFrom, dateTo),
      metrics: metrics ?? undefined,
      personaData: previewReportType === "channel" ? personaData ?? undefined : undefined,
      generatedAt: format(new Date(), "MMMM d, yyyy"),
    };
    const buffer = generateExcelFromReportData(payload);
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const safeName = (previewReport ?? "report").replace(/[^a-zA-Z0-9ก-๙\s-]/g, "_");
    downloadBlob(blob, `${safeName}.xlsx`);
    toast.success("Excel downloaded");
  };

  const handleSaveReport = async () => {
    if (!newReportName.trim()) return;
    setIsCreating(true);
    const safeName = newReportName.replace(/[^a-zA-Z0-9ก-๙\s-]/g, "_");
    const reportPayload = {
      reportName: newReportName,
      reportType: newReportType,
      dateRangeLabel: getDateRangeLabel(reportDateMode, dateFrom, dateTo),
      metrics: metrics ?? undefined,
      personaData: newReportType === "channel" ? personaData ?? undefined : undefined,
      generatedAt: format(new Date(), "MMMM d, yyyy"),
    };

    try {
      if (newReportFormat === "excel" || newReportFormat === "csv") {
        const isExcel = newReportFormat === "excel";
        const buffer = isExcel
          ? generateExcelFromReportData(reportPayload)
          : new TextEncoder().encode(generateCsvFromReportData(reportPayload));
        const blob = isExcel ? new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }) : new Blob([buffer], { type: "text/csv" });
        const ext = isExcel ? "xlsx" : "csv";
        const fileName = `report_${Date.now()}.${ext}`;
        const contentType = isExcel ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv";
        const filePath = await uploadReportFile(blob, fileName, contentType);

        await createReport.mutateAsync({
          name: newReportName,
          report_type: newReportType,
          file_format: newReportFormat,
          file_url: filePath,
        });

        downloadBlob(blob, `${safeName}.${ext}`);
        toast.success("Report saved and downloaded");
      } else {
        await new Promise((r) => setTimeout(r, 300));
        const sourceEl = document.getElementById("report-pdf-source");
        if (!sourceEl) {
          toast.error("Failed to create report");
          return;
        }

        const blob = await generatePdfFromElement(sourceEl as HTMLElement);
        const fileName = `report_${Date.now()}.pdf`;
        const filePath = await uploadReportPdf(blob, fileName);

        await createReport.mutateAsync({
          name: newReportName,
          report_type: newReportType,
          file_format: "pdf",
          file_url: filePath,
        });

        downloadPdfBlob(blob, `${safeName}.pdf`);
        toast.success("Report saved and downloaded");
      }
      setIsGenerateOpen(false);
      setNewReportName("");
    } catch (err) {
      toast.error("Failed to create report", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsCreating(false);
    }
  };

  /**
   * `reports.file_url` holds a storage object path, not a URL — the bucket was
   * closed by `20260903000500_reports_bucket_not_public.sql`, so a link has to be
   * minted per click and expires a minute later. Signing is a network call, which
   * is why this is a handler and not the plain `<a href>` it replaced.
   */
  const handleDownloadStored = async (report: { id: string; name: string; file_url: string; file_format: string }) => {
    const ext = report.file_format === "excel" ? "xlsx" : report.file_format === "csv" ? "csv" : "pdf";
    const safeName = report.name.replace(/[^a-zA-Z0-9ก-๙\s-]/g, "_");
    setDownloadingReportId(report.id);
    try {
      await downloadStoredReport(report.file_url, `${safeName}.${ext}`);
    } catch (err) {
      await logError("Failed to mint a signed URL for a stored report", err, { reportId: report.id });
      toast.error("Failed to download report", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setDownloadingReportId(null);
    }
  };

  const handleDelete = async (reportId: string) => {
    await deleteReport.mutateAsync(reportId);
  };

  const filteredReports = reports.filter((r) => {
    if (filterFormat === "all") return true;
    return r.file_format?.toLowerCase() === filterFormat;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8 p-4 md:p-8">
      {/* 1. HEADER SECTION */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between border-b pb-8">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-widest">
            <Sparkles className="h-3.5 w-3.5" /> Intelligence Center
          </div>
          <h1 className="text-4xl font-black tracking-tight">REPORTS</h1>
          <p className="text-muted-foreground">Transform your marketing data into actionable stakeholder insights.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => setIsGenerateOpen(true)}
            className="rounded-xl px-6 h-11 shadow-lg shadow-primary/20 bg-primary"
          >
            <Plus className="h-4 w-4 mr-2" /> Custom Report
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* LEFT: TEMPLATE GALLERY (4 COL) */}
        <div className="lg:col-span-4 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Quick Templates</h3>
            <Badge variant="secondary" className="text-[10px]">PRESET</Badge>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {reportTemplates.map((template) => (
              <Card
                key={template.id}
                className="group cursor-pointer border-none bg-muted/30 transition-all hover:bg-muted/50 hover:ring-1 ring-primary/20 overflow-hidden"
                onClick={() => handleQuickGenerate(template.id, template.name)}
              >
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm bg-background ${template.color}`}>
                    <template.icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-sm group-hover:text-primary transition-colors">{template.name}</h4>
                    <p className="text-xs text-muted-foreground truncate">{template.description}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* RIGHT: RECENT ACTIVITY (8 COL) */}
        <div className="lg:col-span-8 space-y-6">
          <Card className="border-none shadow-none bg-transparent">
            <CardHeader className="px-0 pt-0 flex flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-2">
                <FileCheck className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Recent Archives</CardTitle>
              </div>
              <Select value={filterFormat} onValueChange={setFilterFormat}>
                <SelectTrigger className="w-32 bg-background">
                  <SelectValue placeholder="All Files" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="pdf">PDF Docs</SelectItem>
                  <SelectItem value="excel">Excel Data</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="px-0">
              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-2xl" />
                  ))}
                </div>
              ) : filteredReports.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
                  <p className="font-bold text-muted-foreground">No reports yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Click "Custom Report" to create your first report</p>
                  <Button
                    size="sm"
                    className="mt-4 rounded-xl"
                    onClick={() => setIsGenerateOpen(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" /> Create Report
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredReports.map((report) => (
                    <div
                      key={report.id}
                      className="flex items-center justify-between p-4 rounded-2xl bg-background border hover:border-primary/50 transition-all hover:shadow-md group"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${report.file_format === "pdf" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}`}>
                          {report.file_format === "pdf" ? <FileText className="h-5 w-5" /> : <FileSpreadsheet className="h-5 w-5" />}
                        </div>
                        <div>
                          <h4 className="font-bold text-sm group-hover:text-primary transition-colors">{report.name}</h4>
                          <div className="flex items-center gap-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-0.5">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {report.created_at
                                ? format(new Date(report.created_at), "MMM d, yyyy")
                                : "—"}
                            </span>
                            <Badge variant="outline" className="text-[9px] py-0 h-4">
                              {report.report_type === "channel" ? "Persona" : report.report_type}
                            </Badge>
                            <Badge
                              className={`text-[9px] py-0 h-4 ${report.status === "ready"
                                ? "bg-green-500/10 text-green-600"
                                : "bg-yellow-500/10 text-yellow-600"
                                }`}
                            >
                              {report.status}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="rounded-full h-9 w-9"
                          onClick={() => handleQuickGenerate(report.report_type, report.name, report.id)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {report.file_url ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-xl px-4 h-9 gap-2"
                            disabled={downloadingReportId === report.id}
                            onClick={() => handleDownloadStored({ ...report, file_url: report.file_url as string })}
                          >
                            <Download className="h-3.5 w-3.5" /> Download {report.file_format === "excel" ? "Excel" : report.file_format === "csv" ? "CSV" : "PDF"}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-xl px-4 h-9 gap-2"
                            onClick={() => handleQuickGenerate(report.report_type, report.name, report.id)}
                          >
                            <Download className="h-3.5 w-3.5" /> Generate PDF
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="rounded-full">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="rounded-xl">
                            <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(window.location.href); toast.success("Link copied"); }}>
                              <Share2 className="mr-2 h-4 w-4" /> Share with Team
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDelete(report.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Move to Trash
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* --- CREATE REPORT DIALOG --- */}
      <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Create New Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Report Name</Label>
              <Input
                placeholder="e.g. Monthly Performance Q1 2026"
                value={newReportName}
                onChange={(e) => setNewReportName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Report Type</Label>
              <Select value={newReportType} onValueChange={setNewReportType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reportTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>File Format</Label>
              <Select value={newReportFormat} onValueChange={setNewReportFormat}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="excel">Excel</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date Range</Label>
              <Select value={reportDateMode} onValueChange={(v) => setReportDateMode(v as "7d" | "30d" | "90d" | "custom")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
              {reportDateMode === "custom" && (
                <div className="flex gap-2 items-center">
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="rounded-lg"
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="rounded-lg"
                  />
                </div>
              )}
            </div>
            {(newReportType === "campaign" || newReportType === "roi") && (
              <div className="space-y-3">
                <Label>Charts to include</Label>
                <p className="text-xs text-muted-foreground">Select charts from Campaign / Analytics</p>
                <div className="flex flex-col gap-2 rounded-xl border p-3 bg-muted/20">
                  {REPORT_CHART_OPTIONS.map((opt) => (
                    <label key={opt.id} className="flex items-center gap-3 cursor-pointer hover:bg-muted/30 rounded-lg p-2 -m-1">
                      <Checkbox
                        checked={selectedCharts.includes(opt.id)}
                        onCheckedChange={() => toggleChart(opt.id)}
                      />
                      <opt.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <span className="text-sm font-medium">{opt.name}</span>
                        <span className="text-xs text-muted-foreground block truncate">{opt.description}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {newReportType === "channel" && (
              <p className="text-xs text-muted-foreground">Persona report includes age, gender, interests, device charts and easy-to-read geographic breakdown</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsGenerateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveReport}
              disabled={!newReportName.trim() || createReport.isPending || isCreating}
              className="rounded-xl"
            >
              {(createReport.isPending || isCreating) ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              {isCreating ? `Generating ${newReportFormat === "pdf" ? "PDF" : newReportFormat === "excel" ? "Excel" : "CSV"}...` : "Create Report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden report source for PDF generation when creating from dialog */}
      {isGenerateOpen && (
        <div
          id="report-pdf-source"
          className="fixed left-[-9999px] top-0 w-[800px] bg-background p-12"
          aria-hidden
        >
          <ReportDocument
            reportName={newReportName || "Marketing Report"}
            reportType={newReportType}
            dateRangeLabel={getDateRangeLabel(reportDateMode, dateFrom, dateTo)}
            metrics={metrics}
            selectedCharts={selectedCharts}
            personaData={newReportType === "channel" ? personaData ?? undefined : undefined}
            personaImpressions={newReportType === "channel" ? personaImpressions : undefined}
            revenueMetrics={newReportType === "roi" ? revenueMetrics ?? undefined : undefined}
          />
        </div>
      )}

      {/* --- PREVIEW DIALOG --- */}
      <Dialog
        open={isPreviewOpen}
        onOpenChange={(open) => {
          setIsPreviewOpen(open);
          if (!open) setEditingReportId(null);
        }}
      >
        <DialogContent className="sm:max-w-[850px] p-0 border-none shadow-2xl rounded-3xl overflow-hidden bg-muted/20">
          <div className="h-[80vh] overflow-y-auto p-6 md:p-12">
            <div ref={reportRef} className="bg-background shadow-2xl rounded-sm p-12 min-h-full border">
              <ReportDocument
                reportName={previewReport ?? "Performance Summary"}
                reportType={previewReportType}
                dateRangeLabel={getDateRangeLabel(reportDateMode, dateFrom, dateTo)}
                metrics={metrics}
                selectedCharts={selectedCharts}
                personaData={previewReportType === "channel" ? personaData ?? undefined : undefined}
                personaImpressions={previewReportType === "channel" ? personaImpressions : undefined}
                revenueMetrics={previewReportType === "roi" ? revenueMetrics ?? undefined : undefined}
              />
            </div>
          </div>
          <div className="p-4 bg-background border-t space-y-3">
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Date range:</span>
                <Select value={reportDateMode} onValueChange={(v) => setReportDateMode(v as "7d" | "30d" | "90d" | "custom")}>
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7d">7 days</SelectItem>
                    <SelectItem value="30d">30 days</SelectItem>
                    <SelectItem value="90d">90 days</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
                {reportDateMode === "custom" && (
                  <div className="flex gap-1 items-center">
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs w-[130px]" />
                    <span className="text-muted-foreground">to</span>
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs w-[130px]" />
                  </div>
                )}
              </div>
              {(previewReportType === "campaign" || previewReportType === "roi") && (
                <>
                  <span className="text-xs font-medium text-muted-foreground mr-2">Charts:</span>
                  {REPORT_CHART_OPTIONS.map((opt) => (
                    <label key={opt.id} className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <Checkbox
                        checked={selectedCharts.includes(opt.id)}
                        onCheckedChange={() => toggleChart(opt.id)}
                      />
                      {opt.name}
                    </label>
                  ))}
                </>
              )}
            </div>
            <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Viewing Page 1 of 1</span>
            <div className="flex gap-2 flex-wrap">
              <Button variant="ghost" onClick={() => setIsPreviewOpen(false)}>Close</Button>
              <Button
                className="rounded-xl px-6 bg-primary"
                onClick={() => handleDownloadPDF(false)}
                disabled={isDownloading}
              >
                {isDownloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                Download PDF
              </Button>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={handleDownloadExcel}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Download Excel
              </Button>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => handleDownloadPDF(true)}
                disabled={isDownloading}
              >
                {isDownloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileCheck className="h-4 w-4 mr-2" />}
                Save & Download
              </Button>
            </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value, change }: { label: string; value: string; change?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-black">{value}</span>
        {change && <span className="text-[10px] font-bold text-green-500">{change}</span>}
      </div>
    </div>
  );
}

interface ReportDocumentProps {
  reportName: string;
  reportType: string;
  dateRangeLabel?: string;
  // The shared type rather than a hand-copied shape. This was a structural
  // duplicate of DashboardMetrics, so adding a field to the hook broke the
  // handoff to ReportChartBlocks, which does take DashboardMetrics.
  metrics?: DashboardMetrics | null;
  selectedCharts?: ReportChartId[];
  personaData?: { age_distribution: Record<string, number>; gender: Record<string, number>; top_locations: { name: string; pct: number }[]; interests: { name: string; pct: number }[]; device_type: Record<string, number> } | null;
  personaImpressions?: number;
  revenueMetrics?: DerivedRevenue | null;
}

function ReportDocument({ reportName, reportType, dateRangeLabel, metrics, selectedCharts = [], personaData, personaImpressions = 0, revenueMetrics }: ReportDocumentProps) {
  const imp = metrics?.totalImpressions ?? 0;
  const clicks = metrics?.totalClicks ?? 0;
  const spend = metrics?.totalSpend ?? 0;
  const conv = metrics?.totalConversions ?? 0;
  const ctr = metrics?.avgCtr ?? 0;
  const cpc = metrics?.avgCpc ?? 0;
  // Null-preserving on purpose. This document is exported and sent to other
  // people, so a ROAS printed here outlives any caveat on screen — `?? 0` would
  // put "0.0x" in a PDF for a window nobody measured revenue over.
  const roasLine = (metrics ? formatRoas(metrics) : null) ?? "—";

  let kpiCards = null;

  if (reportType === "roi") {
    // ฿0 and "—" are different claims, and this document gets exported and
    // sent to other people. With no measured revenue there is no revenue and
    // no profit to state, so the cells say so rather than printing a zero a
    // reader would take as "this campaign earned nothing".
    const avgCpa = conv > 0 ? spend / conv : 0;
    const revenueLine = revenueMetrics
      ? formatMetricValue(revenueMetrics.gross_revenue, "currency")
      : "—";
    const profitLine = revenueMetrics
      ? formatMetricValue(revenueMetrics.net_revenue - spend, "currency")
      : "—";

    kpiCards = (
      <>
        <Metric label="Total Revenue" value={revenueLine} />
        <Metric label="Net Profit" value={profitLine} />
        <Metric label="Ad Spend" value={formatMetricValue(spend, "currency")} />
        <Metric label="Conversions" value={formatMetricValue(conv, "number")} />
        <Metric label="Avg CPA" value={formatMetricValue(avgCpa, "currency")} />
        <Metric label="ROAS" value={roasLine} />
      </>
    );
  } else if (reportType === "channel") { // channel corresponds to Persona
    let topAge = "—";
    if (personaData?.age_distribution) {
      const sorted = Object.entries(personaData.age_distribution).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0) topAge = sorted[0][0];
    }
    let topLoc = "—";
    if (personaData?.top_locations && personaData.top_locations.length > 0) {
      topLoc = personaData.top_locations[0].name;
    }
    
    const audienceSize = personaImpressions > 0 ? personaImpressions : imp;
    
    kpiCards = (
      <>
        <Metric label="Total Audience Size" value={formatMetricValue(audienceSize, "number")} />
        <Metric label="Top Age Group" value={topAge} />
        <Metric label="Top Location" value={topLoc} />
        <Metric label="Avg Engagement Rate" value={formatMetricValue(ctr, "percent")} />
        <Metric label="Total Clicks" value={formatMetricValue(clicks, "number")} />
        <Metric label="Ad Spend" value={formatMetricValue(spend, "currency")} />
      </>
    );
  } else {
    // campaign (Campaign Performance)
    kpiCards = (
      <>
        <Metric label="Total Impressions" value={formatMetricValue(imp, "number")} />
        <Metric label="CTR Rate" value={formatMetricValue(ctr, "percent")} />
        <Metric label="Ad Spend" value={formatMetricValue(spend, "currency")} />
        <Metric label="Total Clicks" value={formatMetricValue(clicks, "number")} />
        <Metric label="Conversions" value={formatMetricValue(conv, "number")} />
        <Metric label="ROAS" value={roasLine} />
      </>
    );
  }

  return (
    <>
      <div className="flex justify-between items-start mb-12 border-b pb-8">
        <div>
          <div className="bg-primary text-primary-foreground text-[10px] font-black px-2 py-1 rounded w-fit mb-4 tracking-widest">BUZZLY REPORT</div>
          <h2 className="text-3xl font-black uppercase tracking-tighter">{reportName}</h2>
          <p className="text-muted-foreground font-sans italic">
            Generated on {format(new Date(), "MMMM d, yyyy")}
            {dateRangeLabel && ` · Date range: ${dateRangeLabel}`}
          </p>
        </div>
        <div className="text-right text-[10px] font-bold text-muted-foreground uppercase leading-loose">
          Ref: #BZY-{Date.now().toString().slice(-6)}<br />
          Type: {reportType === "channel" ? "Persona" : reportType}<br />
          Status: Finalized
        </div>
      </div>
      <div className="grid grid-cols-3 gap-8 mb-12">
        {kpiCards}
      </div>
      <ReportChartBlocks
        metrics={metrics ?? undefined}
        selectedChartIds={selectedCharts}
        reportType={reportType}
        personaData={personaData}
        personaImpressions={personaImpressions}
      />

      <div className="p-6 bg-primary/5 rounded-2xl border border-primary/10 mt-8">
        <h4 className="text-sm font-bold flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-primary" /> Key Strategic Insight
        </h4>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {reportType === "roi"
            ? `Peak ROAS at ${roasLine} with total ad spend ฿${spend.toLocaleString("th-TH")} and ${conv.toLocaleString()} conversions`
            : reportType === "channel"
              ? "Platform performance comparison — Persona and easy-to-read geographic charts"
              : `Overall campaign performance: Impressions ${formatMetricValue(imp, "number")}, Clicks ${formatMetricValue(clicks, "number")}, Spend ฿${spend.toLocaleString("th-TH")}. Avg CTR ${ctr.toFixed(2)}% and ROAS ${roasLine}`}
        </p>
      </div>
    </>
  );
}

export default function Reports() {
  return (
    <PlanRestrictedPage requiredFeature="customReports" featureDescription="Create and download custom marketing reports">
      <ReportsContent />
    </PlanRestrictedPage>
  );
}