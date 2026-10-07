import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Bell,
    BellRing,
    AlertCircle,
    ShieldAlert,
    Gift,
    Zap,
    Ticket,
    CheckCheck,
    Loader2,
} from "lucide-react";
import { type Notification, type NotificationType } from "@/hooks/useNotifications";
import { NotificationsManagerDialog } from "./NotificationsManagerDialog";
import { useState } from "react";
import { inAppPath } from "@/lib/inAppPath";

// ─── Type helpers ─────────────────────────────────────────────────────────────

const typeConfig: Record<
    NotificationType | string,
    { icon: React.ReactNode; darkIcon: React.ReactNode; color: string; bg: string; darkBg: string }
> = {
    critical_error: {
        icon: <AlertCircle className="h-4 w-4 text-red-600" />,
        darkIcon: <AlertCircle className="h-4 w-4 text-red-400" />,
        color: "text-red-600",
        bg: "bg-red-50 border-red-100",
        darkBg: "bg-red-500/10 border-red-500/20",
    },
    error_log: {
        icon: <AlertCircle className="h-4 w-4 text-orange-500" />,
        darkIcon: <AlertCircle className="h-4 w-4 text-orange-400" />,
        color: "text-orange-500",
        bg: "bg-orange-50 border-orange-100",
        darkBg: "bg-orange-500/10 border-orange-500/20",
    },
    auth_failure: {
        icon: <ShieldAlert className="h-4 w-4 text-amber-600" />,
        darkIcon: <ShieldAlert className="h-4 w-4 text-amber-500" />,
        color: "text-amber-600",
        bg: "bg-amber-50 border-amber-100",
        darkBg: "bg-amber-500/10 border-amber-500/20",
    },
    redemption_request: {
        icon: <Gift className="h-4 w-4 text-blue-600" />,
        darkIcon: <Gift className="h-4 w-4 text-blue-400" />,
        color: "text-blue-600",
        bg: "bg-blue-50 border-blue-100",
        darkBg: "bg-blue-500/10 border-blue-500/20",
    },
    suspicious_activity: {
        icon: <Zap className="h-4 w-4 text-rose-600" />,
        darkIcon: <Zap className="h-4 w-4 text-rose-400" />,
        color: "text-rose-600",
        bg: "bg-rose-50 border-rose-100",
        darkBg: "bg-rose-500/10 border-rose-500/20",
    },
    discount_exhausted: {
        icon: <Ticket className="h-4 w-4 text-emerald-600" />,
        darkIcon: <Ticket className="h-4 w-4 text-emerald-400" />,
        color: "text-emerald-600",
        bg: "bg-emerald-50 border-emerald-100",
        darkBg: "bg-emerald-500/10 border-emerald-500/20",
    },
};

function getConfig(type: NotificationType | string) {
    return typeConfig[type] ?? typeConfig["error_log"];
}

// ─── NotificationItem ─────────────────────────────────────────────────────────

interface NotificationItemProps {
    notification: Notification;
    onRead: (id: string) => void;
    accentColor: string;
    theme?: "light" | "dark";
}

function NotificationItem({ notification, onRead, accentColor, theme = "light" }: NotificationItemProps) {
    const navigate = useNavigate();
    const config = getConfig(notification.type);

    const handleClick = () => {
        if (!notification.is_read) {
            onRead(notification.id);
        }
        const to = inAppPath(notification.link);
        if (to) {
            navigate(to);
        }
    };

    return (
        <button
            onClick={handleClick}
            className={cn(
                "w-full text-left p-3 rounded-xl border transition-all duration-150 group",
                "hover:shadow-sm active:scale-[0.99]",
                theme === "dark" 
                    ? (notification.is_read ? "bg-slate-900/50 border-slate-800 opacity-60" : config.darkBg)
                    : (notification.is_read ? "bg-slate-50/60 border-slate-100 opacity-60" : config.bg)
            )}
        >
            <div className="flex items-start gap-3">
                {/* Icon */}
                <div className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg relative overflow-hidden",
                    theme === "dark" 
                        ? (notification.is_read ? "bg-slate-800" : "bg-slate-800 border border-slate-700/50 shadow-sm")
                        : (notification.is_read ? "bg-slate-100" : "bg-white shadow-sm")
                )}>
                    {theme === "dark" ? config.darkIcon : config.icon}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                        <p className={cn(
                            "text-sm font-semibold leading-snug truncate",
                            notification.is_read 
                                ? (theme === "dark" ? "text-slate-500" : "text-slate-500") 
                                : (theme === "dark" ? "text-slate-200" : "text-slate-800")
                        )}>
                            {notification.title}
                        </p>
                        {!notification.is_read && (
                            <span className={cn("h-2 w-2 shrink-0 rounded-full", accentColor)} />
                        )}
                    </div>
                    {notification.body && (
                        <p className={cn(
                            "text-xs mt-0.5 line-clamp-2 leading-relaxed",
                            theme === "dark" ? "text-slate-400" : "text-slate-500"
                        )}>
                            {notification.body}
                        </p>
                    )}
                    <p className={cn("text-[10px] mt-1", theme === "dark" ? "text-slate-500" : "text-slate-400")}>
                        {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                    </p>
                </div>
            </div>
        </button>
    );
}

