"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, FolderOpen, Users, LayoutDashboard, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
    { href: "/intelligence", label: "Workspace", icon: FolderOpen, match: (p: string) => p === "/intelligence" || p.startsWith("/intelligence/workspace") },
    { href: "/intelligence/teams", label: "Teams", icon: Users, match: (p: string) => p.startsWith("/intelligence/teams") },
    { href: "/intelligence/categories", label: "Categories", icon: Tag, match: (p: string) => p.startsWith("/intelligence/categories") },
    { href: "/intelligence/dashboard", label: "Dashboard", icon: LayoutDashboard, match: (p: string) => p.startsWith("/intelligence/dashboard") },
];

export default function IntelligenceLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname() || "/intelligence";
    return (
        <div className="flex flex-col h-screen w-full overflow-hidden bg-background">
            <header className="h-12 border-b border-border flex items-center justify-between px-6 flex-shrink-0 bg-background">
                <Link href="/intelligence" className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Brain className="h-4 w-4 text-primary" />
                    Actionable Intelligence
                </Link>
                <nav className="flex items-center gap-1">
                    {NAV.map((item) => {
                        const Icon = item.icon;
                        const active = item.match(pathname);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={cn(
                                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                    active
                                        ? "bg-primary/10 text-primary"
                                        : "text-muted-foreground hover:text-foreground hover:bg-accent",
                                )}
                            >
                                <Icon className="h-3.5 w-3.5" />
                                {item.label}
                            </Link>
                        );
                    })}
                    <Link
                        href="/"
                        className="ml-2 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent"
                    >
                        ← Back to app
                    </Link>
                </nav>
            </header>
            <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
    );
}
