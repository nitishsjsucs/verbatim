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
  Shield,
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
  const [_config, setConfig] = React.useState<AppConfig | null>(null)

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
      <div
        className={cn(
          "flex items-center h-11 border-b border-sidebar-border flex-shrink-0 px-3",
          collapsed ? "justify-center" : "justify-between"
        )}
      >
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-5 w-5 rounded bg-primary flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-primary-foreground leading-none">
                G
              </span>
            </div>
            <span className="text-sm font-semibold text-sidebar-foreground truncate">
              Govinda
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors flex-shrink-0"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          type="button"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* ── Navigation ── */}
      <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
        {/* Section 1: Ingest + Documents */}
        <div className="text-purple-500">
          {mounted ? (
            <UploadModal>
              <NavItem
                icon={<UploadCloud className="h-4 w-4 text-current" />}
                label="Ingest"
                collapsed={collapsed}
              />
            </UploadModal>
          ) : (
            <NavItem
              icon={<UploadCloud className="h-4 w-4 text-current" />}
              label="Ingest"
              collapsed={collapsed}
            />
          )}

          <NavItem
            href="/"
            icon={<FileText className="h-4 w-4 text-current" />}
            label="Documents"
            active={pathname === "/" || (pathname?.startsWith("/documents") ?? false)}
            collapsed={collapsed}
          />
        </div>

        <div className="my-2 border-t border-sidebar-border/50" />

        {/* Section 2: Research + History */}
        <div className="text-emerald-500">
          <NavItem
            href="/research"
            icon={<BookOpen className="h-4 w-4 text-current" />}
            label="Research"
            active={pathname === "/research"}
            collapsed={collapsed}
          />
          <NavItem
            href="/history"
            icon={<History className="h-4 w-4 text-current" />}
            label="History"
            active={pathname === "/history"}
            collapsed={collapsed}
          />
        </div>

        <div className="my-2 border-t border-sidebar-border/50" />

        {/* Section 3: Actionables */}
        <div className="text-amber-500">
          <NavItem
            href="/actionables"
            icon={<Shield className="h-4 w-4 text-current" />}
            label="Actionables"
            active={pathname === "/actionables"}
            collapsed={collapsed}
          />
        </div>

        <div className="my-2 border-t border-sidebar-border/50" />
      </div>

      {/* ── Footer ── */}
      <NavItem
        icon={<Settings className="h-4 w-4" />}
        label="Settings"
        collapsed={collapsed}
      />

      <div
        className={cn(
          "flex items-center h-8 px-2 rounded",
          collapsed ? "justify-center" : "justify-between"
        )}
      >
        {!collapsed && (
          <span className="text-[11px] text-sidebar-foreground/35 select-none">
            Theme
          </span>
        )}
        <ThemeToggle />
      </div>
    </div>
  )
}

type NavItemProps = {
  icon: React.ReactNode
  label: string
  active?: boolean
  collapsed?: boolean
} & (
  | ({ href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">)
  | ({ href?: undefined } & React.ButtonHTMLAttributes<HTMLButtonElement>)
)

const NavItem = React.forwardRef<HTMLButtonElement, NavItemProps>(
  ({ icon, label, active, collapsed, className, href, ...props }, ref) => {
    const content = (
      <>
        <span
          className={cn(
            "flex-shrink-0 transition-colors",
            active ? "text-sidebar-foreground" : "text-sidebar-foreground/50"
          )}
        >
          {icon}
        </span>
        {!collapsed && <span className="ml-2 truncate text-[13px]">{label}</span>}
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
      const anchorProps = props as Omit<
        React.AnchorHTMLAttributes<HTMLAnchorElement>,
        "href"
      >
      return (
        <Link href={href} className={commonClasses} {...anchorProps}>
          {content}
        </Link>
      )
    }

    const buttonProps = props as React.ButtonHTMLAttributes<HTMLButtonElement>
    return (
      <button ref={ref} className={commonClasses} type="button" {...buttonProps}>
        {content}
      </button>
    )
  }
)
NavItem.displayName = "NavItem"