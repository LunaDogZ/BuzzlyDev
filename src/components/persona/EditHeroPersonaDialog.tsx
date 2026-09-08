import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { toast } from "sonner";

interface EditHeroPersonaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle: string;
  initialBio: string;
  initialAvatarUrl: string | null;
  workspaceId: string;
  onSave: (data: { avatar_url?: string | null; custom_title?: string; custom_bio?: string }) => void;
  isSaving: boolean;
}

export const EditHeroPersonaDialog: React.FC<EditHeroPersonaDialogProps> = ({
  open,
  onOpenChange,
  initialTitle,
  initialBio,
  initialAvatarUrl,
  workspaceId,
  onSave,
  isSaving,
}) => {
  const [title, setTitle] = useState(initialTitle);
  const [bio, setBio] = useState(initialBio);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setBio(initialBio);
      setAvatarUrl(initialAvatarUrl);
    }
  }, [open, initialTitle, initialBio, initialAvatarUrl]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setTitle(initialTitle);
      setBio(initialBio);
      setAvatarUrl(initialAvatarUrl);
    }
    onOpenChange(next);
  };

  const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("File too large (max 2MB)");
      return;
    }
    try {
      setUploading(true);
      const { data: { user } } = await getCurrentUser();
      if (!user) return;

      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${user.id}/persona_${workspaceId}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      setAvatarUrl(publicUrl + "?t=" + Date.now());
      toast.success("Image uploaded successfully");
    } catch (err: unknown) {
      toast.error("Upload failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarUrl(null);
  };

  const handleSubmit = () => {
    onSave({
      avatar_url: avatarUrl,
      custom_title: title.trim() || undefined,
      custom_bio: bio.trim() || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Hero Persona</DialogTitle>
          <DialogDescription>
            Customize the avatar, name, and bio for your audience persona.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div
                className="h-24 w-24 rounded-full overflow-hidden ring-2 ring-border bg-muted flex items-center justify-center cursor-pointer hover:ring-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                ) : (
                  <Camera className="h-10 w-10 text-muted-foreground" />
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleUploadAvatar}
              />
              {avatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveAvatar();
                  }}
                >
                  ×
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Click to add or change image • Max 2MB
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="persona-title">Persona Name</Label>
            <Input
              id="persona-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Modern Bangkok Professional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="persona-bio">Bio</Label>
            <Textarea
              id="persona-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="e.g. Age 25-34, highly active on Mobile, prioritizes Fashion & Beauty trends."
              rows={3}
              className="resize-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSaving || uploading}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
