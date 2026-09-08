# Prompt: Customer Onboarding Flow Implementation

> **⚠️ ก่อนเริ่มทำงานใดๆ ต้องอ่านไฟล์ `CLAUDE.md` ที่ root ของโปรเจกต์ก่อนเสมอ** เพื่อเข้าใจ stack, patterns, conventions, และ don'ts ของโปรเจกต์นี้

---

## เป้าหมาย

Implement customer onboarding flow ให้ครบวงจร โดยมี 5 phases ตามลำดับ:

---

## Phase 0 — Fix Sign Up Auto-Login

**ปัญหา:** `SignUp.tsx` (ฟังก์ชัน `handleSubmit`) หลัง `supabase.auth.signUp()` สำเร็จ จะ `navigate("/dashboard")` ทันที ซึ่ง Supabase สร้าง session อัตโนมัติ ทำให้ user ข้ามหน้า login

**สิ่งที่ต้องทำ:**
1. แก้ `src/pages/SignUp.tsx` — ฟังก์ชัน `handleSubmit()`:
   - หลัง upsert `customer` + `profile_customers` สำเร็จ
   - เรียก `await supabase.auth.signOut()` ก่อน
   - เปลี่ยน toast เป็น `"สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบด้วย email และรหัสผ่านของคุณ"`
   - เปลี่ยน navigate จาก `"/dashboard"` เป็น `"/auth"`
   - ส่วน fallback "User already registered" (บรรทัด ~159-170) ปล่อยไว้ตามเดิม

---

## Phase 1 — Onboarding Guard (Workspace Creation Flow)

**สิ่งที่ต้องทำ:**

1. แก้ `src/components/settings/WorkspaceSettings.tsx` — ฟังก์ชัน `handleCreateWorkspace()`:
   - เพิ่ม `import { useNavigate } from "react-router-dom"`
   - หลัง `createWorkspace()` สำเร็จ เรียก `navigate("/api-keys")`

2. แก้ `src/pages/APIKeys.tsx` — component `NoWorkspaceState`:
   - เปลี่ยน `navigate("/settings")` เป็น `navigate("/settings?tab=workspace")`

3. แก้ `src/pages/Settings.tsx`:
   - เพิ่ม `import { useSearchParams } from "react-router-dom"`
   - เพิ่ม `const [searchParams] = useSearchParams()`
   - เปลี่ยน `useState("workspace")` เป็น `useState(searchParams.get("tab") || "workspace")`

---

## Phase 2 — Platform Guard บน MainLayout

**สิ่งที่ต้องทำ:**

1. สร้างไฟล์ใหม่ `src/hooks/useOnboardingGuard.tsx`:
   - Hook ที่ combine `usePlatformConnections` (ดู `connectedPlatforms`) + `useWorkspace` (ดู `hasTeam`)
   - Return `{ state: OnboardingState }` โดย `OnboardingState` = `"loading" | "no_workspace" | "no_platform" | "ready"`
   - Logic:
     - ถ้า loading จาก platform หรือ workspace → `"loading"`
     - ถ้า `hasTeam === false` → `"no_workspace"`
     - ถ้ามี workspace แต่ `connectedPlatforms.length === 0` → `"no_platform"`
     - นอกนั้น → `"ready"`

2. แก้ `src/components/layout/MainLayout.tsx`:
   - เพิ่ม `useOnboardingGuard()` + `useLocation()` + `Navigate`
   - Exempt paths (ไม่ redirect): `/api-keys`, `/settings`
   - Plan-locked paths (ปล่อยผ่าน — มี UpgradeRequired dialog): `/customer-journey`, `/aarrr-funnel`, `/analytics`, `/reports`, `/team`
   - Logic: ถ้า state ไม่ใช่ `"ready"` และ path ไม่ exempt → `<Navigate to="/api-keys" replace />`
   - ถ้า `"loading"` → แสดง loading spinner

---

## Phase 3 — Data Isolation Fix

**สิ่งที่ต้องทำ:**

1. แก้ `src/hooks/useDashboardMetrics.tsx`:
   - เพิ่ม `import { useWorkspace } from "@/hooks/useWorkspace"`
   - ดึง `workspace.id` มาเป็น `workspaceId`
   - เพิ่ม `workspaceId` ใน `queryKey`
   - เพิ่ม `enabled: !!workspaceId`
   - เปลี่ยน select เป็น `ad_accounts!inner(platform_id, team_id)` แล้วเพิ่ม `.eq("ad_accounts.team_id", workspaceId)`

2. แก้ `src/hooks/useCustomerPersonas.tsx`:
   - เปลี่ยน `queryKey` เป็น `["customer-personas", teamId]`
   - เพิ่ม `enabled: !!teamId`
   - เพิ่ม `.eq("team_id", teamId!)` ใน query chain

---

## Phase 4 — DB / RLS Audit (ตรวจสอบ ไม่แก้ code)

ตรวจสอบ migration files ใน `supabase/migrations/` ว่า RLS policies ถูกต้อง:

| ตาราง | เช็ค |
|---|---|
| `workspaces` | Owner สร้างได้ 1 workspace (`owner_id = auth.uid()`) |
| `workspace_members` | scoped to user ที่เป็น owner หรือ active member |
| `workspace_api_keys` | SELECT/INSERT/UPDATE/DELETE scoped to `team_id` |
| `ad_insights` | SELECT scoped ผ่าน `ad_accounts.team_id` |
| `campaigns` | SELECT/INSERT scoped to `team_id` |
| `customer_personas` | SELECT/INSERT scoped to `team_id` |
| `customer` | trigger `on_auth_user_created` ทำงานอยู่ |

---

## ตาราง DB ที่เกี่ยวข้อง

`auth.users`, `customer`, `workspaces`, `workspace_members`, `workspace_api_keys`, `platforms`, `ad_accounts`, `ad_insights`, `campaigns`, `customer_personas`, `reports`, `subscriptions`

---

## กฎสำคัญ

- **อ่าน `CLAUDE.md` ก่อนเริ่มทำงานเสมอ** — มี stack, patterns, conventions ทั้งหมด
- ใช้ `npm run dev` (port 8080) สำหรับ dev server — **ห้ามใช้ `bun dev`**
- ห้ามแก้ `src/integrations/supabase/types.ts` (auto-generated)
- ห้ามแก้ migration files ที่มีอยู่ — สร้างไฟล์ใหม่เท่านั้น
- ห้าม bypass RLS โดยไม่มีเหตุผล
- ใช้ React Query + hooks pattern ตาม convention ที่มีอยู่
- Toast ใช้ `sonner` (`toast.success()`, `toast.error()`)
- Error ต้อง throw เสมอ ไม่ swallow

---

## Verification

หลัง implement เสร็จ ให้ test ด้วย browser:

1. **Sign Up → Login:** ลอง sign up ใหม่ → ต้อง redirect ไป `/auth` (ไม่ auto-login)
2. **Login → API Keys:** login แล้ว → ต้อง redirect จาก `/dashboard` ไป `/api-keys`
3. **API Keys → Settings:** กด "Setup Workspace" → ไป `/settings?tab=workspace`
4. **Create Workspace → API Keys:** สร้าง workspace → redirect กลับ `/api-keys`
5. **Connect Platform → Dashboard:** connect platform → ไป `/dashboard` ได้ เห็นข้อมูล workspace ตัวเอง
6. **Plan Gate:** user free คลิก Customer Journey → เห็น UpgradeRequired (ไม่ redirect ไป api-keys)
