import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";

export async function generatePdfFromElement(element: HTMLElement): Promise<Blob> {
  const canvas = await html2canvas(element, {
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
  return pdf.output("blob");
}

export async function uploadReportPdf(blob: Blob, fileName: string): Promise<string> {
  return uploadReportFile(blob, fileName, "application/pdf");
}

/**
 * How long a minted report link stays valid. Long enough for a click to become a
 * finished download on a slow connection, short enough that a URL scraped out of
 * the address bar is dead before it can be pasted anywhere.
 */
const SIGNED_URL_TTL_SECONDS = 60;

/**
 * Uploads the file and returns its **storage object path**, not a URL.
 *
 * `20260903000500_reports_bucket_not_public.sql` closed the `reports` bucket: the
 * bucket is private and the only SELECT policy is the uploader's own. So
 * `getPublicUrl` — which this used to return — now hands back a link that 404s
 * for everyone, including the person who just made the report. The path is the
 * durable thing; a URL is minted per click by `createReportSignedUrl`.
 *
 * `reports.file_url` therefore holds an object path from here on. The column
 * keeps its name because renaming it is a migration, and the read side is the
 * two call sites below.
 */
export async function uploadReportFile(
  blob: Blob,
  fileName: string,
  contentType: string
): Promise<string> {
  const { error } = await supabase.storage
    .from("reports")
    .upload(fileName, blob, {
      contentType,
      upsert: true,
    });

  if (error) throw error;

  return fileName;
}

/**
 * The object path for a stored report.
 *
 * Rows written before the bucket was closed held a full `/object/public/reports/`
 * URL. The migration nulled every such row, so this should never see one — but
 * recovering the object name costs one split and repairs the row instead of
 * failing on it, which is the better behaviour if one ever turns up from a
 * client running older code.
 */
export function reportObjectPath(stored: string): string {
  const marker = "/reports/";
  const at = stored.lastIndexOf(marker);
  const path = at === -1 ? stored : stored.slice(at + marker.length);
  return path.split("?")[0];
}

/**
 * Mints a short-lived link to a stored report.
 *
 * Pass `downloadAs` to have Storage set `Content-Disposition: attachment` with
 * that filename, so the browser saves the file instead of rendering the PDF.
 */
export async function createReportSignedUrl(
  stored: string,
  downloadAs?: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from("reports")
    .createSignedUrl(reportObjectPath(stored), SIGNED_URL_TTL_SECONDS, {
      download: downloadAs ?? true,
    });

  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Storage returned no signed URL");

  return data.signedUrl;
}

/** Mints a link for a stored report and starts the download. */
export async function downloadStoredReport(
  stored: string,
  downloadAs: string
): Promise<void> {
  const signedUrl = await createReportSignedUrl(stored, downloadAs);
  // Assigning `location.href` to an attachment response downloads without
  // navigating away, and unlike `window.open` it is not eaten by a popup
  // blocker — the click and the navigation are separated by an await here.
  window.location.href = signedUrl;
}

export function downloadPdfBlob(blob: Blob, fileName: string): void {
  downloadBlob(blob, fileName);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
