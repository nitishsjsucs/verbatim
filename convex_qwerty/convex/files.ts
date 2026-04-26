import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const insert = mutation({
    args: {
        fileId: v.string(),
        filename: v.string(),
        r2Key: v.string(),
        pageCount: v.number(),
        chunkCount: v.number(),
        sizeBytes: v.number(),
        status: v.string(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("qwertyFiles")
            .withIndex("by_fileId", (q) => q.eq("fileId", args.fileId))
            .unique();
        if (existing) {
            await ctx.db.patch(existing._id, {
                filename: args.filename,
                r2Key: args.r2Key,
                pageCount: args.pageCount,
                chunkCount: args.chunkCount,
                sizeBytes: args.sizeBytes,
                status: args.status,
                error: undefined,
            });
            return { _id: existing._id, updated: true };
        }
        const _id = await ctx.db.insert("qwertyFiles", { ...args });
        return { _id, updated: false };
    },
});

export const setStatus = mutation({
    args: { fileId: v.string(), status: v.string(), error: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const row = await ctx.db
            .query("qwertyFiles")
            .withIndex("by_fileId", (q) => q.eq("fileId", args.fileId))
            .unique();
        if (!row) return { ok: false };
        await ctx.db.patch(row._id, { status: args.status, error: args.error });
        return { ok: true };
    },
});

export const list = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("qwertyFiles").order("desc").collect();
    },
});

export const get = query({
    args: { fileId: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("qwertyFiles")
            .withIndex("by_fileId", (q) => q.eq("fileId", args.fileId))
            .unique();
    },
});
