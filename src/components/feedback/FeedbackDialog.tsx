import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { toast } from "sonner";
import { MessageSquarePlus, Star, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface RatingOption {
    id: string;
    name: string;
    descriptions: string;
    color_code: string;
}

export function FeedbackDialog({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [ratings, setRatings] = useState<RatingOption[]>([]);
    const [selectedRatingId, setSelectedRatingId] = useState<string | null>(null);
    const [comment, setComment] = useState("");

    useEffect(() => {
        if (open) {
            fetchRatings();
        }
    }, [open]);

    const fetchRatings = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from("rating")
                .select("*")
                .order("name", { ascending: false }); // Usually 5 stars first

            if (error) throw error;
            setRatings(data || []);
        } catch (error) {
            console.error("Error fetching ratings:", error);
            toast.error("Failed to load rating options");
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (!selectedRatingId) {
            toast.error("Please select a rating");
            return;
        }

        try {
            setSubmitting(true);
            const { data: { user } } = await getCurrentUser();

            if (!user) {
                toast.error("You must be logged in to submit feedback");
                return;
            }

            const { error } = await supabase
                .from("feedback")
                .insert({
                    user_id: user.id,
                    rating_id: selectedRatingId,
                    comment: comment.trim(),
                });

            if (error) throw error;

            toast.success("Thank you for your feedback!");
            setOpen(false);
            // Reset form
            setSelectedRatingId(null);
            setComment("");
        } catch (error) {
            console.error("Error submitting feedback:", error);
            toast.error("Failed to submit feedback");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {children}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <MessageSquarePlus className="h-5 w-5" />
                        Give Feedback
                    </DialogTitle>
                    <DialogDescription>
                        We value your opinion! Please rate your experience and let us know how we can improve.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="grid gap-6 py-4">
                        <div className="space-y-3">
                            <Label>Rate your experience</Label>
                            <div className="flex flex-wrap gap-2 justify-center">
                                {ratings.map((rating) => {
                                    // Heuristic to determine star count based on name (e.g. "5 Stars" -> 5)
                                    const starCount = parseInt(rating.name) || 0;
                                    const isSelected = selectedRatingId === rating.id;

                                    return (
                                        <button
                                            key={rating.id}
                                            onClick={() => setSelectedRatingId(rating.id)}
                                            className={cn(
                                                "flex flex-col items-center gap-1 p-2 rounded-lg transition-all border-2",
                                                isSelected
                                                    ? "border-primary bg-primary/5"
                                                    : "border-transparent hover:bg-muted"
                                            )}
                                            title={rating.descriptions}
                                        >
                                            <div className="flex">
                                                {/* Simple visual representation */}
                                                <Star
                                                    className={cn(
                                                        "h-6 w-6",
                                                        isSelected ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
                                                    )}
                                                />
                                            </div>
                                            <span className={cn("text-xs font-medium", isSelected ? "text-primary" : "text-muted-foreground")}>
                                                {rating.name}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="comment">Comments</Label>
                            <Textarea
                                id="comment"
                                placeholder="Tell us what you like or what we can improve..."
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                                rows={4}
                            />
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={submitting || loading}>
                        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Submit Feedback
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
