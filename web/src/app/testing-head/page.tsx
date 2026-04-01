"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { RoleRedirect } from "@/components/auth/role-redirect"
import { Loader2 } from "lucide-react"

export default function TestingHeadPage() {
    const router = useRouter()

    useEffect(() => {
        router.replace("/testing-head/transparency")
    }, [router])

    return (
        <RoleRedirect>
            <div className="flex items-center justify-center h-screen bg-background">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        </RoleRedirect>
    )
}
