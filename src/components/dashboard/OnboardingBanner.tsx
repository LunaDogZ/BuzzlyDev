import { useNavigate } from "react-router-dom";
import { type OnboardingState } from "@/hooks/useOnboardingGuard";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, ArrowRight, Rocket, Building2, Plug } from "lucide-react";
import { cn } from "@/lib/utils";

interface OnboardingBannerProps {
  state: OnboardingState;
}

export function OnboardingBanner({ state }: OnboardingBannerProps) {
  const navigate = useNavigate();

  const workspaceDone = state !== "no_workspace";
  const platformDone = state === "ready";

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-8">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Rocket className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-black tracking-tight mb-2">Welcome to Buzzly</h1>
          <p className="text-muted-foreground">
            Complete these two steps to start seeing your marketing data.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-4">
          <StepCard
            step={1}
            icon={Building2}
            title="Create Your Workspace"
            description="Set up your brand workspace — this is where your team, campaigns, and all analytics data live."
            done={workspaceDone}
            active={!workspaceDone}
            locked={false}
            cta="Go to Settings"
            onCta={() => navigate("/settings?tab=manage-workspace")}
          />

          <StepCard
            step={2}
            icon={Plug}
            title="Connect an Ad Platform"
            /* Named four platforms Buzzly cannot connect to. A merchant who
               picked one of them from this list arrived at a card that could
               only turn them away. Meta is the connector that exists; the rest
               come in as an uploaded report. */
            description="เชื่อมต่อ Facebook Ads เพื่อดึงข้อมูลอัตโนมัติ — แพลตฟอร์มอื่นนำเข้าเป็นไฟล์รายงานได้ที่หน้านำเข้าข้อมูล"
            done={platformDone}
            active={workspaceDone && !platformDone}
            locked={!workspaceDone}
            cta="Set Up API Keys"
            onCta={() => navigate("/api-keys")}
          />
        </div>
      </div>
    </div>
  );
}

interface StepCardProps {
  step: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  done: boolean;
  active: boolean;
  locked: boolean;
  cta: string;
  onCta: () => void;
}

function StepCard({ step, icon: Icon, title, description, done, active, locked, cta, onCta }: StepCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-6 transition-all",
        done && "bg-muted/30 border-transparent opacity-60",
        active && "bg-background border-primary/30 shadow-sm shadow-primary/10",
        locked && "bg-muted/20 border-transparent opacity-40"
      )}
    >
      <div className="flex items-start gap-4">
        {/* Step status icon */}
        <div className="shrink-0 mt-0.5">
          {done ? (
            <CheckCircle2 className="h-6 w-6 text-primary" />
          ) : (
            <Circle className={cn("h-6 w-6", active ? "text-primary" : "text-muted-foreground")} />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Step {step}
            </span>
            {done && (
              <span className="text-xs font-bold text-primary uppercase tracking-wide">Complete</span>
            )}
            {locked && (
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Locked</span>
            )}
          </div>
          <div className="flex items-center gap-2 mb-1">
            <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
            <h3 className="font-bold text-base">{title}</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{description}</p>

          {active && (
            <Button size="sm" onClick={onCta} className="rounded-full gap-1.5">
              {cta}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
