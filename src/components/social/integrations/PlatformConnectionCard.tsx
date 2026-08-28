import { useState } from "react";
import { RefreshCw, Unplug, Plug, KeyRound, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConnectionStatusBadge } from "./ConnectionStatusBadge";
import { ApiKeyDialog } from "./ApiKeyDialog";
import type { Platform } from "@/hooks/usePlatformConnections";

interface PlatformConnectionCardProps {
  platform: Platform;
  onConnect: (id: string, apiKey?: string) => Promise<boolean>;
  onDisconnect: (id: string) => Promise<boolean>;
  onRefresh: (id: string) => Promise<void>;
  onUpdateToken: (id: string, token: string) => Promise<boolean>;
  /** Only passed for platforms with a real OAuth flow. */
  onOAuthConnect?: (id: string) => Promise<void>;
}

const PLATFORM_BG: Record<string, string> = {
  facebook: "bg-blue-600",
  instagram: "bg-gradient-to-br from-purple-500 to-pink-500",
  tiktok: "bg-black",
  shopee: "bg-orange-500",
  google: "bg-red-500",
};

const PLATFORM_DESCRIPTIONS: Record<string, string> = {
  facebook: "ซิงค์แคมเปญโฆษณาและข้อมูล Insights จาก Facebook Ads",
  instagram: "ดึงข้อมูลโพสต์และ Engagement จาก Instagram Business",
  tiktok: "ติดตามประสิทธิภาพโฆษณาจาก TikTok Ads Manager",
  shopee: "นำเข้าข้อมูลร้านค้าและยอดขายจาก Shopee",
  google: "เชื่อมต่อ Google Ads สำหรับข้อมูล Search และ Display",
};

export function PlatformConnectionCard({
  platform,
  onConnect,
  onDisconnect,
  onRefresh,
  onUpdateToken,
  onOAuthConnect,
}: PlatformConnectionCardProps) {
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const Icon = platform.icon;
  const bgClass = PLATFORM_BG[platform.slug] ?? "bg-slate-500";
  const description = PLATFORM_DESCRIPTIONS[platform.slug];

  const handleConnect = async (apiKey: string) => {
    setIsPending(true);
    const success = await onConnect(platform.id, apiKey || undefined);
    setIsPending(false);
    if (success) setIsConnectDialogOpen(false);
  };

  const handleUpdateToken = async (apiKey: string) => {
    setIsPending(true);
    const success = await onUpdateToken(platform.id, apiKey);
    setIsPending(false);
    if (success) setIsUpdateDialogOpen(false);
  };

  const handleDisconnect = async () => {
    setIsPending(true);
    await onDisconnect(platform.id);
    setIsPending(false);
  };

  const handleRefresh = async () => {
    setIsPending(true);
    await onRefresh(platform.id);
    setIsPending(false);
  };

  return (
    <>
      <div
        className={cn(
          "rounded-2xl border border-border/40 bg-white dark:bg-slate-900 shadow-sm p-5 flex flex-col gap-4",
          "transition-shadow hover:shadow-md",
          platform.status === "error" && "border-red-200 dark:border-red-800"
        )}
      >
        {/* Top row: icon + name + status */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex-shrink-0 h-11 w-11 rounded-xl flex items-center justify-center text-white shadow-sm",
              bgClass
            )}
          >
            {Icon ? (
              <Icon className="h-5 w-5" />
            ) : platform.emoji ? (
              <span className="text-lg leading-none">{platform.emoji}</span>
            ) : (
              <MessageCircle className="h-5 w-5" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-foreground">{platform.name}</h3>
              <ConnectionStatusBadge status={platform.status} />
            </div>
            {platform.category_name && (
              <p className="text-xs text-muted-foreground mt-0.5">{platform.category_name}</p>
            )}
          </div>
        </div>

        {/* Description */}
        {description && (
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        )}

        {/* Error message */}
        {platform.status === "error" && platform.error && (
          <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 border border-red-200 dark:border-red-800">
            {platform.error}
          </p>
        )}

        {/* Last sync */}
        {platform.lastSync && platform.status === "connected" && (
          <p className="text-xs text-muted-foreground">
            ซิงค์ล่าสุด: <span className="text-foreground">{platform.lastSync}</span>
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap mt-auto pt-1">
          {platform.status === "connected" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefresh}
                disabled={isPending}
                className="flex-1 sm:flex-none gap-1.5"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isPending && "animate-spin")} />
                รีเฟรช
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsUpdateDialogOpen(true)}
                disabled={isPending}
                className="flex-1 sm:flex-none gap-1.5"
              >
                <KeyRound className="h-3.5 w-3.5" />
                อัปเดต Key
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDisconnect}
                disabled={isPending}
                className="flex-1 sm:flex-none gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 border-red-200 dark:border-red-800"
              >
                <Unplug className="h-3.5 w-3.5" />
                ยกเลิก
              </Button>
            </>
          ) : platform.status === "error" ? (
            <>
              <Button
                size="sm"
                onClick={() => setIsConnectDialogOpen(true)}
                disabled={isPending}
                className="flex-1 gap-1.5"
              >
                <KeyRound className="h-3.5 w-3.5" />
                ลองใหม่ด้วย Key ใหม่
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDisconnect}
                disabled={isPending}
                className="gap-1.5"
              >
                <Unplug className="h-3.5 w-3.5" />
                ยกเลิก
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => setIsConnectDialogOpen(true)}
              disabled={isPending}
              className="flex-1 gap-1.5"
            >
              <Plug className="h-3.5 w-3.5" />
              เชื่อมต่อ
            </Button>
          )}
        </div>
      </div>

      <ApiKeyDialog
        open={isConnectDialogOpen}
        onOpenChange={setIsConnectDialogOpen}
        platformName={platform.name}
        platformSlug={platform.slug}
        onSubmit={handleConnect}
        isPending={isPending}
        mode="connect"
        onOAuthConnect={onOAuthConnect ? () => onOAuthConnect(platform.id) : undefined}
      />

      <ApiKeyDialog
        open={isUpdateDialogOpen}
        onOpenChange={setIsUpdateDialogOpen}
        platformName={platform.name}
        platformSlug={platform.slug}
        onSubmit={handleUpdateToken}
        isPending={isPending}
        mode="update"
      />
    </>
  );
}
