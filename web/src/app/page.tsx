"use client"

import { Sidebar } from "@/components/layout/sidebar"
import { DocumentList } from "@/components/dashboard/document-list"
import { RoleRedirect } from "@/components/auth/role-redirect"
import { Library } from "lucide-react"

export default function Home() {
  return (
    <RoleRedirect>
      <div className="flex bg-background h-screen w-full overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Header bar — matches Linear's h-11 chrome */}
          <div className="h-11 border-b border-border flex items-center justify-between px-6 flex-shrink-0 bg-background">
            <h1 className="text-xs font-semibold text-foreground flex items-center gap-2">
              <Library className="h-4 w-4 text-primary" />
              Documents Library
            </h1>
          </div>
          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="py-6 px-6">
              {/* <p className="text-xs text-muted-foreground mb-6">Manage and query your PDF documents.</p> */}
              <DocumentList />
            </div>
          </div>
        </main>
      </div>
    </RoleRedirect>
  )
}
