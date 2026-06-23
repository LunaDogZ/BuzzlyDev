import { useState } from "react";
import { useNotifications } from "@/hooks/useNotifications";
import { 
    Dialog, 
    DialogContent, 
    DialogHeader, 
    DialogTitle,
    DialogDescription
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { 
    Bell, 
    Archive, 
    Trash2, 
    RefreshCcw, 
    CheckCheck, 
    Inbox,
    Info,
    MoreHorizontal,
    X
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NotificationsManagerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    role?: "dev" | "support" | "owner";
    theme?: "light" | "dark";
}

export function NotificationsManagerDialog({ 
    open, 
    onOpenChange,
    role = "dev",
    theme = "light"
}: NotificationsManagerDialogProps) {
    const [currentTab, setCurrentTab] = useState("active");
    
    // Map tab names to hook filters
    const hookFilter = currentTab === "unread" ? "unread" : 
                       currentTab === "read" ? "read" : 
                       currentTab === "trash" ? "trash" : "active";

    const { 
        notifications, 
        isLoading,
        markAsRead, 
        markAllAsRead,
        archiveNotifications,
        deleteNotifications,
        restoreNotifications,
        permanentlyDeleteNotifications 
    } = useNotifications(role, hookFilter);

    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleBulkMarkRead = () => {
        selectedIds.forEach(id => markAsRead(id));
        setSelectedIds([]);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className={cn(
                "max-w-3xl h-[85vh] p-0 overflow-hidden flex flex-col sm:rounded-3xl shadow-2xl",
                theme === "dark" ? "bg-[#0B1120] border-slate-800" : "bg-white border-slate-200/60"
            )}>
                <DialogHeader className={cn(
                    "px-6 py-5 border-b sticky top-0 z-10 backdrop-blur-md",
                    theme === "dark" ? "bg-[#020617]/80 border-slate-800" : "bg-white/50 border-slate-100/80"
                )}>
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle className={cn("text-xl font-bold flex items-center gap-2", theme === "dark" ? "text-slate-100" : "text-slate-900")}>
                                <span className={cn("p-1.5 rounded-lg", theme === "dark" ? "bg-blue-500/20" : "bg-blue-500/10")}>
                                    <Bell className={cn("h-5 w-5", theme === "dark" ? "text-blue-400" : "text-blue-600")} />
                                </span>
                                Notification Center
                            </DialogTitle>
                            <DialogDescription className={cn("mt-1 text-xs", theme === "dark" ? "text-slate-400" : "text-slate-500")}>
                                Manage your system alerts and logs efficiently
                            </DialogDescription>
                        </div>
                        <div className="flex items-center gap-2 pr-6">
                            <Button variant="ghost" size="sm" className={cn("hidden sm:flex text-xs h-8 font-medium", theme === "dark" ? "hover:bg-slate-800 text-slate-300" : "hover:bg-slate-100")} onClick={() => markAllAsRead()}>
                                <CheckCheck className="h-4 w-4 mr-1.5" />
                                Mark all as read
                            </Button>
                        </div>
                    </div>
                </DialogHeader>

                <Tabs defaultValue="active" className="flex-1 flex flex-col min-h-0" onValueChange={(v) => {
                    setCurrentTab(v);
                    setSelectedIds([]);
                }}>
                    <div className={cn("px-6 py-3 border-b flex items-center justify-between", theme === "dark" ? "border-slate-800/80 bg-slate-900/30" : "border-slate-100/50 bg-slate-50/30")}>
                        <TabsList className={cn("p-0.5 rounded-xl h-9", theme === "dark" ? "bg-slate-800/80" : "bg-slate-200/50")}>
                            <TabsTrigger value="active" className={cn("rounded-lg text-xs h-8 px-4", theme === "dark" ? "data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400" : "data-[state=active]:bg-white data-[state=active]:shadow-sm text-slate-600")}>All</TabsTrigger>
                            <TabsTrigger value="unread" className={cn("rounded-lg text-xs h-8 px-4", theme === "dark" ? "data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400" : "data-[state=active]:bg-white data-[state=active]:shadow-sm text-slate-600")}>Unread</TabsTrigger>
                            <TabsTrigger value="read" className={cn("rounded-lg text-xs h-8 px-4", theme === "dark" ? "data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400" : "data-[state=active]:bg-white data-[state=active]:shadow-sm text-slate-600")}>Read</TabsTrigger>
                            <TabsTrigger value="trash" className={cn("rounded-lg text-xs h-8 px-4", theme === "dark" ? "data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400" : "data-[state=active]:bg-white data-[state=active]:shadow-sm text-slate-600")}>Trash</TabsTrigger>
                        </TabsList>

                        <div className="flex items-center gap-2 min-w-[200px] justify-end">
                            {selectedIds.length > 0 ? (
                                <div className="flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-200">
                                    {currentTab !== "trash" ? (
                                        <>
                                            {currentTab !== "read" && (
                                                <Button size="sm" variant="outline" className={cn("h-8 rounded-lg text-[11px] px-3", theme === "dark" ? "border-slate-700 hover:bg-slate-800 bg-transparent text-slate-300" : "border-slate-200")} onClick={handleBulkMarkRead}>
                                                    Mark as Read
                                                </Button>
                                            )}
                                        </>
                                    ) : (
                                        <Button size="sm" variant="outline" className={cn("h-8 rounded-lg text-[11px] px-3", theme === "dark" ? "border-slate-700 hover:bg-slate-800 bg-transparent text-slate-300" : "border-slate-200")} onClick={() => {
                                            restoreNotifications(selectedIds);
                                            setSelectedIds([]);
                                        }}>
                                            <RefreshCcw className="h-3 w-3 mr-1.5" />
                                            Restore
                                        </Button>
                                    )}
                                    <Button size="sm" variant="outline" className={cn("h-8 rounded-lg text-[11px] px-3", theme === "dark" ? "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20" : "bg-red-50 border-red-100 text-red-600 hover:bg-red-100")} onClick={() => {
                                        deleteNotifications(selectedIds);
                                        setSelectedIds([]);
                                    }}>
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                </div>
                            ) : (
                                <span className={cn("text-[10px] font-medium uppercase tracking-widest", theme === "dark" ? "text-slate-500" : "text-slate-400")}>
                                    {currentTab === 'active' ? 'ALL' : currentTab.toUpperCase()}
                                </span>
                            )}
                        </div>
                    </div>

                    <ScrollArea className={cn("flex-1", theme === "dark" ? "bg-[#0B1120]" : "bg-white")}>
                        {currentTab === "trash" && (
                            <div className={cn("border-b px-6 py-2.5 flex items-center gap-2.5 text-[11px]", theme === "dark" ? "bg-amber-500/10 border-amber-500/20 text-amber-500" : "bg-amber-50/60 border-amber-100/50 text-amber-700")}>
                                <Info className="h-3.5 w-3.5" />
                                Notifications in Trash will be automatically deleted after 15 days.
                            </div>
                        )}

                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center h-[300px] space-y-3">
                                <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                <span className="text-xs text-slate-400">Loading...</span>
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-40 text-slate-400 px-10 text-center">
                                <div className={cn("p-4 rounded-full mb-4", theme === "dark" ? "bg-slate-800/50" : "bg-slate-50")}>
                                    <Inbox className={cn("h-8 w-8 opacity-40", theme === "dark" ? "text-slate-500" : "text-slate-300")} />
                                </div>
                                <p className={cn("text-sm font-semibold", theme === "dark" ? "text-slate-300" : "text-slate-600")}>No items found</p>
                                <p className="text-[11px] mt-1 max-w-[200px]">Everything is caught up.</p>
                            </div>
                        ) : (
                            <div className={cn("divide-y", theme === "dark" ? "divide-slate-800" : "divide-slate-100/60")}>
                                {[...notifications]
                                    .sort((a, b) => {
                                        if (a.is_read === b.is_read) {
                                            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                                        }
                                        return a.is_read ? 1 : -1;
                                    })
                                    .map((n) => (
                                    <div 
                                        key={n.id} 
                                        className={cn(
                                            "group flex items-start gap-3 p-5 transition-all duration-200 relative",
                                            theme === "dark" 
                                                ? (n.is_read ? "hover:bg-slate-800/30" : "bg-blue-500/5 hover:bg-blue-500/10")
                                                : (n.is_read ? "hover:bg-slate-50/80" : "bg-blue-50/30 hover:bg-blue-50/50")
                                        )}
                                    >
                                        <div className="pt-1 select-none">
                                            <Checkbox 
                                                checked={selectedIds.includes(n.id)}
                                                onCheckedChange={() => toggleSelect(n.id)}
                                                className={cn("rounded-md h-4 w-4 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500", theme === "dark" ? "border-slate-700 bg-slate-900" : "border-slate-300 bg-white")}
                                            />
                                        </div>
                                        
                                        <div className="flex-1 min-w-0 pr-10">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3 className={cn(
                                                    "text-sm font-bold truncate leading-none",
                                                    n.is_read 
                                                        ? (theme === "dark" ? "text-slate-400" : "text-slate-600") 
                                                        : (theme === "dark" ? "text-slate-100" : "text-slate-900")
                                                )}>
                                                    {n.title}
                                                </h3>
                                                {!n.is_read && (
                                                    <span className="flex h-1.5 w-1.5 rounded-full bg-blue-500 ring-4 ring-blue-500/10" />
                                                )}
                                            </div>
                                            <p className={cn("text-[13px] line-clamp-2 leading-relaxed font-medium", theme === "dark" ? "text-slate-300" : "text-slate-500")}>
                                                {n.body}
                                            </p>
                                            <div className="flex items-center gap-3 mt-2.5">
                                                <span className={cn("text-[9px] font-bold uppercase tracking-tighter px-1.5 py-0.5 rounded", theme === "dark" ? "text-slate-400 bg-slate-800" : "text-slate-400 bg-slate-100/60")}>
                                                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                                                </span>
                                                <span className={cn("text-[9px] uppercase tracking-widest font-bold", theme === "dark" ? "text-blue-400" : "text-blue-500/80")}>
                                                    #{n.type.split('_').pop()}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="absolute right-4 top-5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className={cn("h-8 w-8 rounded-full border shadow-sm", theme === "dark" ? "border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300" : "border-slate-200 bg-white hover:bg-slate-50")}>
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className={cn("w-40 rounded-xl shadow-xl", theme === "dark" ? "border-slate-800 bg-slate-900" : "border-slate-200/60 bg-white")}>
                                                    {!n.is_read && (
                                                        <DropdownMenuItem 
                                                            className={cn("text-xs font-medium cursor-pointer", theme === "dark" ? "focus:bg-blue-500/20 focus:text-blue-400 text-slate-300" : "focus:bg-blue-50 focus:text-blue-600")}
                                                            onClick={() => markAsRead(n.id)}
                                                        >
                                                            <CheckCheck className="h-3.5 w-3.5 mr-2" />
                                                            Mark as read
                                                        </DropdownMenuItem>
                                                    )}
                                                    {currentTab === "trash" ? (
                                                        <DropdownMenuItem 
                                                            className={cn("text-xs font-medium cursor-pointer", theme === "dark" ? "focus:bg-emerald-500/20 focus:text-emerald-400 text-slate-300" : "focus:bg-emerald-50 focus:text-emerald-600")}
                                                            onClick={() => restoreNotifications([n.id])}
                                                        >
                                                            <RefreshCcw className="h-3.5 w-3.5 mr-2" />
                                                            Restore
                                                        </DropdownMenuItem>
                                                    ) : null}
                                                    <DropdownMenuItem 
                                                        className={cn("text-xs font-medium cursor-pointer", theme === "dark" ? "text-red-400 focus:bg-red-500/20 focus:text-red-300" : "text-red-600 focus:bg-red-50 focus:text-red-700")}
                                                        onClick={() => (currentTab === "trash" ? permanentlyDeleteNotifications([n.id]) : deleteNotifications([n.id]))}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                                                        {currentTab === "trash" ? "Delete permanently" : "Move to Trash"}
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </ScrollArea>
                </Tabs>
                
                <div className={cn("p-4 border-t flex items-center justify-between text-[10px] font-medium tracking-wide", theme === "dark" ? "border-slate-800 bg-[#0B1120] text-slate-500" : "border-slate-100/50 bg-slate-50/30 text-slate-400")}>
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1.5"><div className={cn("h-1.5 w-1.5 rounded-full", theme === "dark" ? "bg-slate-600" : "bg-slate-300")} /> Auto-sync active</span>
                        <span className="flex items-center gap-1.5"><div className={cn("h-1.5 w-1.5 rounded-full", theme === "dark" ? "bg-slate-600" : "bg-slate-300")} /> Role: {role.toUpperCase()}</span>
                    </div>
                    {notifications.length > 0 && (
                        <span>Showing {notifications.length} notifications</span>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
