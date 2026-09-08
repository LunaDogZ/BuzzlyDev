# Prompt: Onboarding Flow UX — Step-by-Step Guided Setup

> **⚠️ Before starting ANY work, read the `CLAUDE.md` file at the project root** to understand the stack, patterns, conventions, and don'ts.

---

## Goal

The `/api-keys` page currently acts as the onboarding redirect target (via `MainLayout.tsx` + `useOnboardingGuard`). When a user hasn't completed setup, they land on `/api-keys` — but the page immediately tries to render the integrations list, which is confusing for new users.

**Transform `/api-keys` into a proper onboarding hub** that shows a clear, step-by-step setup wizard. Each step should:
- Display an **English description** explaining **what this step is and why it's required**
- Show a **prominent button** to navigate to the relevant page
- Visually indicate **completion status** (done / current / locked)

---

## Current Architecture (do NOT change)

- `src/hooks/useOnboardingGuard.tsx` — returns `OnboardingState`: `"loading"` | `"no_workspace"` | `"no_platform"` | `"ready"`
- `src/components/layout/MainLayout.tsx` — redirects non-exempt routes to `/api-keys` when state ≠ `"ready"`
- `src/pages/APIKeys.tsx` — currently shows `NoWorkspaceState` (if no workspace) or the integrations list

**Do NOT modify** `useOnboardingGuard.tsx` or `MainLayout.tsx`. All changes should be in `APIKeys.tsx` only.

---

## What to Implement

### Redesign `APIKeys.tsx` to show a setup wizard when onboarding is incomplete

When `useOnboardingGuard()` returns anything other than `"ready"`, instead of showing the raw integrations list, display a **visually appealing onboarding stepper** with the following steps:

#### Step 1: Create Workspace
- **Title:** "Create Your Workspace"
- **Description:** "Set up your workspace to organize your team, campaigns, and integrations. This is the foundation for everything in Buzzly."
- **Button:** "Go to Workspace Settings" → navigates to `/settings?tab=workspace`
- **Status logic:** Complete when `hasTeam === true`

#### Step 2: Connect a Platform
- **Title:** "Connect Your First Platform"
- **Description:** "Link your marketing platform (e.g., Facebook Ads, Google Ads) to start syncing campaign data and insights."
- **Button:** "Set Up Integration" → scrolls down to the existing integrations list on the same page, OR if workspace is not created yet, the button should be **disabled** with helper text: "Complete Step 1 first"
- **Status logic:** Complete when `connectedPlatforms.length > 0`

#### Step 3: Go to Dashboard
- **Title:** "You're All Set!"
- **Description:** "Your workspace is ready and your platform is connected. Head to the dashboard to start exploring your marketing data."
- **Button:** "Go to Dashboard" → navigates to `/dashboard`
- **Status logic:** This step appears only when both steps above are complete (i.e., `state === "ready"`)

### Visual Design Requirements

1. **Stepper layout**: Vertical steps with numbered circles (1, 2, 3), connected by a vertical line
2. **Step states**:
   - ✅ **Completed**: Green circle with checkmark, muted description, "Completed" badge
   - 🔵 **Current**: Primary-colored circle, bold description, prominent CTA button
   - 🔒 **Locked**: Gray circle, dimmed text, disabled button with "Complete previous step first" text
3. **Overall container**: Centered card with a header like "Welcome to Buzzly — Let's Get You Set Up" and a subtitle explaining the 2-step process
4. Use existing shadcn/ui components (`Card`, `Button`, `Badge`) and Lucide icons (`Building2`, `Link2`, `Rocket`, `CheckCircle2`, `Lock`)
5. Maintain the existing premium design language (uppercase tracking, rounded corners, etc.)

### When `state === "ready"`: Show the current integrations page as-is

When onboarding is complete, render the existing integrations list exactly as it is now — no changes needed.

### Flow Summary

```
User logs in
  → MainLayout: state ≠ "ready" → redirect to /api-keys
  → APIKeys page detects state:
    - "no_workspace" → Show stepper: Step 1 active, Step 2 locked
    - "no_platform"  → Show stepper: Step 1 completed, Step 2 active
    - "ready"        → Show normal integrations list (existing UI)
```

---

## Important Rules

- **Read `CLAUDE.md` before starting** — it has stack, patterns, conventions
- Use `npm run dev` (port 8080) — **do NOT use `bun dev`**
- Do NOT modify `types.ts` (auto-generated)
- Do NOT modify existing migration files
- Use React Query + hooks pattern per existing conventions
- Toasts use `sonner` (`toast.success()`, `toast.error()`)
- Always throw errors, never swallow them

---

## Verification

After implementation, test in the browser:

1. **New user (no workspace):** Login → lands on `/api-keys` → sees stepper with Step 1 active, Step 2 locked → "Go to Workspace Settings" button works
2. **User with workspace but no platform:** `/api-keys` → Step 1 completed (green check), Step 2 active with "Set Up Integration" button → button navigates/scrolls to integrations list
3. **Fully onboarded user:** `/api-keys` → shows the normal integrations management page (no stepper)
4. **Navigation guard still works:** Trying to visit `/dashboard` without completing onboarding → redirected to `/api-keys` with stepper
5. **Step 2 button disabled:** When no workspace exists, Step 2's button should be disabled with "Complete Step 1 first" text
