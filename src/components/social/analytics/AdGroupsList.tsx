import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FolderOpen,
  FileText,
  Link2,
  Megaphone,
  Leaf,
  Pencil,
  Trash2,
  Loader2,
} from "lucide-react";
import { useAdGroups, type AdGroupWithCount } from "@/hooks/useAdGroups";
import { AdGroupFormDialog } from "@/components/social/analytics/AdGroupFormDialog";
import { TH_DATE_LOCALE } from "@/lib/date";

interface AdGroupsListProps {
  onGroupsChange?: (groups: { id: string; name: string }[]) => void;
}

export function AdGroupsList({ onGroupsChange }: AdGroupsListProps) {
  const { adGroups, isLoading, deleteAdGroup } = useAdGroups();
  const [editingGroup, setEditingGroup] = useState<AdGroupWithCount | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);

  useEffect(() => {
    onGroupsChange?.(adGroups.map((group) => ({ id: group.id, name: group.name })));
  }, [adGroups, onGroupsChange]);

  const handleEditClick = (group: AdGroupWithCount) => {
    setEditingGroup(group);
    setEditDialogOpen(true);
  };

  const handleEditDialogChange = (open: boolean) => {
    setEditDialogOpen(open);
    if (!open) setEditingGroup(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingGroupId) return;
    await deleteAdGroup.mutateAsync(deletingGroupId).catch(() => {});
    setDeletingGroupId(null);
  };

  const pendingDeleteGroup = adGroups.find((g) => g.id === deletingGroupId);

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "active":
        return <Badge className="bg-success text-success-foreground">กำลังทำงาน</Badge>;
      case "paused":
        return <Badge className="bg-warning text-warning-foreground">หยุดชั่วคราว</Badge>;
      case "draft":
        return <Badge variant="secondary">แบบร่าง</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getStatusIcon = (status: string | null) => {
    switch (status) {
      case "active":
        return <div className="h-2 w-2 rounded-full bg-success" />;
      case "paused":
        return <div className="h-2 w-2 rounded-full bg-warning" />;
      default:
        return <div className="h-2 w-2 rounded-full bg-muted" />;
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-5 w-3/4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{adGroups.length} Ad Groups</p>
            <p className="text-xs text-muted-foreground">
              Manual grouping overview for paid ads and linked organic posts
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {adGroups.map((group) => (
            <Card key={group.id} className="relative group/card">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {getStatusIcon(group.status)}
                    <CardTitle className="text-base truncate">{group.name}</CardTitle>
                  </div>
                  {getStatusBadge(group.status)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex flex-wrap gap-2">
                  {group.group_type && (
                    <Badge variant="outline" className="capitalize">
                      {group.group_type.replace("-", " ")}
                    </Badge>
                  )}
                  <Badge className="gap-1 bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400">
                    <Megaphone className="h-3 w-3" />
                    Paid Group
                  </Badge>
                </div>

                {group.description && (
                  <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
                    {group.description}
                  </p>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Megaphone className="h-4 w-4 text-blue-500" />
                      {group.ads_count} โฆษณา
                    </span>
                    <span className="flex items-center gap-1">
                      <Leaf className="h-4 w-4 text-emerald-500" />
                      {group.posts_count} โพสต์
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  อัปเดตล่าสุด:{" "}
                  {new Date(group.updated_at).toLocaleDateString(TH_DATE_LOCALE, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline" className="gap-1">
                    <FileText className="h-3 w-3" />
                    Shared reporting entity
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <Link2 className="h-3 w-3" />
                    Linked content summary
                  </Badge>
                </div>

                {/* Edit / Delete actions */}
                <div className="mt-4 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5"
                    onClick={() => handleEditClick(group)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    แก้ไข
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/40"
                    onClick={() => setDeletingGroupId(group.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    ลบ
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {adGroups.length === 0 && (
          <Card className="p-8">
            <div className="text-center text-muted-foreground">
              <FolderOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>ยังไม่มีกลุ่มโฆษณา</p>
              <p className="text-sm">สร้างกลุ่มโฆษณาใหม่เพื่อเริ่มจัดหมวดหมู่ paid ads และ organic posts</p>
            </div>
          </Card>
        )}
      </div>

      {/* Edit Dialog */}
      <AdGroupFormDialog
        open={editDialogOpen}
        onOpenChange={handleEditDialogChange}
        group={editingGroup}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={Boolean(deletingGroupId)}
        onOpenChange={(open) => {
          if (!open) setDeletingGroupId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบกลุ่มโฆษณา</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  คุณแน่ใจหรือไม่ว่าต้องการลบกลุ่มโฆษณา{" "}
                  <span className="font-semibold text-foreground">
                    {pendingDeleteGroup?.name}
                  </span>
                  ?
                </p>
                {(pendingDeleteGroup?.ads_count ?? 0) > 0 || (pendingDeleteGroup?.posts_count ?? 0) > 0 ? (
                  <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-warning-foreground">
                    กลุ่มนี้มี <strong>{pendingDeleteGroup?.ads_count} โฆษณา</strong> และ{" "}
                    <strong>{pendingDeleteGroup?.posts_count} โพสต์</strong> ที่เชื่อมอยู่ — การลบจะยกเลิกการเชื่อมโยง (SET NULL) ไม่ลบเนื้อหา
                  </p>
                ) : null}
                <p>การกระทำนี้ไม่สามารถย้อนกลับได้</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAdGroup.isPending}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteAdGroup.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteAdGroup.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  กำลังลบ...
                </>
              ) : (
                "ลบกลุ่มโฆษณา"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
