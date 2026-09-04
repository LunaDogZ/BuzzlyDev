import { useState, useEffect, type ComponentType } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Mail,
  Lock,
  User as UserIcon,
  Phone,
  Zap,
  ShieldCheck,
  ClipboardCheck
} from "lucide-react";
import authBackground from "@/assets/auth-background.png";
import { cn, getErrorMessage } from "@/lib/utils";

interface Gender {
  id: string;
  name_gender: string;
}

const SALARY_RANGES = [
  "Below 15,000 THB",
  "15,000 - 30,000 THB",
  "30,001 - 50,000 THB",
  "50,001 - 80,000 THB",
  "80,001 - 120,000 THB",
  "Above 120,000 THB",
];

const ACQUISITION_SOURCES = [
  { value: "google", label: "Google / Search" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "line", label: "LINE" },
  { value: "referral", label: "เพื่อน/คนรู้จักแนะนำ" },
  { value: "advertisement", label: "โฆษณา" },
  { value: "blog", label: "Blog / บทความ" },
  { value: "other", label: "อื่นๆ" },
];

const SignUp = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const genders = [
    { value: "female", label: "Female" },
    { value: "lgbtq+", label: "LGBTQ+" },
    { value: "male", label: "Male" },
    { value: "non-binary", label: "Non-binary" },
    { value: "prefer-not-to-say", label: "Prefer not to say" },
  ];

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    firstName: "",
    lastName: "",
    displayName: "",
    phone: "",
    genderId: "",
    salaryRange: "",
    acquisitionSource: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // ... (Keep existing useEffects for genders and session check) ...
  /* Removed fetchGenders useEffect as we now use hardcoded list */

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) navigate("/dashboard");
    });
  }, [navigate]);

  const totalSteps = 3;
  const progress = (currentStep / totalSteps) * 100;

  // ... (Keep existing validation, handleNext, handleBack, handleInputChange, and handleSubmit logic) ...
  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};
    if (step === 1) {
      if (!formData.email) newErrors.email = "Please enter email";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = "Invalid email format";
      if (!formData.password) newErrors.password = "Please enter password";
      else if (formData.password.length < 8) newErrors.password = "Password must be at least 8 characters";
      if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = "Passwords do not match";
    }
    if (step === 2) {
      if (!formData.firstName.trim()) newErrors.firstName = "Please enter first name";
      if (!formData.lastName.trim()) newErrors.lastName = "Please enter last name";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep === 2 && !formData.displayName) {
        setFormData(prev => ({ ...prev, displayName: `${prev.firstName} ${prev.lastName}`.trim() }));
      }
      setCurrentStep(prev => Math.min(prev + 1, totalSteps));
    }
  };

  const handleSubmit = async () => {
    if (!validateStep(currentStep)) return;
    setIsLoading(true);
    try {
      // Without this the confirmation link is built from the project's Site URL
      // alone — one fixed value — so a link mailed to someone who signed up on a
      // preview deploy, or on localhost, sends them to production instead.
      // `EmployeeSignUp.tsx` has always passed it; customer signup was the one
      // that did not. Landing on `/` is deliberate: `Auth.tsx` picks the session
      // up via `onAuthStateChange` and forwards to the right dashboard by role.
      //
      // Supabase only honours this when the URL is in the project's Redirect URLs
      // allowlist; otherwise it silently falls back to Site URL. Both halves are
      // needed, and the allowlist half lives in the dashboard.
      const redirectUrl = `${window.location.origin}/`;

      const { data, error } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            first_name: formData.firstName,
            last_name: formData.lastName,
            full_name: formData.displayName || `${formData.firstName} ${formData.lastName}`,
            phone: formData.phone,
            gender: formData.genderId,
            salary_range: formData.salaryRange,
            acquisition_source: formData.acquisitionSource || null,
          }
        },
      });
      if (error) throw error;
      if (data.user) {
        // Fallback: ensure customer and profile_customers rows exist
        // in case the DB trigger failed silently.
        const displayName = formData.displayName || `${formData.firstName} ${formData.lastName}`.trim();

        await supabase.from('customer').upsert({
          id: data.user.id,
          email: formData.email,
          full_name: displayName,
          plan_type: 'free',
          acquisition_source: formData.acquisitionSource || null,
        }, { onConflict: 'id' });

        await supabase.from('profile_customers').upsert({
          user_id: data.user.id,
          first_name: formData.firstName,
          last_name: formData.lastName,
          phone_number: formData.phone,
          gender: formData.genderId || null,
          salary_range: formData.salaryRange || null,
        }, { onConflict: 'user_id' });

        // Ensure loyalty_points wallet exists (in case DB trigger failed)
        await supabase.rpc('ensure_loyalty_wallet');

        await supabase.auth.signOut();
        // Sign out เพื่อบังคับให้ user ต้อง login ผ่านหน้า /auth
        toast.success("Sign up successful! Please sign in with your email and password");
        navigate("/auth");
      }
    } catch (error) {
      console.error("Signup error:", error);
      
      const errorMessage = getErrorMessage(error);

      // Handle "User already registered" specifically
      if (errorMessage.includes("already registered") || errorMessage.includes("User already exists")) {
        toast.info("This account already exists. Attempting to sign in...");
        // Try to sign in instead
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: formData.email,
          password: formData.password
        });

        if (signInError) {
          toast.error("บัญชีนี้มีอยู่แล้ว แต่รหัสผ่านไม่ถูกต้อง กรุณาเข้าสู่ระบบ");
        } else if (signInData.user) {
          toast.success("Signed in successfully!");
          navigate("/dashboard");
          return;
        }
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            <FormInput
              label="Email Bridge"
              id="email"
              icon={Mail}
              placeholder="you@company.com"
              value={formData.email}
              onChange={(v) => setFormData(p => ({ ...p, email: v }))}
              error={errors.email}
            />
            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 8 characters"
                  value={formData.password}
                  onChange={(e) => setFormData(p => ({ ...p, password: e.target.value }))}
                  className={cn("pl-10 h-11 bg-slate-50 border-slate-200 rounded-xl focus:bg-white transition-all", errors.password && "border-red-500")}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3.5 text-slate-400">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-[10px] text-red-500 font-bold mt-1 uppercase">{errors.password}</p>}
            </div>
            <FormInput
              label="Confirm Access Key"
              id="confirmPassword"
              icon={ShieldCheck}
              type={showConfirmPassword ? "text" : "password"}
              placeholder="Re-enter password"
              value={formData.confirmPassword}
              onChange={(v) => setFormData(p => ({ ...p, confirmPassword: v }))}
              error={errors.confirmPassword}
            />
          </div>
        );

      case 2:
        return (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="grid grid-cols-2 gap-4">
              <FormInput label="First Name" id="firstName" icon={UserIcon} placeholder="John" value={formData.firstName} onChange={(v) => setFormData(p => ({ ...p, firstName: v }))} error={errors.firstName} />
              <FormInput label="Last Name" id="lastName" placeholder="Doe" value={formData.lastName} onChange={(v) => setFormData(p => ({ ...p, lastName: v }))} error={errors.lastName} />
            </div>
            <FormInput label="Display Name (Optional)" id="displayName" placeholder="How should we call you?" value={formData.displayName} onChange={(v) => setFormData(p => ({ ...p, displayName: v }))} />
            <FormInput label="Phone" id="phone" icon={Phone} placeholder="0xx-xxx-xxxx" value={formData.phone} onChange={(v) => setFormData(p => ({ ...p, phone: v }))} />
          </div>
        );

      case 3:
        return (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">Gender Identity</Label>
              <Select value={formData.genderId} onValueChange={(v) => setFormData(p => ({ ...p, genderId: v }))}>
                <SelectTrigger className="h-11 rounded-xl bg-slate-50 border-slate-200">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-none shadow-xl">
                  {genders.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">Income Range</Label>
              <Select value={formData.salaryRange} onValueChange={(v) => setFormData(p => ({ ...p, salaryRange: v }))}>
                <SelectTrigger className="h-11 rounded-xl bg-slate-50 border-slate-200">
                  <SelectValue placeholder="Select range" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-none shadow-xl">
                  {SALARY_RANGES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">เจอเราผ่านช่องทางไหน?</Label>
              <Select value={formData.acquisitionSource} onValueChange={(v) => setFormData(p => ({ ...p, acquisitionSource: v }))}>
                <SelectTrigger className="h-11 rounded-xl bg-slate-50 border-slate-200">
                  <SelectValue placeholder="เลือกช่องทางที่เจอ Buzzly" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-none shadow-xl">
                  {ACQUISITION_SOURCES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-2xl bg-blue-50/50 border border-blue-100 p-5 mt-6">
              <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600 mb-3 flex items-center gap-2">
                <ClipboardCheck className="h-3 w-3" /> Profile Summary
              </h4>
              <div className="grid grid-cols-2 gap-y-3 text-xs">
                <div className="space-y-0.5"><p className="text-slate-400 font-bold uppercase text-[9px]">Identity</p><p className="font-bold text-slate-900 truncate">{formData.firstName} {formData.lastName}</p></div>
                <div className="space-y-0.5"><p className="text-slate-400 font-bold uppercase text-[9px]">Contact</p><p className="font-bold text-slate-900 truncate">{formData.email}</p></div>
                {formData.phone && <div className="space-y-0.5"><p className="text-slate-400 font-bold uppercase text-[9px]">Mobile</p><p className="font-bold text-slate-900">{formData.phone}</p></div>}
                {formData.acquisitionSource && <div className="space-y-0.5 col-span-2"><p className="text-slate-400 font-bold uppercase text-[9px]">เจอเราผ่าน</p><p className="font-bold text-slate-900">{ACQUISITION_SOURCES.find((s) => s.value === formData.acquisitionSource)?.label ?? formData.acquisitionSource}</p></div>}
              </div>
            </div>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 relative overflow-hidden font-sans">
      {/* Visual Background Elements */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-10"
        style={{ backgroundImage: `url(${authBackground})` }}
      />

      <div className="w-full max-w-md relative z-10 space-y-8">
        {/* Branding Header */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="h-12 w-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-600/20">
            <Zap className="h-7 w-7 text-white fill-current" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900 uppercase italic">Join Buzzly</h1>
            <p className="text-sm text-slate-500 font-medium">Step {currentStep} of 3: {currentStep === 1 ? 'Authentication' : currentStep === 2 ? 'Personalize' : 'Finalize'}</p>
          </div>
        </div>

        <Card className="border-slate-200 shadow-2xl shadow-slate-200/60 rounded-[2.5rem] overflow-hidden bg-white/95 backdrop-blur-md">
          <CardHeader className="pb-2 pt-8">
            {/* New Modern Step Indicator */}
            <div className="flex items-center justify-between px-2 mb-6">
              {[1, 2, 3].map((step) => (
                <div key={step} className="flex flex-col items-center gap-2">
                  <div className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500",
                    step < currentStep ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" :
                      step === currentStep ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20 scale-110" :
                        "bg-slate-100 text-slate-400"
                  )}>
                    {step < currentStep ? <Check className="h-4 w-4" /> : step}
                  </div>
                </div>
              ))}
            </div>
            <Progress value={progress} className="h-1 bg-slate-100" />
          </CardHeader>

          <CardContent className="p-8 pt-4">
            {renderStepContent()}

            <div className="flex gap-3 mt-8">
              {currentStep > 1 && (
                <Button variant="outline" onClick={() => setCurrentStep(p => p - 1)} className="flex-1 h-11 rounded-xl border-slate-200 font-bold" disabled={isLoading}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
              )}
              <Button onClick={currentStep === totalSteps ? handleSubmit : handleNext} className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-600/20" disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> :
                  currentStep === totalSteps ? "Launch Console" : "Next Phase"}
                {currentStep < totalSteps && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>
            </div>

            <div className="mt-8 text-center">
              <p className="text-xs text-slate-500 font-medium tracking-tight">
                Already part of the ecosystem?{" "}
                <Link to="/auth" className="text-blue-600 hover:underline font-bold">Sign In Now</Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// Helper Input Component
function FormInput({ label, id, icon: Icon, type = "text", placeholder, value, onChange, error }: { label: string; id: string; icon?: ComponentType<{ className?: string }>; type?: string; placeholder?: string; value: string; onChange: (value: string) => void; error?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">{label}</Label>
      <div className="relative">
        {Icon && <Icon className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />}
        <Input
          id={id}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "h-11 bg-slate-50 border-slate-200 rounded-xl focus:bg-white transition-all",
            Icon && "pl-10",
            error && "border-red-500"
          )}
        />
      </div>
      {error && <p className="text-[10px] text-red-500 font-bold mt-1 uppercase">{error}</p>}
    </div>
  );
}

export default SignUp;