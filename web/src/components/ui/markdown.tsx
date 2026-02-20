"use client"

import ReactMarkdown from "react-markdown"
import { cn } from "@/lib/utils"

interface MarkdownProps {
    content: string
    className?: string
}

export function Markdown({ content, className }: MarkdownProps) {
    return (
        <div className={cn("prose prose-sm prose-invert max-w-none", className)}>
            <ReactMarkdown
                components={{
                    h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-1.5">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>,
                    p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
                    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                    em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
                    code: ({ children }) => (
                        <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono text-foreground/80">{children}</code>
                    ),
                    blockquote: ({ children }) => (
                        <blockquote className="border-l-2 border-primary/30 pl-3 italic text-muted-foreground my-2">
                            {children}
                        </blockquote>
                    ),
                    a: ({ href, children }) => (
                        <a href={href} className="text-primary underline underline-offset-2 hover:text-primary/80" target="_blank" rel="noopener noreferrer">
                            {children}
                        </a>
                    ),
                    table: ({ children }) => (
                        <div className="overflow-x-auto my-2">
                            <table className="w-full text-xs border-collapse border border-border/40">{children}</table>
                        </div>
                    ),
                    thead: ({ children }) => <thead className="bg-muted/30">{children}</thead>,
                    th: ({ children }) => <th className="border border-border/40 px-2 py-1 text-left font-semibold">{children}</th>,
                    td: ({ children }) => <td className="border border-border/40 px-2 py-1">{children}</td>,
                    hr: () => <hr className="my-3 border-border/30" />,
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    )
}
