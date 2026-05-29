"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Brain, FolderOpen, Users, UserCog, Inbox, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { isIntelAuthenticated, isIntelAdmin, getIntelUser, intelLogout } from "@/lib/intel-auth";

const NAV_ITEMS = [
    { href: "/intelligence", label: "Workspace", icon: FolderOpen, match: (p: string) => p === "/intelligence" || p.startsWith("/intelligence/workspace"), adminOnly: false },
    { href: "/intelligence/teams", label: "Teams", icon: Users, match: (p: string) => p.startsWith("/intelligence/teams"), adminOnly: false },
    { href: "/intelligence/clients", label: "Clients", icon: UserCog, match: (p: string) => p.startsWith("/intelligence/clients"), adminOnly: true },
    { href: "/intelligence/requests", label: "Requests", icon: Inbox, match: (p: string) => p.startsWith("/intelligence/requests"), adminOnly: true },
];

export default function IntelligenceLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname() || "/intelligence";
    const router = useRouter();

    // Login page renders without nav
    const isLoginRoute = pathname.startsWith("/intelligence/login");
    if (isLoginRoute) {
        return <>{children}</>;
    }

    const authenticated = isIntelAuthenticated();
    const admin = isIntelAdmin();
    const user = getIntelUser();

    const handleLogout = () => {
        intelLogout();
        router.replace("/intelligence/login");
    };

    return (
        <div className="flex flex-col h-screen w-full overflow-hidden bg-background">
            <header className="h-12 border-b border-border flex items-center justify-between px-6 flex-shrink-0 bg-background">
                <Link href="/intelligence" className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Brain className="h-4 w-4 text-primary" />
                    Actionable Intelligence
                </Link>
                <nav className="flex items-center gap-1">
                    {authenticated && NAV_ITEMS.filter(item => !item.adminOnly || admin).map((item) => {
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
                    <ThemeToggle />
                    {authenticated && (
                        <button
                            onClick={handleLogout}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ml-1"
                            title={`Logout (${user?.username})`}
                        >
                            <LogOut className="h-3.5 w-3.5" />
                        </button>
                    )}
                    {!authenticated && (
                        <Link
                            href="/intelligence/login"
                            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                        >
                            Sign In
                        </Link>
                    )}
                </nav>
            </header>
            <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
    );
}
