import { Sidebar } from "@/components/layout/sidebar"
import { DocumentList } from "@/components/dashboard/document-list"
import { UploadModal } from "@/components/dashboard/upload-modal"

export default function Home() {
  return (
    <div className="flex bg-background h-screen w-full overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="container max-w-5xl mx-auto py-10 px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">Documents</h1>
              <p className="text-muted-foreground mt-1">Manage and query your PDF documents.</p>
            </div>
            <UploadModal />
          </div>

          <DocumentList />
        </div>
      </main>
    </div>
  )
}