// ─── NotificationPanel ────────────────────────────────────────────────────────

interface NotificationPanelProps {
    notifications: Notification[];
    unreadCount: number;
    isMarkingAll: boolean;
    onMarkAsRead: (id: string) => void;
    onMarkAllAsRead: () => void;
    /** Accent color class for unread dots and badge, e.g. 'bg-emerald-500' */
    accentColor?: string;
    /** Badge bg class e.g. 'bg-emerald-500' */
    badgeColor?: string;
    theme?: "light" | "dark";
}

export function NotificationPanel({
    notifications,
    unreadCount,
    isMarkingAll,
    onMarkAsRead,
    onMarkAllAsRead,
    accentColor = "bg-blue-500",
    badgeColor = "bg-blue-500",
    theme = "light",
}: NotificationPanelProps) {
    const [managerOpen, setManagerOpen] = useState(false);

    return (
        <>
            <Popover>
            <PopoverTrigger asChild>
                <button
                    className={cn(
                        "relative p-2 text-slate-400 hover:text-slate-700",
                        "transition-all duration-150 rounded-lg hover:bg-slate-50 active:scale-90"
                    )}
                    title="Notifications"
                >
                    {unreadCount > 0 ? (
                        <BellRing className="h-5 w-5 animate-[wiggle_0.5s_ease-in-out]" />
                    ) : (
                        <Bell className="h-5 w-5" />
                    )}

                    {/* Badge */}
                    {unreadCount > 0 && (
                        <span className={cn(
                            "absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center",
                            "rounded-full text-[9px] font-bold text-white",
                            badgeColor, "shadow"
                        )}>
                            {unreadCount}
                        </span>
                    )}
                </button>
            </PopoverTrigger>

            <PopoverContent
                side="top"
                align="end"
                className={cn(
                    "w-80 p-0 rounded-2xl shadow-xl border animate-scale-in",
                    theme === "dark" ? "bg-[#0B1120] border-slate-800" : "bg-white border-slate-100"
                )}
                sideOffset={12}
            >
                {/* Header */}
                <div className={cn("flex items-center justify-between px-4 py-3 border-b", theme === "dark" ? "border-slate-800/80" : "border-slate-100")}>
                    <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4 text-slate-500" />
                        <span className={cn("font-semibold text-sm", theme === "dark" ? "text-slate-200" : "text-slate-800")}>Notifications</span>
                        {unreadCount > 0 && (
                            <span className={cn(
                                "flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white",
                                badgeColor
                            )}>
                                {unreadCount}
                            </span>
                        )}
                    </div>
                    {unreadCount > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                                "h-7 text-xs px-2 uppercase tracking-wider font-bold", 
                                theme === "dark" ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800" : "text-slate-500 hover:text-slate-800"
                            )}
                            onClick={onMarkAllAsRead}
                            disabled={isMarkingAll}
                        >
                            {isMarkingAll
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <CheckCheck className="h-3 w-3 mr-1" />
                            }
                            MARK ALL READ
                        </Button>
                    )}
                </div>

                {/* Body */}
                <ScrollArea className="h-[400px]">
                    {notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                            <Bell className="h-8 w-8 mb-2 opacity-30" />
                            <p className="text-sm">No notifications</p>
                        </div>
                    ) : (
                        <div className="p-2 space-y-1.5">
                            {[...notifications]
                                .sort((a, b) => {
                                    if (a.is_read === b.is_read) {
                                        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                                    }
                                    return a.is_read ? 1 : -1;
                                })
                                .map((n) => (
                                <NotificationItem
                                    key={n.id}
                                    notification={n}
                                    onRead={onMarkAsRead}
                                    accentColor={accentColor}
                                    theme={theme}
                                />
                            ))}
                        </div>
                    )}
                </ScrollArea>

                <div className={cn("px-4 py-2 border-t flex flex-col gap-2", theme === "dark" ? "border-slate-800" : "border-slate-100")}>
                    <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                            "w-full text-xs font-bold uppercase tracking-wider",
                            theme === "dark" ? "text-blue-400 hover:text-blue-300 hover:bg-blue-500/10" : "text-blue-600 hover:text-blue-700 hover:bg-blue-50/50"
                        )}
                        onClick={() => setManagerOpen(true)}
                    >
                        VIEW ALL NOTIFICATIONS
                    </Button>
                    {notifications.length > 0 && (
                        <p className={cn("text-[10px] text-center", theme === "dark" ? "text-slate-500" : "text-slate-400")}>
                            Showing last {notifications.length} notifications
                        </p>
                    )}
                </div>
            </PopoverContent>
        </Popover>

        <NotificationsManagerDialog 
            open={managerOpen} 
            onOpenChange={setManagerOpen}
            role="dev"
            theme={theme}
        />
        </>
    );
}
