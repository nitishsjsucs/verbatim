"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { RoleRedirect } from "@/components/auth/role-redirect"

export default function RiskPage() {
  return (
    <RoleRedirect>
      <div className="flex h-screen bg-background">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Header */}
          <div className="h-11 border-b border-border flex items-center px-5 shrink-0 bg-background">
            <h1 className="text-sm font-semibold text-foreground">Risk</h1>
          </div>

          {/* Content */}
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-lg text-muted-foreground">🦧 working on it :) </p>
            </div>
          </div>
        </main>
      </div>
    </RoleRedirect>
  )
}
