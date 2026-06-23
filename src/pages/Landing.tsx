import { useNavigate, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Globe,
  Play,
  Code2,
  Zap,
  Crown,
  Users,
} from "lucide-react";
import { PLANS } from "@/constants/plans";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";

/* ─── Cloud SVG Component ─────────────────────────────────────────────── */
function CloudSVG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 140" className={className} fill="white" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="200" cy="100" rx="180" ry="40" />
      <ellipse cx="140" cy="80" rx="80" ry="50" />
      <ellipse cx="260" cy="70" rx="90" ry="55" />
      <ellipse cx="200" cy="60" rx="70" ry="45" />
      <ellipse cx="310" cy="90" rx="60" ry="35" />
      <ellipse cx="90" cy="90" rx="60" ry="35" />
    </svg>
  );
}

/* ─── Product Card Component ──────────────────────────────────────────── */
function ProductCard({
  image,
  title,
  description,
  className,
}: {
  image: string;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group bg-white rounded-2xl p-6 flex items-start gap-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.1)] transition-all duration-400 hover:-translate-y-1 border border-slate-100",
        className
      )}
    >
      <div className="flex-shrink-0 w-[140px] h-[100px] rounded-xl overflow-hidden shadow-sm border border-slate-100">
        <img src={image} alt={title} className="w-full h-full object-cover" />
      </div>
      <div className="flex flex-col gap-2 pt-1">
        <h3 className="text-xl font-bold text-slate-900 tracking-tight">{title}</h3>
        <p className="text-sm text-slate-500 leading-relaxed font-medium">{description}</p>
      </div>
    </div>
  );
}

/* ─── Scroll helper ───────────────────────────────────────────────────── */
function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

