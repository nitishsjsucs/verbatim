
"use client"

import * as React from "react"
import {
    FileText,
    UploadCloud,
    Settings,
    PanelLeftClose,
    PanelLeftOpen,
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
        <div
            className={cn(
                "relative flex flex-col h-screen border-r border-sidebar-border bg-sidebar flex-shrink-0 transition-all duration-200 ease-in-out",
                collapsed ? "w-[52px]" : "w-[220px]",
                className
            )}
        >
            {/* ── Workspace header ── */}
            <div className={cn(
                "flex items-center h-11 border-b border-sidebar-border flex-shrink-0 px-3",
                collapsed ? "justify-center" : "justify-between"
            )}>
                {!collapsed && (
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="h-5 w-5 rounded bg-primary flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-bold text-primary-foreground leading-none">G</span>
                        </div>
                        <span className="text-sm font-semibold text-sidebar-foreground truncate">Govinda</span>
                    </div>
                )}
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors flex-shrink-0"
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {collapsed
                        ? <PanelLeftOpen className="h-4 w-4" />
                        : <PanelLeftClose className="h-4 w-4" />
                    }
                </button>
            </div>

            {/* ── Navigation ── */}
            <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
                <NavItem
                    href="/"
                    icon={<FileText className="h-4 w-4" />}
                    label="Documents"
                    active={pathname === "/" || (pathname?.startsWith("/documents") ?? false)}
                    collapsed={collapsed}
                />
                <NavItem
                    href="/research"
                    icon={<BookOpen className="h-4 w-4" />}
                    label="Research"
                    active={pathname === "/research"}
                    collapsed={collapsed}
                />
                <NavItem
                    href="/history"
                    icon={<History className="h-4 w-4" />}
                    label="History"
                    active={pathname === "/history"}
                    collapsed={collapsed}
                />
                {mounted ? (
                    <UploadModal>
                        <NavItem
                            icon={<UploadCloud className="h-4 w-4" />}
                            label="Ingest"
                            collapsed={collapsed}
                        />
                    </UploadModal>
                ) : (
                    <NavItem
                        icon={<UploadCloud className="h-4 w-4" />}
                        label="Ingest"
                        collapsed={collapsed}
                    />
                )}

                {/* ── Config section ── */}
                {!collapsed && config && (
                    <div className="pt-4">
                        <p className="px-2 mb-1 text-[10px] font-medium uppercase tracking-widest text-sidebar-foreground/30 select-none">
                            Config
                        </p>
                        <div className="space-y-0.5">
                            <ConfigItem label="Model" value={config.model} />
                            <ConfigItem label="Pro" value={config.model_pro} />
                            <ConfigItem label="Nodes" value={String(config.max_located_nodes)} />
                        </div>
                    </div>
                )}
            </div>

            {/* ── Footer ── */}
            <div className="flex-shrink-0 border-t border-sidebar-border px-2 py-2 space-y-0.5">
                <NavItem
                    icon={<Settings className="h-4 w-4" />}
                    label="Settings"
                    collapsed={collapsed}
                />
                <div className={cn(
                    "flex items-center h-8 px-2 rounded",
                    collapsed ? "justify-center" : "justify-between"
                )}>
                    {!collapsed && (
                        <span className="text-[11px] text-sidebar-foreground/35 select-none">Theme</span>
                    )}
                    <ThemeToggle />
                </div>
            </div>
        </div>
    )
}

function ConfigItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between px-2 py-1 text-[11px]">
            <span className="text-sidebar-foreground/35">{label}</span>
            <span className="text-sidebar-foreground/60 font-mono text-[10px] truncate max-w-[100px]" title={value}>{value}</span>
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
                <span className={cn(
                    "flex-shrink-0 transition-colors",
                    active ? "text-sidebar-foreground" : "text-sidebar-foreground/50"
                )}>
                    {icon}
                </span>
                {!collapsed && (
                    <span className="ml-2 truncate text-[13px]">{label}</span>
                )}
            </>
        )

        const commonClasses = cn(
            "w-full flex items-center rounded px-2 h-8 font-medium transition-colors",
            active
                ? "bg-sidebar-accent text-sidebar-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
            collapsed && "justify-center",
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
            <button ref={ref} className={commonClasses} {...props}>
                {content}
            </button>
        )
    }
)
NavItem.displayName = "NavItem"
