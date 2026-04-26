import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

function checkAuth(req: Request): Response | null {
    const expected = process.env.QWERTY_HTTP_KEY;
    if (!expected) {
        return new Response("QWERTY_HTTP_KEY env var not configured on Convex", { status: 500 });
    }
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${expected}`) {
        return new Response("unauthorized", { status: 401 });
    }
    return null;
}

async function jsonBody<T>(req: Request): Promise<T> {
    return (await req.json()) as T;
}

export const insertFile = httpAction(async (ctx, req) => {
    const denied = checkAuth(req);
    if (denied) return denied;
    const body = await jsonBody<any>(req);
    const result: any = await ctx.runMutation((internal as any).files.insert, body);
    return Response.json(result);
});

export const setFileStatus = httpAction(async (ctx, req) => {
    const denied = checkAuth(req);
    if (denied) return denied;
    const body = await jsonBody<any>(req);
    const result: any = await ctx.runMutation((internal as any).files.setStatus, body);
    return Response.json(result);
});

export const bulkInsertChunks = httpAction(async (ctx, req) => {
    const denied = checkAuth(req);
    if (denied) return denied;
    const body = await jsonBody<any>(req);
    const result: any = await ctx.runMutation((internal as any).chunks.bulkInsert, body);
    return Response.json(result);
});

export const getChunksByIds = httpAction(async (ctx, req) => {
    const denied = checkAuth(req);
    if (denied) return denied;
    const body = await jsonBody<any>(req);
    const result: any = await ctx.runQuery((internal as any).chunks.getByIds, body);
    return Response.json(result);
});

export const appendMessage = httpAction(async (ctx, req) => {
    const denied = checkAuth(req);
    if (denied) return denied;
    const body = await jsonBody<any>(req);
    const result: any = await ctx.runMutation((internal as any).messages.append, body);
    return Response.json(result);
});
