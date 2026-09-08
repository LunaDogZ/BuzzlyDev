import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { useProfileCustomer } from "@/hooks/useProfileCustomer";
import { Trash2, Upload, Pencil } from "lucide-react";

const STORAGE_KEYS = {
  language: "buzzly_settings_language",
  currency: "buzzly_settings_currency",
  theme: "buzzly_settings_theme",
  socialLinks: "buzzly_settings_social_links",
} as const;

interface SocialLinks {
  linkedin?: string;
  dribbble?: string;
  [key: string]: string | undefined;
}

export const SettingsGeneralTab: React.FC = () => {
  const { toast } = useToast();
  const { data: serverProfile, invalidate } = useProfileCustomer();

  const [profileData, setProfileData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phoneNumber: "",
  });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [editNameOpen, setEditNameOpen] = useState(false);
  const [editContactsOpen, setEditContactsOpen] = useState(false);
  const [editSocialOpen, setEditSocialOpen] = useState(false);
  const [editLangCurrOpen, setEditLangCurrOpen] = useState(false);

  const [theme, setTheme] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEYS.theme) || "light";
    }
    return "light";
  });
  const [language, setLanguage] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEYS.language) || "en";
    }
    return "en";
  });
  const [currency, setCurrency] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEYS.currency) || "USD";
    }
    return "USD";
  });
  const [socialLinks, setSocialLinks] = useState<SocialLinks>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(STORAGE_KEYS.socialLinks);
        return stored ? JSON.parse(stored) : {};
      } catch {
        return {};
      }
    }
    return {};
  });

  useEffect(() => {
    if (serverProfile) {
      setProfileData({
        firstName: serverProfile.first_name || "",
        lastName: serverProfile.last_name || "",
        email: profileData.email,
        phoneNumber: serverProfile.phone_number || "",
      });
      setAvatarUrl(serverProfile.avatar_url || null);
    }
  }, [serverProfile]);

  useEffect(() => {
    const fetchEmail = async () => {
      const {
        data: { user },
      } = await getCurrentUser();
      if (user) {
        setProfileData((p) => ({ ...p, email: user.email || "" }));
      }
    };
    fetchEmail();
  }, []);

  const handleSaveProfile = async () => {
    try {
      setIsSavingProfile(true);
      const {
        data: { user },
      } = await getCurrentUser();
      if (!user) {
        toast({ title: "Error", description: "User not authenticated", variant: "destructive" });
        return;
      }

      // supabase-js ไม่ throw — มันคืน { error } มาให้. การ `await` เฉย ๆ โดยไม่แตะ
      // `error` จึงทำให้ catch ข้างล่างไม่มีวันทำงาน และ toast "Success" ก็ขึ้นทุกครั้ง
      // ไม่ว่าจะเซฟติดหรือไม่
      const { error: profileError } = await supabase
        .from("profile_customers")
        .upsert(
          {
            user_id: user.id,
            first_name: profileData.firstName,
            last_name: profileData.lastName,
            phone_number: profileData.phoneNumber,
          } as Record<string, unknown>,
          { onConflict: "user_id" }
        );

      if (profileError) throw profileError;

      // และ UPDATE ที่ไม่โดนแถวไหนเลยก็ไม่ใช่ error เช่นกัน — `.select("id")` มีไว้
      // นับแถวที่โดนจริง ไม่ได้มีไว้เอาค่ากลับมาใช้
      const { data: updatedCustomer, error: customerError } = await supabase
        .from("customer")
        .update({
          full_name: `${profileData.firstName} ${profileData.lastName}`.trim(),
          phone_number: profileData.phoneNumber,
        })
        .eq("id", user.id)
        .select("id");

      if (customerError) throw customerError;
      if (!updatedCustomer || updatedCustomer.length === 0) {
        throw new Error(`ไม่พบแถวของผู้ใช้ ${user.id} ในตาราง customer`);
      }

      toast({ title: "Success", description: "Profile updated successfully" });
      invalidate();
      setEditNameOpen(false);
      setEditContactsOpen(false);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save profile",
        variant: "destructive",
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      toast({ title: "Invalid file type", description: "Only JPG, PNG and SVG are allowed.", variant: "destructive" });
      e.target.value = "";
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File exceeds 2MB limit", description: "Please upload an image smaller than 2MB.", variant: "destructive" });
      e.target.value = "";
      return;
    }
    try {
      setIsUploadingAvatar(true);
      const {
        data: { user },
      } = await getCurrentUser();
      if (!user) return;

      const ext = file.name.split(".").pop();
      const path = `${user.id}/avatar.${ext}`;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', path);
      formData.append('bucket', 'avatars');

      const { data, error } = await supabase.functions.invoke('secure-upload', {
        body: formData,
      });

      if (error) {
        throw new Error(error.message || "Edge function upload failed");
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path);

      await supabase
        .from("profile_customers")
        .upsert({ user_id: user.id, avatar_url: publicUrl } as Record<string, unknown>, {
          onConflict: "user_id",
        });

      setAvatarUrl(publicUrl + "?t=" + Date.now());
      toast({ title: "Avatar uploaded successfully" });
      invalidate();
    } catch (err: unknown) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsUploadingAvatar(false);
      e.target.value = "";
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      setIsUploadingAvatar(true);
      const {
        data: { user },
      } = await getCurrentUser();
      if (!user) return;

      const { data: files } = await supabase.storage.from("avatars").list(user.id);
      if (files?.length) {
        await supabase.storage
          .from("avatars")
          .remove(files.map((f) => `${user.id}/${f.name}`));
      }

      await supabase
        .from("profile_customers")
        .upsert({ user_id: user.id, avatar_url: null } as Record<string, unknown>, {
          onConflict: "user_id",
        });

      setAvatarUrl(null);
      toast({ title: "Avatar removed successfully" });
      invalidate();
    } catch (err: unknown) {
      toast({
        title: "Failed to remove avatar",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleThemeChange = (value: string) => {
    setTheme(value);
    localStorage.setItem(STORAGE_KEYS.theme, value);
    if (value === "dark") {
      document.documentElement.classList.add("dark");
    } else if (value === "light") {
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.toggle(
        "dark",
        window.matchMedia("(prefers-color-scheme: dark)").matches
      );
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.theme);
    if (stored === "dark") document.documentElement.classList.add("dark");
    else if (stored === "light") document.documentElement.classList.remove("dark");
  }, []);

  const handleSaveSocial = () => {
    localStorage.setItem(STORAGE_KEYS.socialLinks, JSON.stringify(socialLinks));
    if (editSocialOpen) setEditSocialOpen(false);
    toast({ title: "Saved", description: "Social media links updated" });
  };

  const handleSaveLangCurr = () => {
    localStorage.setItem(STORAGE_KEYS.language, language);
    localStorage.setItem(STORAGE_KEYS.currency, currency);
    if (editLangCurrOpen) setEditLangCurrOpen(false);
    toast({ title: "Saved", description: "Language & currency updated" });
  };

  const displayName =
    profileData.firstName || profileData.lastName
      ? `${profileData.firstName} ${profileData.lastName}`.trim()
      : "Unnamed User";

  const displayLangCurr = `${language === "en" ? "English" : language === "th" ? "Thai" : language}, ${currency}`;
  const socialDisplay = [
    socialLinks.linkedin ? `linkedin.com/${socialLinks.linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\/?/i, "")}` : null,
    socialLinks.dribbble ? `dribbble.com/${socialLinks.dribbble.replace(/^https?:\/\/(www\.)?dribbble\.com\/?/i, "")}` : null,
  ]
    .filter(Boolean)
    .join(", ") || "—";

  return (
    <div className="space-y-6">
      {/* Profile Picture — breaks out of card */}
      <div className="flex items-center justify-center gap-4 -mx-2 py-6">
        <div className="relative shrink-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="avatar"
              className="h-20 w-20 sm:h-24 sm:w-24 rounded-full object-cover ring-2 ring-border/60 shadow-md"
            />
          ) : (
            <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-full bg-muted flex items-center justify-center text-xl sm:text-2xl font-bold text-muted-foreground uppercase ring-2 ring-border/60 shadow-md">
              {(profileData.firstName?.charAt(0) || "") + (profileData.lastName?.charAt(0) || "") || profileData.email?.charAt(0) || "U"}
            </div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={handleRemoveAvatar}
            disabled={isUploadingAvatar}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <label className="cursor-pointer">
            <Button variant="outline" size="sm" className="h-9 px-4 text-xs font-medium" disabled={isUploadingAvatar} asChild>
              <span>
                <Upload className="h-4 w-4 mr-1.5" />
                Upload
              </span>
            </Button>
            <input
              type="file"
              accept="image/jpeg,image/png,image/svg+xml"
              className="hidden"
              onChange={handleUploadAvatar}
              disabled={isUploadingAvatar}
            />
          </label>
        </div>
      </div>

      <Card className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
      {/* Name */}
      <SettingRow
        label="Name"
        value={displayName}
        onEdit={() => setEditNameOpen(true)}
      />
      <Dialog open={editNameOpen} onOpenChange={setEditNameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Name</DialogTitle>
            <DialogDescription>Update your display name.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>First Name</Label>
              <Input
                value={profileData.firstName}
                onChange={(e) =>
                  setProfileData((p) => ({ ...p, firstName: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Last Name</Label>
              <Input
                value={profileData.lastName}
                onChange={(e) =>
                  setProfileData((p) => ({ ...p, lastName: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditNameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveProfile} disabled={isSavingProfile}>
              {isSavingProfile ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contacts */}
      <SettingRow
        label="Contacts"
        value={
          <>
            <div>Phone: {profileData.phoneNumber || "—"}</div>
            <div>Email: {profileData.email || "—"}</div>
          </>
        }
        onEdit={() => setEditContactsOpen(true)}
      />
      <Dialog open={editContactsOpen} onOpenChange={setEditContactsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Contacts</DialogTitle>
            <DialogDescription>Update your phone and email.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Phone</Label>
              <Input
                value={profileData.phoneNumber}
                onChange={(e) =>
                  setProfileData((p) => ({ ...p, phoneNumber: e.target.value }))
                }
                placeholder="+1234567890"
              />
            </div>
            <div className="grid gap-2">
              <Label>Email</Label>
              <Input
                value={profileData.email}
                disabled
                className="opacity-70"
              />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed here. Contact support if needed.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditContactsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveProfile} disabled={isSavingProfile}>
              {isSavingProfile ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Social Media */}
      <SettingRow
        label="Social media"
        value={socialDisplay}
        onEdit={() => setEditSocialOpen(true)}
      />
      <Dialog open={editSocialOpen} onOpenChange={setEditSocialOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Social Media</DialogTitle>
            <DialogDescription>Add your social media profile links.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>LinkedIn</Label>
              <Input
                placeholder="linkedin.com/company/yourname"
                value={socialLinks.linkedin || ""}
                onChange={(e) =>
                  setSocialLinks((s) => ({ ...s, linkedin: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Dribbble</Label>
              <Input
                placeholder="dribbble.com/yourname"
                value={socialLinks.dribbble || ""}
                onChange={(e) =>
                  setSocialLinks((s) => ({ ...s, dribbble: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSocialOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveSocial}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Language & Currency */}
      <SettingRow
        label="Language & currency"
        value={displayLangCurr}
        onEdit={() => setEditLangCurrOpen(true)}
      />
      <Dialog open={editLangCurrOpen} onOpenChange={setEditLangCurrOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Language & Currency</DialogTitle>
            <DialogDescription>Set your preferred language and currency.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="th">Thai</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="THB">THB</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLangCurrOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveLangCurr}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Theme */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Theme</p>
          <p className="text-sm font-medium text-foreground mt-0.5">
            {theme === "light" ? "Light" : theme === "dark" ? "Dark" : "System"}
          </p>
        </div>
        <Select value={theme} onValueChange={handleThemeChange}>
          <SelectTrigger className="w-[140px] h-9 border-border/60 bg-transparent text-sm font-medium rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-lg border-border/60">
            <SelectItem value="light" className="text-sm">Light</SelectItem>
            <SelectItem value="dark" className="text-sm">Dark</SelectItem>
            <SelectItem value="system" className="text-sm">System</SelectItem>
          </SelectContent>
        </Select>
      </div>

    </Card>
    </div>
  );
};

function SettingRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: React.ReactNode;
  onEdit: () => void;
}) {
  return (
    <div className="group flex items-center justify-between px-6 py-4 border-b border-border/40 hover:bg-muted/30 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className="text-sm font-medium text-foreground mt-0.5">{value}</div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
        onClick={onEdit}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
