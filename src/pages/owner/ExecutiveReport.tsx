import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  Download,
  Send,
  Calendar,
  Clock,
  CheckCircle2,
  Presentation,
  FileSpreadsheet,
  Trash2,
  Users,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useReports } from "@/hooks/useReports";
import { useScheduledReports } from "@/hooks/useScheduledReports";
import { useSubscriptionMetrics, useFeedbackMetrics, useProductUsageMetrics, useAARRRMetrics } from "@/hooks/useOwnerMetrics";
import { useCustomerTiers } from "@/hooks/useCustomerTiers";
import { useDiscounts } from "@/hooks/useDiscounts";
import { ExecutiveReportDocument } from "@/components/owner/ExecutiveReportDocument";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/utils";

// Available metrics exactly matching Owner Sidebar
const availableMetrics = [
  { id: "business", label: "Business Performance (Revenue, ARR, Churn)", category: "Revenue & Growth" },
  { id: "product", label: "Product Usage (AARRR Funnel)", category: "Engagement" },
  { id: "tiers", label: "Customer Tiers (Loyalty Distribution)", category: "Audience" },
  { id: "feedback", label: "User Feedback (NPS, CSAT, Sentiment)", category: "Customer Satisfaction" },
  { id: "discounts", label: "Discount Codes (Promotions & Usage)", category: "Marketing" },
];

