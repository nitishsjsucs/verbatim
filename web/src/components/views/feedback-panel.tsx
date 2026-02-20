"use client"

import * as React from "react"
import { MessageSquare, Star, Check, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { submitFeedback } from "@/lib/api"

interface FeedbackPanelProps {
    recordId: string
}

export function FeedbackPanel({ recordId }: FeedbackPanelProps) {
    const [expanded, setExpanded] = React.useState(false)
    const [text, setText] = React.useState("")
    const [rating, setRating] = React.useState<number | null>(null)
    const [submitting, setSubmitting] = React.useState(false)
    const [submitted, setSubmitted] = React.useState(false)

    const handleSubmit = async () => {
        if (!text.trim() && rating === null) return
        setSubmitting(true)
        try {
            await submitFeedback(recordId, { text: text.trim(), rating })
            setSubmitted(true)
        } catch (err) {
            console.error("Failed to submit feedback:", err)
        } finally {
            setSubmitting(false)
        }
    }

    if (submitted) {
        return (
            <div className="flex items-center gap-2 text-xs text-green-400 py-2">
                <Check className="h-3.5 w-3.5" />
                <span>Feedback submitted</span>
            </div>
        )
    }

    if (!expanded) {
        return (
            <button
                onClick={() => setExpanded(true)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors py-1"
            >
                <MessageSquare className="h-3 w-3" />
                <span>Provide feedback</span>
            </button>
        )
    }

    return (
        <div className="mt-2 space-y-2.5 border border-border/40 rounded-lg p-3 bg-background/50">
            <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                    <button
                        key={n}
                        onClick={() => setRating(rating === n ? null : n)}
                        className="p-0.5 transition-colors"
                    >
                        <Star
                            className={cn(
                                "h-4 w-4 transition-colors",
                                rating !== null && n <= rating
                                    ? "fill-amber-400 text-amber-400"
                                    : "text-muted-foreground/30 hover:text-amber-400/50"
                            )}
                        />
                    </button>
                ))}
            </div>
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Optional comments..."
                className="w-full text-xs bg-muted/30 border border-border/40 rounded-md p-2 resize-none h-16 focus:outline-none focus:border-primary/30 text-foreground placeholder:text-muted-foreground/50"
            />
            <div className="flex gap-2">
                <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setExpanded(false)}
                >
                    Cancel
                </Button>
                <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleSubmit}
                    disabled={submitting || (!text.trim() && rating === null)}
                >
                    {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Submit
                </Button>
            </div>
        </div>
    )
}
