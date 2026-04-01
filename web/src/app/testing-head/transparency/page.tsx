"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

export default function TransparencyRedirect() {
    const router = useRouter()
    useEffect(() => { router.replace("/testing-head/tranche3") }, [router])
    return null
}
