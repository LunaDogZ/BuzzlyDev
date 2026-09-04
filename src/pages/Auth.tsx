import { useState, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Mail, Lock, Loader2, Sparkles, ArrowRight, Zap, CheckCircle2, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { loginSchema } from "@/lib/validations/auth";
import type { User, Session } from "@supabase/supabase-js";
import authBackground from "@/assets/auth-background.png";
import { auditAuth } from "@/lib/auditLogger";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const selectedPlan = (location.state as { selectedPlan?: string } | null)?.selectedPlan || null;

  // --- AUTH REDIRECTION LOGIC ---
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) checkRoleAndRedirect(session.user.id);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) checkRoleAndRedirect(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const checkRoleAndRedirect = async (userId: string) => {
    const { data: employeeData } = await supabase
      .from("employees")
      .select(`*, role_employees (role_name)`)
      .eq("user_id", userId)
      .maybeSingle();

    if (employeeData) {
      if (employeeData.status !== 'active') {
        await supabase.auth.signOut();
        toast({ title: "Account suspended", description: "Your account has been temporarily suspended. Please contact admin", variant: "destructive" });
        return;
      }

      if (employeeData.approval_status !== 'approved') {
        await supabase.auth.signOut();
        toast({ title: "Cannot sign in", description: "Your employee account is not yet approved or has been rejected", variant: "destructive" });
        return;
      }

      const roleName = employeeData.role_employees?.role_name;
      if (roleName === "owner") { navigate("/owner/dashboard"); return; }
      if (["admin", "support", "dev"].includes(roleName)) { navigate("/dev/monitor"); return; }
    }

    // All customers go to dashboard (free plan by default)
    navigate("/dashboard");
  };

  // --- SIGN IN HANDLER ---
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = loginSchema.safeParse({ email, password });

    if (!result.success) {
      toast({ title: "Validation Error", description: result.error.errors[0].message, variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // Log failed login attempt 
        await auditAuth.loginFailed(email, error.message);
        throw error;
      }
      if (data.user) {
        // Check employees table first
        const { data: employeeData } = await supabase
          .from("employees")
          .select(`
            *,
            role_employees (
              role_name
            )
          `)
          .eq("user_id", data.user.id)
          .maybeSingle();

        let isAdmin = false;
        let userRole = "";

        if (employeeData) {
          if (employeeData.status !== 'active') {
            await auditAuth.loginFailed(email, "Employee account suspended");
            await supabase.auth.signOut();
            toast({ title: "Account suspended", description: "Your account has been temporarily suspended. Please contact admin", variant: "destructive" });
            return;
          }

          if (employeeData.approval_status !== 'approved') {
            await auditAuth.loginFailed(email, `Employee account ${employeeData.approval_status}`);
            await supabase.auth.signOut();
            toast({ title: "Cannot sign in", description: "Your employee account is not yet approved or has been rejected", variant: "destructive" });
            return;
          }

          // At this point we are sure it's an approved, active employee
          const roleEmployee = employeeData.role_employees;
          const roleName = roleEmployee?.role_name || "";

          if (["owner", "admin", "support", "dev"].includes(roleName)) {
            isAdmin = true;
            userRole = roleName;

            // Log admin/employee login
            await auditAuth.login(data.user.id, roleName, email);

            toast({
              title: "Welcome back!",
              description: `You have successfully signed in as ${userRole}.`,
            });
          }
        }

        if (isAdmin) {
          if (userRole === "owner") {
            navigate("/owner/dashboard");
          } else if (userRole === "support") {
            navigate("/support/workspaces");
          } else {
            navigate("/dev/monitor");
          }
        } else {
          // Regular customer login
          await auditAuth.login(data.user.id, "Customer", email);
          navigate("/dashboard");
        }
      }
    } catch (error) {
      toast({ title: "Sign in failed", description: getErrorMessage(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-slate-50 font-sans">
      {/* Left side - Brand Section */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-cover bg-center relative"
        style={{ backgroundImage: `url(${authBackground})` }}
      >
        <div className="absolute inset-0 bg-blue-600/90 mix-blend-multiply" />

        <div className="relative z-10">
          <Link
            to="/landing"
            className="flex items-center gap-2 mb-8 w-fit group"
          >
            <div className="h-10 w-10 bg-white rounded-xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
              <Zap className="h-6 w-6 text-blue-600 fill-current" />
            </div>
            <span className="text-2xl font-bold text-white tracking-tight">Buzzly</span>
          </Link>

          <div className="max-w-md space-y-4">
            <Badge className="bg-white/20 text-white border-none backdrop-blur-md">
              Marketing Intelligence 2026
            </Badge>
            <h1 className="text-5xl font-extrabold text-white leading-tight">
              Scale your business <br />
              <span className="text-blue-200 underline decoration-blue-400/50">with data.</span>
            </h1>
            <p className="text-blue-50/80 text-lg">
              The all-in-one analytics platform to track, optimize, and grow your cross-channel campaigns.
            </p>
          </div>
        </div>

        <div className="relative z-10 bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20">
          <div className="flex items-center gap-4 mb-4">
            <div className="flex -space-x-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 w-8 rounded-full border-2 border-blue-600 bg-blue-100" />
              ))}
            </div>
            <p className="text-sm font-medium text-white">Join 500+ marketing teams</p>
          </div>
          <div className="flex items-center gap-2 text-blue-100 text-xs font-medium">
            <CheckCircle2 className="h-4 w-4 text-blue-300" /> Verified analytics data across 10+ platforms
          </div>
        </div>
      </div>

      {/* Right side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-md space-y-8">
          <Link
            to="/landing"
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Landing
          </Link>
          <div className="text-center lg:text-left space-y-2">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">Welcome Back</h2>
            <p className="text-slate-500">Sign in to manage your marketing ecosystem.</p>
          </div>

          <Card className="border-slate-200 shadow-xl shadow-slate-200/50 rounded-3xl overflow-hidden">
            <CardContent className="p-8">
              <Tabs defaultValue="signin" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-8 bg-slate-100 p-1 rounded-xl">
                  <TabsTrigger value="signin" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold">Sign In</TabsTrigger>
                  <TabsTrigger value="signup" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold">Sign Up</TabsTrigger>
                </TabsList>

                <TabsContent value="signin" className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-xs font-bold text-slate-700 uppercase tracking-wider">Email Address</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                        <Input
                          id="email"
                          type="email"
                          placeholder="name@company.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pl-10 h-11 bg-slate-50 border-slate-200 focus:bg-white rounded-xl transition-all"
                          required
                          disabled={loading}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      {/*
                        A "Forgot Password?" button sat here with no onClick — it
                        did nothing when pressed. There is no reset flow behind it
                        either: `resetPasswordForEmail` appears nowhere in this
                        repo. A dead control on the login page reads as a broken
                        product to anyone who tries it, so it is gone until the
                        flow exists (a reset page, plus its URL in the project's
                        Redirect URLs allowlist). `justify-between` stays for the
                        row it goes back into.
                      */}
                      <div className="flex justify-between">
                        <Label htmlFor="password" className="text-xs font-bold text-slate-700 uppercase tracking-wider">Password</Label>
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                        <Input
                          id="password"
                          type="password"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pl-10 h-11 bg-slate-50 border-slate-200 focus:bg-white rounded-xl transition-all"
                          required
                          disabled={loading}
                        />
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 py-1">
                      <input type="checkbox" id="remember" className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600" />
                      <label htmlFor="remember" className="text-sm text-slate-600 font-medium">Keep me signed in</label>
                    </div>

                    <Button type="submit" className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-600/20" disabled={loading}>
                      {loading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <span className="flex items-center gap-2">Sign In to Buzzly <ArrowRight className="h-4 w-4" /></span>
                      )}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="signup" className="py-6 text-center space-y-4 animate-in fade-in slide-in-from-bottom-2">
                  <div className="h-14 w-14 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-2">
                    <Sparkles className="h-7 w-7" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">New to Buzzly?</h3>
                  <p className="text-sm text-slate-500 px-4">Create your account today and get a 14-day free trial of our Pro features.</p>
                  <Button
                    variant="outline"
                    onClick={() => navigate("/signup", { state: { selectedPlan } })}
                    className="w-full h-11 rounded-xl border-slate-200 hover:bg-slate-50 font-bold"
                  >
                    Start Your Free Trial
                  </Button>
                </TabsContent>
              </Tabs>

              <div className="mt-8 pt-6 border-t border-slate-100 text-center">
                <p className="text-[11px] text-slate-400 uppercase tracking-widest leading-loose">
                  Secured by Supabase Auth <br />
                  <a href="#" className="hover:text-slate-600 transition-colors">Terms</a> &bull; <a href="#" className="hover:text-slate-600 transition-colors">Privacy</a>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}