import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ShieldCheck, Mail, Lock, User, ArrowLeft, ArrowRight, Loader2, Briefcase, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { auditSecurity } from "@/lib/auditLogger";

export default function EmployeeSignUp() {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const { toast } = useToast();

    const [formData, setFormData] = useState({
        // Step 1 - Account
        email: "",
        password: "",
        confirmPassword: "",
        // Step 2 - Profile
        firstName: "",
        lastName: "",
        aptitude: "",
        birthday: "",
    });

    const handleNext = async () => {
        if (step === 1) {
            if (!formData.email || !formData.password || !formData.confirmPassword) {
                toast({
                    title: "Please fill in all required fields",
                    description: "Email and Password are required",
                    variant: "destructive",
                });
                return;
            }

            if (formData.password.length < 8) {
                toast({
                    title: "Invalid password",
                    description: "Password must be at least 8 characters",
                    variant: "destructive",
                });
                return;
            }

            if (formData.password !== formData.confirmPassword) {
                toast({
                    title: "Passwords do not match",
                    description: "Please ensure passwords match",
                    variant: "destructive",
                });
                return;
            }

            setLoading(true);
            const { data: existingCustomer } = await supabase
                .from("customer")
                .select("id")
                .ilike("email", formData.email.trim())
                .maybeSingle();

            if (existingCustomer) {
                setLoading(false);
                toast({
                    title: "This email cannot be used",
                    description: "This email is already registered as a customer. Please use a different email for employee signup",
                    variant: "destructive",
                });
                return;
            }
            setLoading(false);
            setStep(2);
        }
    };

    const handleBack = () => {
        if (step > 1) setStep(step - 1);
    };

    const handleSignUp = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.firstName || !formData.lastName) {
            toast({
                title: "Please fill in all required fields",
                description: "First name and last name are required",
                variant: "destructive",
            });
            return;
        }

        setLoading(true);

        try {
            const redirectUrl = `${window.location.origin}/employee/login`;

            const { data: authData, error: authError } = await supabase.auth.signUp({
                email: formData.email,
                password: formData.password,
                options: {
                    emailRedirectTo: redirectUrl,
                    data: {
                        full_name: `${formData.firstName} ${formData.lastName}`,
                        first_name: formData.firstName,
                        last_name: formData.lastName,
                        is_employee_signup: true,
                        aptitude: formData.aptitude,
                        birthday: formData.birthday,
                    },
                },
            });

            if (authError) {
                if (authError.message.includes("already registered") || authError.message.includes("User already registered")) {
                    toast({
                        title: "This email is already registered",
                        description: "Your account already exists. Please go to the login page",
                        variant: "default",
                    });

                    setTimeout(() => {
                        navigate("/employee/login", { replace: true });
                    }, 2000);
                    return;
                }

                throw authError;
            }

            if (authData.user) {
                try {
                    await auditSecurity.employeeRegistered(
                        authData.user.id,
                        formData.email,
                        `${formData.firstName} ${formData.lastName}`.trim() || formData.email
                    );

                    // Check if the user was pre-added and thus already approved
                    const { data: employeeData } = await supabase
                        .from("employees")
                        .select("approval_status")
                        .eq("user_id", authData.user.id)
                        .maybeSingle();

                    if (employeeData?.approval_status === "approved") {
                        toast({
                            title: "Registration complete and account linked!",
                            description: "Welcome! Your employee account has been verified. You can sign in now.",
                        });
                    } else {
                        toast({
                            title: "Registration successful!",
                            description: "Your account has been set up. Please wait for admin approval.",
                        });
                    }

                    await supabase.auth.signOut();

                    setTimeout(() => {
                        navigate("/employee/login", { replace: true });
                    }, 2000);
                } catch (employeeError) {
                    throw new Error(getErrorMessage(employeeError));
                }
            }
        } catch (error) {
            toast({
                title: "Registration failed",
                description: getErrorMessage(error),
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    const progress = (step / 2) * 100;

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-secondary/20 to-background p-4 font-sans">
            <Card className="w-full max-w-md border-0 shadow-lg">
                <CardHeader className="text-center space-y-2">
                    <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
                        <ShieldCheck className="h-6 w-6 text-primary" />
                    </div>
                    <CardTitle className="text-2xl">Sign up as Employee</CardTitle>
                    <CardDescription>
                        Step {step} of 2 - {step === 1 ? "Account info" : "Personal info"}
                    </CardDescription>
                    <Progress value={progress} className="mt-4" />
                </CardHeader>
                <CardContent>
                    <form onSubmit={step === 2 ? handleSignUp : (e) => e.preventDefault()}>
                        {/* Step 1: Account Info */}
                        {step === 1 && (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="email">Email</Label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="email"
                                            type="email"
                                            placeholder="employee@buzzly.co"
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            className="pl-9"
                                            required
                                            disabled={loading}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password">Password</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="password"
                                            type="password"
                                            placeholder="••••••••"
                                            value={formData.password}
                                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                            className="pl-9"
                                            required
                                            disabled={loading}
                                            minLength={8}
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">At least 8 characters</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="confirmPassword"
                                            type="password"
                                            placeholder="••••••••"
                                            value={formData.confirmPassword}
                                            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                            className="pl-9"
                                            required
                                            disabled={loading}
                                        />
                                    </div>
                                </div>
                                <Button type="button" onClick={handleNext} className="w-full">
                                    Next
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                            </div>
                        )}

                        {/* Step 2: Profile Info */}
                        {step === 2 && (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                        <Label htmlFor="firstName">First Name</Label>
                                        <div className="relative">
                                            <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                id="firstName"
                                                type="text"
                                                placeholder="John"
                                                value={formData.firstName}
                                                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                                className="pl-9"
                                                required
                                                disabled={loading}
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="lastName">Last Name</Label>
                                        <Input
                                            id="lastName"
                                            type="text"
                                            placeholder="Doe"
                                            value={formData.lastName}
                                            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                                            required
                                            disabled={loading}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="aptitude">Position / Skill</Label>
                                    <div className="relative">
                                        <Briefcase className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="aptitude"
                                            type="text"
                                            placeholder="Developer, Support, etc."
                                            value={formData.aptitude}
                                            onChange={(e) => setFormData({ ...formData, aptitude: e.target.value })}
                                            className="pl-9"
                                            disabled={loading}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="birthday">Birthday</Label>
                                    <div className="relative">
                                        <Calendar className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="birthday"
                                            type="date"
                                            value={formData.birthday}
                                            onChange={(e) => setFormData({ ...formData, birthday: e.target.value })}
                                            className="pl-9"
                                            disabled={loading}
                                        />
                                    </div>
                                </div>

                                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm">
                                    <p className="text-amber-800 dark:text-amber-200">
                                        <strong>Note:</strong> Employee accounts must be approved before access (if you were invited by Admin, your account will be linked and approved automatically after signup)
                                    </p>
                                </div>

                                <div className="flex gap-3">
                                    <Button type="button" variant="outline" onClick={handleBack} className="w-full">
                                        <ArrowLeft className="mr-2 h-4 w-4" />
                                        Back
                                    </Button>
                                    <Button type="submit" className="w-full" disabled={loading}>
                                        {loading ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Signing up...
                                            </>
                                        ) : (
                                            "Sign up"
                                        )}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </form>

                    <div className="mt-6 space-y-3 text-center text-sm">
                        <p className="text-muted-foreground">
                            Already have an account?{" "}
                            <Link to="/employee/login" className="text-primary hover:underline font-medium">
                                Sign in
                            </Link>
                        </p>
                        <p className="text-muted-foreground">
                            Want to sign up as customer?{" "}
                            <Link to="/signup" className="text-primary hover:underline font-medium">
                                Sign up as Customer
                            </Link>
                        </p>
                        <Link
                            to="/landing"
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ArrowLeft className="h-3 w-3" />
                            Back to home
                        </Link>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
