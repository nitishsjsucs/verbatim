import { auth } from "@/lib/auth"
import { toNextJsHandler } from "better-auth/next-js"
import { NextRequest, NextResponse } from "next/server"

const baseHandler = toNextJsHandler(auth)

export async function POST(request: NextRequest) {
  const url = new URL(request.url)
  const pathname = url.pathname
  
  // Log all auth requests
  console.log(`[AUTH] POST ${pathname}`)
  
  // For sign-in endpoints, log request body (without password for security, but we need to debug)
  if (pathname.includes('sign-in')) {
    try {
      const clonedRequest = request.clone()
      const body = await clonedRequest.json()
      console.log(`[AUTH] Request body keys:`, Object.keys(body))
      if (body.email) console.log(`[AUTH] Email: ${body.email}`)
    } catch (e) {
      console.log(`[AUTH] Could not parse body:`, e)
    }
  }
  
  try {
    const response = await baseHandler.POST(request)
    
    // Log response status
    console.log(`[AUTH] Response status: ${response.status}`)
    
    // For error responses, try to log the body
    if (!response.ok && pathname.includes('sign-in')) {
      try {
        const clonedResponse = response.clone()
        const body = await clonedResponse.json()
        console.log(`[AUTH] Error response:`, JSON.stringify(body, null, 2))
      } catch (e) {
        console.log(`[AUTH] Could not parse error response`)
      }
    }
    
    return response
  } catch (error) {
    console.error(`[AUTH] Handler error:`, error)
    throw error
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const pathname = url.pathname
  
  console.log(`[AUTH] GET ${pathname}`)
  
  try {
    const response = await baseHandler.GET(request)
    console.log(`[AUTH] GET Response status: ${response.status}`)
    return response
  } catch (error) {
    console.error(`[AUTH] GET Handler error:`, error)
    throw error
  }
}
