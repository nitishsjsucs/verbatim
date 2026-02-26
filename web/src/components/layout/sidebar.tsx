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
  LayoutDashboard,
  BarChart3,
  ClipboardList,
  LogOut,
  Send,
} from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { UploadModal } from "@/components/dashboard/upload-modal"
import { fetchConfig } from "@/lib/api"
import { AppConfig } from "@/lib/types"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { useSession, signOut } from "@/lib/auth-client"
import { getUserRole } from "@/components/auth/auth-guard"
import { SettingsDialog } from "@/components/layout/settings-dialog"

interface SidebarProps {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  const [collapsed, setCollapsed] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const pathname = usePathname()
  const [_config, setConfig] = React.useState<AppConfig | null>(null)
  const { data: session } = useSession()
  const role = getUserRole(session)
  const isOfficer = role === "compliance_officer" || role === "admin"

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
            <span className="text-sm font-semibold text-sidebar-foreground truncate">
              RegTECH_pre_pilot
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

        {/* ─── Compliance Officer: full nav ─── */}
        {isOfficer && (
          <>
            {/* Section 1: Ingest + Documents */}
            <div>
              {mounted ? (
                <UploadModal>
                  <NavItem
                    icon={<UploadCloud className="h-4 w-4" />}
                    iconClassName="text-purple-500"
                    label="Ingest"
                    collapsed={collapsed}
                  />
                </UploadModal>
              ) : (
                <NavItem
                  icon={<UploadCloud className="h-4 w-4" />}
                  iconClassName="text-purple-500"
                  label="Ingest"
                  collapsed={collapsed}
                />
              )}

              <NavItem
                href="/"
                icon={<FileText className="h-4 w-4" />}
                iconClassName="text-purple-500"
                label="Documents"
                active={pathname === "/" || (pathname?.startsWith("/documents") ?? false)}
                collapsed={collapsed}
              />
            </div>

            <div className="my-2 border-t border-sidebar-border/50" />

            {/* Section 2: Research + History */}
            <div>
              <NavItem
                href="/research"
                icon={<BookOpen className="h-4 w-4" />}
                iconClassName="text-emerald-500"
                label="Research"
                active={pathname === "/research"}
                collapsed={collapsed}
              />
              <NavItem
                href="/history"
                icon={<History className="h-4 w-4" />}
                iconClassName="text-emerald-500"
                label="History"
                active={pathname === "/history"}
                collapsed={collapsed}
              />
            </div>

            <div className="my-2 border-t border-sidebar-border/50" />

            {/* Section 3: Actionables + Dashboards */}
            <div>
              <NavItem
                href="/actionables"
                icon={<Shield className="h-4 w-4" />}
                iconClassName="text-amber-500"
                label="Actionables"
                active={pathname === "/actionables"}
                collapsed={collapsed}
              />
              <NavItem
                href="/publish"
                icon={<Send className="h-4 w-4" />}
                iconClassName="text-amber-500"
                label="Publish"
                active={pathname === "/publish"}
                collapsed={collapsed}
              />
              <div className="my-2 border-t border-sidebar-border/50" />
              <NavItem
                href="/dashboard"
                icon={<LayoutDashboard className="h-4 w-4" />}
                iconClassName="text-pink-500"
                label="Tracker"
                active={pathname === "/dashboard"}
                collapsed={collapsed}
              />
              <NavItem
                href="/reports"
                icon={<BarChart3 className="h-4 w-4" />}
                iconClassName="text-pink-500"
                label="Reports"
                active={pathname === "/reports"}
                collapsed={collapsed}
              />
              <NavItem
                href="/risk"
                icon={<Shield className="h-4 w-4" />}
                iconClassName="text-pink-500"
                label="Risk"
                active={pathname === "/risk"}
                collapsed={collapsed}
              />
            </div>

            <div className="my-2 border-t border-sidebar-border/50" />
          </>
        )}

        {/* ─── Team Member: limited nav ─── */}
        {!isOfficer && (
          <>
            <div>
              <NavItem
                href="/team-board"
                icon={<ClipboardList className="h-4 w-4" />}
                iconClassName="text-amber-500"
                label="My Tasks"
                active={pathname === "/team-board"}
                collapsed={collapsed}
              />
              <NavItem
                href="/reports"
                icon={<BarChart3 className="h-4 w-4" />}
                iconClassName="text-amber-500"
                label="Reports"
                active={pathname === "/reports"}
                collapsed={collapsed}
              />
            </div>

            <div className="my-2 border-t border-sidebar-border/50" />
          </>
        )}
      </div>

      {/* ── Footer ── */}
      {session && (
        <div className={cn("px-2 py-1", collapsed && "px-1")}>
          {!collapsed && session.user && (
            <div className="px-2 py-1.5 mb-1">
              <p className="text-[11px] font-medium text-sidebar-foreground truncate">{session.user.name || session.user.email}</p>
              <p className="text-[9px] text-sidebar-foreground/40 truncate">{role === "compliance_officer" ? "Compliance Officer" : "Team Member"}</p>
            </div>
          )}
          <NavItem
            icon={<LogOut className="h-4 w-4" />}
            iconClassName="text-sidebar-foreground/50"
            label="Sign Out"
            collapsed={collapsed}
            onClick={() => signOut().then(() => window.location.href = "/sign-in")}
          />
        </div>
      )}

      <NavItem
        icon={<Settings className="h-4 w-4" />}
        iconClassName="text-sidebar-foreground/50"
        label="Settings"
        collapsed={collapsed}
        onClick={() => setSettingsOpen(true)}
      />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

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
  iconClassName?: string
} & (
  | ({ href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">)
  | ({ href?: undefined } & React.ButtonHTMLAttributes<HTMLButtonElement>)
)

const NavItem = React.forwardRef<HTMLButtonElement, NavItemProps>(
  (
    { icon, label, active, collapsed, className, href, iconClassName, ...props },
    ref
  ) => {
    const content = (
      <>
        <span
          className={cn(
            "flex-shrink-0 transition-colors",
            iconClassName,
            active ? "opacity-100" : "opacity-80 group-hover:opacity-100"
          )}
        >
          {icon}
        </span>

        {!collapsed && (
          <span
            className={cn(
              "ml-2 truncate text-[13px] transition-colors",
              active
                ? "text-sidebar-foreground"
                : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground"
            )}
          >
            {label}
          </span>
        )}
      </>
    )

    const commonClasses = cn(
      "group w-full flex items-center rounded px-2 h-8 font-medium transition-colors relative",
      active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/70",
      collapsed && "justify-center",
      className
    )

    const tooltipEl = collapsed ? (
      <span className="absolute left-full ml-2 px-2 py-1 rounded bg-popover text-popover-foreground text-xs font-medium shadow-md border border-border whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
        {label}
      </span>
    ) : null

    if (href) {
      const anchorProps = props as Omit<
        React.AnchorHTMLAttributes<HTMLAnchorElement>,
        "href"
      >
      return (
        <Link href={href} className={commonClasses} {...anchorProps}>
          {content}
          {tooltipEl}
        </Link>
      )
    }

    const buttonProps = props as React.ButtonHTMLAttributes<HTMLButtonElement>
    return (
      <button ref={ref} className={commonClasses} type="button" {...buttonProps}>
        {content}
        {tooltipEl}
      </button>
    )
  }
)
NavItem.displayName = "NavItem"