/* ─── Main Landing Component ──────────────────────────────────────────── */
export default function Landing() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        checkRoleAndRedirect(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user) {
          setUser(session.user);
          checkRoleAndRedirect(session.user.id);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const checkRoleAndRedirect = async (userId: string) => {
    const { data: employeeData } = await supabase
      .from("employees")
      .select(`
        *,
        role_employees (
          role_name
        )
      `)
      .eq("user_id", userId)
      .maybeSingle();

    if (employeeData && employeeData.status === 'active' && employeeData.approval_status === 'approved') {
      const roleEmployee = employeeData.role_employees;
      const roleName = roleEmployee?.role_name;

      if (roleName === "owner") {
        navigate("/owner/dashboard", { replace: true });
        return;
      }

      if (["admin", "support", "dev"].includes(roleName)) {
        navigate("/dev/monitor");
        return;
      }
    }

    const { data: rolesData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    if (rolesData && rolesData.length > 0) {
      const hasOwnerRole = rolesData.some((r) => r.role === "owner");
      const hasAdminRole = rolesData.some((r) => r.role === "admin");

      if (hasOwnerRole) {
        navigate("/owner/dashboard", { replace: true });
        return;
      }

      if (hasAdminRole) {
        navigate("/admin/dashboard", { replace: true });
        return;
      }
    }

    navigate("/dashboard", { replace: true });
  };

  return (
    <div className="min-h-screen bg-white selection:bg-blue-500/20 font-sans overflow-x-hidden">

      {/* ─── Navigation Bar ────────────────────────────────────────────── */}
      <nav
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-white",
          scrolled ? "shadow-[0_1px_8px_rgba(0,0,0,0.08)]" : ""
        )}
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-8 flex items-center justify-between h-16">
          {/* Logo */}
          <div
            className="flex items-center gap-2 cursor-pointer group"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            <div className="w-9 h-9 rounded-lg bg-[#1A3FBF] flex items-center justify-center shadow-md group-hover:scale-105 transition-transform">
              <span className="text-white font-black text-lg">B</span>
            </div>
            <span className="text-xl font-black text-[#1A3FBF] tracking-tight">BUZZLY</span>
          </div>

          {/* Nav Links */}
          <div className="hidden md:flex items-center gap-8">
            <button
              type="button"
              onClick={() => scrollToSection("features")}
              className="text-sm font-semibold text-slate-700 hover:text-[#1A3FBF] transition-colors"
            >
              Products
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("solutions")}
              className="text-sm font-semibold text-slate-700 hover:text-[#1A3FBF] transition-colors"
            >
              Solutions
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("about")}
              className="text-sm font-semibold text-slate-700 hover:text-[#1A3FBF] transition-colors"
            >
              About
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("pricing")}
              className="text-sm font-semibold text-slate-700 hover:text-[#1A3FBF] transition-colors"
            >
              Pricing
            </button>
          </div>

          {/* Right CTA */}
          <div className="flex items-center gap-4">
            {!user ? (
              <>
                <div className="hidden md:flex items-center gap-1 text-sm text-slate-600 font-medium">
                  <Globe className="h-4 w-4" />
                  <span>English</span>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => navigate("/auth")}
                  className="hidden sm:inline-flex text-sm font-semibold text-slate-700 hover:text-[#1A3FBF] hover:bg-transparent"
                >
                  Login
                </Button>
                <Button
                  onClick={() => navigate("/signup")}
                  className="rounded-full bg-[#1A3FBF] text-white font-bold text-sm px-6 py-2 hover:bg-[#1533A0] transition-colors shadow-md hover:shadow-lg"
                >
                  Sign up
                </Button>
              </>
            ) : (
              <Button
                onClick={() => navigate("/dashboard")}
                className="rounded-full bg-[#1A3FBF] text-white font-bold text-sm px-6 py-2 hover:bg-[#1533A0] transition-colors shadow-md"
              >
                Go to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </nav>

      {/* ─── Hero Section ──────────────────────────────────────────────── */}
      <section className="pt-28 pb-16 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 grid lg:grid-cols-2 gap-12 items-center min-h-[70vh]">

          {/* Left Column: Text */}
          <div className="flex flex-col items-start text-left relative z-10 animate-fade-in-up">
            {/* Icon */}
            <div className="w-14 h-14 rounded-2xl bg-[#1A3FBF] flex items-center justify-center mb-8 shadow-lg">
              <span className="text-white font-black text-2xl">B</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] xl:text-6xl font-black text-slate-900 tracking-tight leading-[1.1] mb-6">
              Effortless AI Marketing for campaigns, analytics, and more
            </h1>

            <p className="text-base lg:text-lg text-slate-500 font-medium leading-relaxed mb-8 max-w-lg">
              Your marketing deserves to shine. The universe deserves to see it. A captivating campaign? Easy. A stunning dashboard? Done. Grow anything you can imagine almost as quickly as you can think it up.
            </p>

            <div className="flex flex-wrap gap-4">
              {!user ? (
                <>
                  <Button
                    onClick={() => navigate("/signup")}
                    className="rounded-full bg-[#1A3FBF] text-white font-bold text-sm px-8 py-6 hover:bg-[#1533A0] transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                  >
                    Start for free
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-full border-slate-300 text-slate-700 font-bold text-sm px-8 py-6 hover:bg-slate-50 transition-all group"
                  >
                    Watch video
                    <Play className="ml-2 h-4 w-4 text-slate-500 group-hover:text-[#1A3FBF] transition-colors" />
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          {/* Right Column: Floating UI Mockups */}
          <div className="relative flex items-center justify-center min-h-[400px] lg:min-h-[520px]">
            {/* Background floating card — top right */}
            <div className="absolute top-0 right-0 w-[70%] max-w-[380px] rounded-2xl overflow-hidden shadow-[0_8px_40px_rgba(26,63,191,0.15)] border border-slate-100 animate-landing-float z-10 bg-white">
              <div className="bg-[#D6E4FF] p-3 flex items-center gap-2">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                </div>
                <span className="text-xs text-slate-500 font-medium ml-2">Buzzly Dashboard</span>
              </div>
              <img
                src="/hero-dashboard.png"
                alt="Buzzly Marketing Dashboard"
                className="w-full object-cover"
              />
            </div>

            {/* Main center card — dashboard big */}
            <div className="absolute top-[20%] left-0 w-[75%] max-w-[420px] rounded-2xl overflow-hidden shadow-[0_20px_60px_rgba(26,63,191,0.2)] border border-blue-100 animate-landing-float-delayed z-20 bg-white">
              <div className="bg-gradient-to-r from-[#4B7BF5] to-[#1A3FBF] p-4 text-white">
                <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Campaign Performance</p>
                <p className="text-2xl font-black mt-1">Growth Report</p>
              </div>
              <img
                src="/card-analytics.png"
                alt="Growth Report"
                className="w-full object-cover"
              />
            </div>

            {/* Small floating badge — bottom right */}
            <div className="absolute bottom-8 right-4 bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-3 flex items-center gap-2 z-30 animate-landing-float border border-slate-100">
              <div className="w-8 h-8 rounded-lg bg-[#E8F0FE] flex items-center justify-center">
                <span className="text-[#1A3FBF] text-xs font-bold">AI</span>
              </div>
              <span className="text-xs font-bold text-slate-700">Suggest images</span>
              <span className="text-slate-300">✦</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Products Section ──────────────────────────────────────────── */}
      <section
        id="features"
        className="relative py-20 overflow-hidden"
        style={{
          background: "linear-gradient(180deg, #E8F4FD 0%, #D0E8FF 40%, #C0DDFF 70%, #E8F4FD 100%)",
        }}
      >
        {/* Cloud decorations — top */}
        <div className="absolute top-[-40px] left-[-60px] w-[300px] opacity-90 animate-cloud-drift-slow">
          <CloudSVG />
        </div>
        <div className="absolute top-[-30px] right-[-40px] w-[250px] opacity-80 animate-cloud-drift-reverse">
          <CloudSVG />
        </div>
        <div className="absolute top-[-20px] left-[30%] w-[200px] opacity-60 animate-cloud-drift-slow" style={{ animationDelay: "3s" }}>
          <CloudSVG />
        </div>

        {/* Cloud decorations — bottom */}
        <div className="absolute bottom-[-50px] left-[10%] w-[350px] opacity-90 animate-cloud-drift-slow" style={{ animationDelay: "5s" }}>
          <CloudSVG />
        </div>
        <div className="absolute bottom-[-40px] right-[5%] w-[280px] opacity-80 animate-cloud-drift-reverse" style={{ animationDelay: "2s" }}>
          <CloudSVG />
        </div>
        <div className="absolute bottom-[-30px] left-[50%] w-[220px] opacity-70 animate-cloud-drift-slow" style={{ animationDelay: "7s" }}>
          <CloudSVG />
        </div>

        <div className="max-w-5xl mx-auto px-6 lg:px-8 relative z-10">
          {/* 2×2 Product Grid */}
          <div className="grid sm:grid-cols-2 gap-6 mb-6">
            <ProductCard
              image="/card-campaigns.png"
              title="Campaigns"
              description="Launch stunning marketing campaigns with consistent branding in minutes. Manage and track every campaign effortlessly."
            />
            <ProductCard
              image="/card-analytics.png"
              title="Analytics"
              description="Show-stopping reports, PDFs, visual dashboards and more, lightning-fast on any metric you need."
            />
            <ProductCard
              image="/card-social.png"
              title="Social Media"
              description="Gorgeous graphics and convincing copy. Share directly to social platforms and track engagement in real-time."
            />
            <ProductCard
              image="/card-websites.png"
              title="Websites"
              description="Business sites, landing pages, portfolios and more. Faster than you can blink. No coding required."
            />
          </div>

          {/* API Card — Wide */}
          <div className="bg-white rounded-2xl p-6 flex items-center justify-between shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-slate-100 hover:shadow-[0_8px_30px_rgba(0,0,0,0.1)] transition-all duration-400 hover:-translate-y-1">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                <Code2 className="h-5 w-5 text-slate-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 tracking-tight">API</h3>
                <p className="text-sm text-slate-500 font-medium">
                  Connect to Buzzly programmatically. Automate creation, integrate with your tools, and scale your marketing.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="rounded-full border-slate-300 text-slate-700 font-semibold text-sm px-5 hover:bg-slate-50 hover:border-[#1A3FBF] hover:text-[#1A3FBF] transition-all flex-shrink-0"
            >
              View Docs <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ─── Solutions Section ──────────────────────────────────────────── */}
      <section
        id="solutions"
        className="relative py-20 overflow-hidden bg-white"
      >
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-4">
            Solutions for every team
          </h2>
          <p className="text-slate-500 font-medium mb-12 max-w-2xl">
            Whether you&apos;re a solo marketer, growing startup, or enterprise team, Buzzly scales with you.
          </p>
          <div className="grid sm:grid-cols-3 gap-6">
            <div className="rounded-2xl p-6 border border-slate-100 bg-slate-50/50 hover:border-[#1A3FBF]/30 hover:bg-blue-50/30 transition-all">
              <div className="w-12 h-12 rounded-xl bg-[#1A3FBF]/10 flex items-center justify-center mb-4">
                <Zap className="h-6 w-6 text-[#1A3FBF]" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Solo & Freelancers</h3>
              <p className="text-sm text-slate-500">
                Launch campaigns, track analytics, and grow your brand without a team.
              </p>
            </div>
            <div className="rounded-2xl p-6 border border-slate-100 bg-slate-50/50 hover:border-[#1A3FBF]/30 hover:bg-blue-50/30 transition-all">
              <div className="w-12 h-12 rounded-xl bg-[#1A3FBF]/10 flex items-center justify-center mb-4">
                <Crown className="h-6 w-6 text-[#1A3FBF]" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Businesses</h3>
              <p className="text-sm text-slate-500">
                Advanced analytics, AI insights, and unlimited platforms for serious growth.
              </p>
            </div>
            <div className="rounded-2xl p-6 border border-slate-100 bg-slate-50/50 hover:border-[#1A3FBF]/30 hover:bg-blue-50/30 transition-all">
              <div className="w-12 h-12 rounded-xl bg-[#1A3FBF]/10 flex items-center justify-center mb-4">
                <Users className="h-6 w-6 text-[#1A3FBF]" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Teams</h3>
              <p className="text-sm text-slate-500">
                Collaborate with your team, share dashboards, and scale marketing together.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── About Section ──────────────────────────────────────────────── */}
      <section
        id="about"
        className="relative py-20 overflow-hidden"
        style={{
          background: "linear-gradient(180deg, #F8FAFC 0%, #F1F5F9 100%)",
        }}
      >
        <div className="max-w-3xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-4">
            About Buzzly
          </h2>
          <p className="text-slate-500 font-medium leading-relaxed">
            Buzzly is an AI-powered marketing platform that helps businesses create campaigns, analyze performance, and grow faster. We believe marketing should be effortless — so you can focus on what matters most: your customers and your vision.
          </p>
        </div>
      </section>

      {/* ─── Pricing Section ────────────────────────────────────────────── */}
      <section
        id="pricing"
        className="relative py-20 overflow-hidden bg-white"
      >
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-slate-500 font-medium mb-12 max-w-2xl">
            Start free. Upgrade when you&apos;re ready. No hidden fees.
          </p>
          <div className="grid sm:grid-cols-3 gap-6">
            {(["free", "pro", "team"] as const).map((planId) => {
              const plan = PLANS[planId];
              const Icon = plan.icon;
              return (
                <div
                  key={planId}
                  className={cn(
                    "rounded-2xl p-6 border transition-all",
                    plan.popular
                      ? "border-[#1A3FBF] shadow-[0_4px_20px_rgba(26,63,191,0.15)] bg-white"
                      : "border-slate-100 bg-slate-50/50 hover:border-slate-200"
                  )}
                >
                  {plan.popular && (
                    <span className="inline-block text-xs font-bold text-[#1A3FBF] uppercase tracking-wider mb-3">
                      Most popular
                    </span>
                  )}
                  <div className="flex items-center gap-3 mb-4">
                    <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", plan.bgGradient, plan.color)}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">{plan.name}</h3>
                  </div>
                  <p className="text-sm text-slate-500 mb-4">
                    {planId === "free" && "Get started for free. Perfect for individuals."}
                    {planId === "pro" && "For professionals and growing businesses."}
                    {planId === "team" && "For teams that collaborate and scale together."}
                  </p>
                  <div className="mb-6">
                    <span className="text-2xl font-black text-slate-900">
                      {plan.price.monthly === 0 ? "Free" : `฿${plan.price.monthly.toLocaleString()}`}
                    </span>
                    {plan.price.monthly > 0 && (
                      <span className="text-slate-500 font-medium">/month</span>
                    )}
                  </div>
                  <Button
                    onClick={() => navigate("/signup")}
                    variant={plan.popular ? "default" : "outline"}
                    className={cn(
                      "w-full rounded-full font-semibold",
                      plan.popular && "bg-[#1A3FBF] hover:bg-[#1533A0]"
                    )}
                  >
                    Get started
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Bottom CTA Section ────────────────────────────────────────── */}
      <section className="py-28 relative z-10 bg-white">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#1A3FBF] flex items-center justify-center mx-auto mb-8 shadow-lg">
            <span className="text-white font-black text-3xl">B</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight mb-6 leading-tight">
            The future of marketing <br className="hidden sm:block" />
            <span className="text-[#1A3FBF]">is here.</span>
          </h2>
          <p className="text-lg text-slate-500 font-medium mb-10 max-w-xl mx-auto leading-relaxed">
            Join thousands of businesses that have switched to Buzzly to drive marketing innovation and grow faster.
          </p>

          {!user ? (
            <Button
              onClick={() => navigate("/signup")}
              className="rounded-full bg-[#1A3FBF] text-white font-bold text-base px-10 py-6 hover:bg-[#1533A0] transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
            >
              Start for free <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          ) : null}
        </div>
      </section>

      {/* ─── Footer ────────────────────────────────────────────────────── */}
      <footer className="py-8 bg-white border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex flex-col items-center gap-2">
            <div className="flex justify-center w-full">
              <Link
                to="/employee/signup"
                className="text-sm text-slate-400 hover:text-white transition-colors"
              >
                Employee Signup
              </Link>
            </div>
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 w-full">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#1A3FBF] flex items-center justify-center">
                  <span className="text-white font-black text-sm">B</span>
                </div>
                <span className="text-lg font-black text-[#1A3FBF] tracking-tight">BUZZLY</span>
              </div>
              <p className="text-sm text-slate-400 font-medium">
                © 2026 Buzzly Intelligence. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
