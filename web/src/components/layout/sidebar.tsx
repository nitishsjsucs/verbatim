
"use client"

import * as React from "react"
import {
    FileText,
    UploadCloud,
    Settings,
    ChevronsLeft,
    Menu,
    Search,
    Cpu,
    Database,
    TreePine,
    BookOpen,
    History,
} from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { UploadModal } from "@/components/dashboard/upload-modal"
import { fetchConfig } from "@/lib/api"
import { AppConfig } from "@/lib/types"
import { ThemeToggle } from "@/components/ui/theme-toggle"

interface SidebarProps {
    className?: string
}

export function Sidebar({ className }: SidebarProps) {
    const [collapsed, setCollapsed] = React.useState(false)
    const [mounted, setMounted] = React.useState(false)
    const pathname = usePathname()
    const [config, setConfig] = React.useState<AppConfig | null>(null)

    React.useEffect(() => {
        setMounted(true)
        fetchConfig().then(setConfig).catch(() => {})
    }, [])

    return (
        <div className={cn("pb-12 min-h-screen border-r border-sidebar-border bg-sidebar", collapsed ? "w-[60px]" : "w-[200px]", "transition-all duration-300 ease-in-out flex-shrink-0", className)}>
            <div className="space-y-4 py-4">
                {/* Workspace Switcher / Header */}
                <div className="px-3 py-2">
                    <div className={cn("flex items-center justify-between", collapsed && "justify-center")}>
                        {!collapsed && (
                            <h2 className="px-2 text-lg font-semibold tracking-tight text-sidebar-foreground">
                                Govinda v2
                            </h2>
                        )}
                        <button
                            onClick={() => setCollapsed(!collapsed)}
                            className="p-1 hover:bg-sidebar-accent rounded-md text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
                        >
                            {collapsed ? <Menu className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
                        </button>
                    </div>
                </div>

                {/* Search */}
                {!collapsed && (
                    <div className="px-3">
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <input
                                placeholder="Search..."
                                className="w-full bg-sidebar-accent/50 text-sm text-sidebar-foreground rounded-md pl-8 pr-4 py-2 border border-transparent focus:border-sidebar-border focus:outline-none transition-colors"
                            />
                        </div>
                    </div>
                )}

                {/* Navigation */}
                <div className="px-3 py-2">
                    <div className="space-y-1">
                        <NavItem href="/" icon={<FileText className="h-4 w-4" />} label="Documents" active={pathname === "/" || pathname?.startsWith("/documents")} collapsed={collapsed} />
                        <NavItem href="/research" icon={<BookOpen className="h-4 w-4" />} label="Research" active={pathname === "/research"} collapsed={collapsed} />
                        <NavItem href="/history" icon={<History className="h-4 w-4" />} label="History" active={pathname === "/history"} collapsed={collapsed} />

                        {mounted ? (
                            <UploadModal>
                                <NavItem icon={<UploadCloud className="h-4 w-4" />} label="Ingest" collapsed={collapsed} />
                            </UploadModal>
                        ) : (
                            <NavItem icon={<UploadCloud className="h-4 w-4" />} label="Ingest" collapsed={collapsed} />
                        )}
                    </div>
                </div>

                {/* Favorites / Other sections */}
                <div className="px-3 py-2">
                    {!collapsed && <h3 className="mb-2 px-4 text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                        Favorites
                    </h3>}
                    <div className="space-y-1">
                        <NavItem icon={<div className="h-2 w-2 rounded-full bg-indigo-500" />} label="RBI Circulars" collapsed={collapsed} />
                        <NavItem icon={<div className="h-2 w-2 rounded-full bg-teal-500" />} label="Master Directions" collapsed={collapsed} />
                    </div>
                </div>

                {/* System Info */}
                {!collapsed && (
                    <div className="px-3 py-2">
                        <h3 className="mb-2 px-4 text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                            System
                        </h3>
                        <div className="px-4 space-y-2">
                            <div className="flex items-center gap-2 text-xs text-sidebar-foreground/50">
                                <TreePine className="h-3 w-3" />
                                <span>Vectorless RAG</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-sidebar-foreground/50">
                                <Cpu className="h-3 w-3" />
                                <span>LLM tree reasoning</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-sidebar-foreground/50">
                                <Database className="h-3 w-3" />
                                <span>No vector DB</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Configuration */}
                {!collapsed && config && (
                    <div className="px-3 py-2">
                        <h3 className="mb-2 px-4 text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                            Config
                        </h3>
                        <div className="px-4 space-y-1.5">
                            <ConfigItem label="Model" value={config.model} />
                            <ConfigItem label="Pro Model" value={config.model_pro} />
                            <ConfigItem label="Max Nodes" value={String(config.max_located_nodes)} />
                            <ConfigItem label="Token Budget" value={config.retrieval_token_budget.toLocaleString()} />
                        </div>
                    </div>
                )}

            </div>

            {/* Footer / User */}
            <div className="absolute bottom-4 left-0 right-0 px-3 space-y-1">
                <NavItem icon={<Settings className="h-4 w-4" />} label="Settings" collapsed={collapsed} />
                <div className={cn("flex items-center px-2", collapsed ? "justify-center" : "justify-between")}>
                    {!collapsed && <span className="text-xs text-sidebar-foreground/50">Theme</span>}
                    <ThemeToggle />
                </div>
            </div>

        </div>
    )
}

function ConfigItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between text-xs">
            <span className="text-sidebar-foreground/40">{label}</span>
            <span className="text-sidebar-foreground/70 font-mono text-[10px]">{value}</span>
        </div>
    )
}


interface NavItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    icon: React.ReactNode
    label: string
    active?: boolean
    collapsed?: boolean
    href?: string
}

const NavItem = React.forwardRef<HTMLButtonElement, NavItemProps>(
    ({ icon, label, active, collapsed, className, href, ...props }, ref) => {
        const content = (
            <>
                {icon}
                {!collapsed && <span className="ml-2 truncate">{label}</span>}
            </>
        )

        const commonClasses = cn(
            "w-full flex items-center rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
            active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
            collapsed && "justify-center px-2",
            className
        )

        if (href) {
            return (
                <Link href={href} className={commonClasses}>
                    {content}
                </Link>
            )
        }

        return (
            <button
                ref={ref}
                className={commonClasses}
                {...props}
            >
                {content}
            </button>
        )
    }
)
NavItem.displayName = "NavItem"