export default function ExecutiveReport() {
  const { toast } = useToast();
  const { reports, isLoading: reportsLoading, deleteReport, createReport } = useReports();
  const { scheduledReports, isLoading: scheduledLoading, toggleActive, deleteScheduledReport, createScheduledReport } = useScheduledReports();
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([
    "business",
    "product",
    "tiers",
    "feedback",
    "discounts",
  ]);
  const [reportFormat, setReportFormat] = useState("pdf");
  const [dateRange, setDateRange] = useState("last-month");
  const [activeTab, setActiveTab] = useState("generate");

  // Schedule Report Modal State
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    name: "Executive Summary",
    frequency: "weekly" as "daily" | "weekly" | "monthly",
    recipients: "",
  });

  const reportRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: subscriptionMetrics } = useSubscriptionMetrics();
  const { data: feedbackMetrics } = useFeedbackMetrics();
  const { data: productUsageMetrics } = useProductUsageMetrics();
  const { data: aarrrMetrics } = useAARRRMetrics();
  const { data: tierMetrics } = useCustomerTiers(dateRange === "last-year" ? "1y" : dateRange === "last-month" ? "30d" : "90d");
  const { discounts } = useDiscounts();

  const reportData = {
    subscriptionMetrics,
    feedbackMetrics,
    productUsageMetrics,
    aarrrMetrics,
    tierMetrics,
    discounts
  };

  const handleMetricToggle = (metricId: string) => {
    setSelectedMetrics((prev) =>
      prev.includes(metricId)
        ? prev.filter((id) => id !== metricId)
        : [...prev, metricId]
    );
  };

  const handleGenerateReport = async () => {
    if (!reportRef.current) return;

    setIsGenerating(true);
    toast({
      title: "Generating Report",
      description: "Compiling document and data...",
    });

    try {
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/jpeg", 1.0);
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight);
      const pdfBlob = pdf.output("blob");

      const fileName = `executive_report_${new Date().getTime()}.pdf`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('reports')
        .upload(fileName, pdfBlob, {
          contentType: 'application/pdf',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('reports')
        .getPublicUrl(fileName);

      await createReport.mutateAsync({
        name: `Executive Report - ${dateRange}`,
        report_type: 'executive',
        file_format: 'pdf',
        file_url: publicUrl,
      });

      toast({
        title: "Success",
        description: "Your report is ready in the history tab.",
      });
    } catch (error) {
      console.error("PDF generation failed:", error);
      toast({
        variant: "destructive",
        title: "Error Generating Report",
        description: getErrorMessage(error),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleScheduleReport = async () => {
    if (!scheduleForm.name || !scheduleForm.recipients) {
      toast({
        variant: "destructive",
        title: "Missing Information",
        description: "Please provide a name and at least one recipient email.",
      });
      return;
    }

    const emailList = scheduleForm.recipients
      .split(",")
      .map(e => e.trim())
      .filter(e => e.includes("@"));

    if (emailList.length === 0) {
      toast({
        variant: "destructive",
        title: "Invalid Emails",
        description: "Please provide valid email addresses separated by commas.",
      });
      return;
    }

    try {
      await createScheduledReport.mutateAsync({
        name: scheduleForm.name,
        frequency: scheduleForm.frequency,
        recipients: emailList,
        format: reportFormat as "pdf" | "csv" | "excel",
      });
      setIsScheduleModalOpen(false);
      setActiveTab("scheduled");
      setScheduleForm({
        name: "Executive Summary",
        frequency: "weekly",
        recipients: "",
      });
    } catch (error) {
      // Error is handled by the mutation hook
    }
  };

  const groupedMetrics = availableMetrics.reduce((acc, metric) => {
    if (!acc[metric.category]) {
      acc[metric.category] = [];
    }
    acc[metric.category].push(metric);
    return acc;
  }, {} as Record<string, typeof availableMetrics>);

  return (
    <div className="space-y-6">
      <div style={{ position: 'absolute', top: '-9999px', left: '-9999px' }}>
        <ExecutiveReportDocument
          ref={reportRef}
          data={reportData}
          selectedMetrics={selectedMetrics}
          dateRange={dateRange}
        />
      </div>

      <div>
        <h1 className="text-3xl font-bold">Executive Report</h1>
        <p className="text-muted-foreground">
          Generate and export reports for stakeholders
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="generate">Generate Report</TabsTrigger>
          <TabsTrigger value="history">Report History</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled Reports</TabsTrigger>
        </TabsList>

        {/* Generate Report Tab */}
        <TabsContent value="generate" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Metrics Selection */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Select Metrics</CardTitle>
                <CardDescription>
                  Choose the metrics to include in your report
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {Object.entries(groupedMetrics).map(([category, metrics]) => (
                    <div key={category}>
                      <h4 className="mb-3 text-sm font-medium text-muted-foreground">
                        {category}
                      </h4>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {metrics.map((metric) => (
                          <div
                            key={metric.id}
                            className="flex items-center space-x-3 rounded-lg border p-3"
                          >
                            <Checkbox
                              id={metric.id}
                              checked={selectedMetrics.includes(metric.id)}
                              onCheckedChange={() => handleMetricToggle(metric.id)}
                            />
                            <Label
                              htmlFor={metric.id}
                              className="flex-1 cursor-pointer text-sm"
                            >
                              {metric.label}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Report Configuration */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Report Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Date Range</Label>
                    <Select value={dateRange} onValueChange={setDateRange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="last-week">Last Week</SelectItem>
                        <SelectItem value="last-month">Last Month</SelectItem>
                        <SelectItem value="last-quarter">Last Quarter</SelectItem>
                        <SelectItem value="last-year">Last Year</SelectItem>
                        <SelectItem value="custom">Custom Range</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Export Format</Label>
                    <Select value={reportFormat} onValueChange={setReportFormat}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pdf">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            PDF Document
                          </div>
                        </SelectItem>
                        <SelectItem value="slides">
                          <div className="flex items-center gap-2">
                            <Presentation className="h-4 w-4" />
                            Presentation Slides
                          </div>
                        </SelectItem>
                        <SelectItem value="excel">
                          <div className="flex items-center gap-2">
                            <FileSpreadsheet className="h-4 w-4" />
                            Excel Spreadsheet
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="pt-4 space-y-3">
                    <Button
                      className="w-full"
                      onClick={handleGenerateReport}
                      disabled={selectedMetrics.length === 0 || isGenerating}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {isGenerating ? "Generating..." : "Generate Report"}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => setIsScheduleModalOpen(true)}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      Schedule Report
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Selected Metrics</CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedMetrics.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No metrics selected
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {selectedMetrics.map((id) => {
                        const metric = availableMetrics.find((m) => m.id === id);
                        return (
                          <Badge key={id} variant="secondary">
                            {metric?.label}
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Report History Tab */}
        <TabsContent value="history" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Reports</CardTitle>
              <CardDescription>Previously generated reports</CardDescription>
            </CardHeader>
            <CardContent>
              {reportsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
                </div>
              ) : reports.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center rounded-lg border border-dashed">
                  <FileText className="h-10 w-10 text-muted-foreground/30 mb-3" />
                  <p className="font-medium text-muted-foreground">No reports yet</p>
                  <p className="text-sm text-muted-foreground">Generate your first report above</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {reports.map((report) => (
                    <div
                      key={report.id}
                      className="flex items-center justify-between rounded-lg border p-4"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <FileText className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{report.name}</p>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {new Date(report.created_at).toLocaleDateString()}
                            <Badge variant="secondary">{report.report_type ?? "General"}</Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="gap-1">
                          <CheckCircle2 className="h-3 w-3 text-green-500" />
                          {report.status ?? "completed"}
                        </Badge>
                        <Button variant="ghost" size="sm" asChild>
                          <a href={report.file_url ?? "#"} target="_blank" rel="noopener noreferrer">
                            <Download className="h-4 w-4" />
                          </a>
                        </Button>
                        <Button variant="ghost" size="sm">
                          <Send className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => deleteReport.mutate(report.id)}
                          disabled={deleteReport.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Scheduled Reports Tab */}
        <TabsContent value="scheduled" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Scheduled Reports</CardTitle>
                <CardDescription>Automatically generated reports</CardDescription>
              </div>
              <Button onClick={() => setIsScheduleModalOpen(true)}>
                <Calendar className="mr-2 h-4 w-4" />
                New Schedule
              </Button>
            </CardHeader>
            <CardContent>
              {scheduledLoading ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
                </div>
              ) : scheduledReports.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center rounded-lg border border-dashed">
                  <Clock className="h-10 w-10 text-muted-foreground/30 mb-3" />
                  <p className="font-medium text-muted-foreground">No scheduled reports</p>
                  <p className="text-sm text-muted-foreground">Click "New Schedule" to set up automated reports</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {scheduledReports.map((report) => (
                    <div
                      key={report.id}
                      className="flex items-center justify-between rounded-lg border p-4"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
                          <Clock className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium">{report.name}</p>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Badge variant="secondary" className="capitalize">{report.frequency}</Badge>
                            {report.next_run_at && (
                              <span>Next: {new Date(report.next_run_at).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right text-sm">
                          <p className="font-medium flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {report.recipients.length} recipients
                          </p>
                          <Badge variant="outline" className="text-[10px] uppercase">{report.format}</Badge>
                        </div>
                        <Switch
                          checked={report.is_active}
                          onCheckedChange={(v) => toggleActive.mutate({ id: report.id, is_active: v })}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => deleteScheduledReport.mutate(report.id)}
                          disabled={deleteScheduledReport.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Schedule Report Modal */}
      <Dialog open={isScheduleModalOpen} onOpenChange={setIsScheduleModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Schedule Report Delivery</DialogTitle>
            <DialogDescription>
              Set up automated generation and delivery of this executive report.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Schedule Name</Label>
              <Input
                value={scheduleForm.name}
                onChange={e => setScheduleForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Weekly Stakeholder Update"
              />
            </div>
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select
                value={scheduleForm.frequency}
                onValueChange={v => setScheduleForm(prev => ({ ...prev, frequency: v as "daily" | "weekly" | "monthly" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Recipients (comma-separated emails)</Label>
              <Input
                value={scheduleForm.recipients}
                onChange={e => setScheduleForm(prev => ({ ...prev, recipients: e.target.value }))}
                placeholder="CEO@buzzly.com, investors@buzzly.com"
              />
            </div>
            <div className="pt-4 flex justify-end gap-2 border-t mt-2">
              <Button variant="ghost" onClick={() => setIsScheduleModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleScheduleReport} disabled={!scheduleForm.name || !scheduleForm.recipients}>
                Save Schedule
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
