import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const chunkValidator = v.object({
    chunkId: v.string(),
    seq: v.number(),
    text: v.string(),
    pageStart: v.number(),
    pageEnd: v.number(),
    tokenCount: v.number(),
});

export const bulkInsert = mutation({
    args: { fileId: v.string(), chunks: v.array(chunkValidator) },
    handler: async (ctx, args) => {
        // Idempotent: delete any existing chunks for this fileId first.
        const existing = await ctx.db
            .query("qwertyChunks")
            .withIndex("by_fileId_seq", (q) => q.eq("fileId", args.fileId))
            .collect();
        for (const row of existing) {
            await ctx.db.delete(row._id);
        }
        for (const c of args.chunks) {
            await ctx.db.insert("qwertyChunks", { fileId: args.fileId, ...c });
        }
        return { inserted: args.chunks.length };
    },
});

export const getByIds = query({
    args: { chunkIds: v.array(v.string()) },
    handler: async (ctx, args) => {
        const out: any[] = [];
        for (const id of args.chunkIds) {
            const row = await ctx.db
                .query("qwertyChunks")
                .withIndex("by_chunkId", (q) => q.eq("chunkId", id))
                .unique();
            if (row) out.push(row);
        }
        return { chunks: out };
    },
});

export const listByFile = query({
    args: { fileId: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("qwertyChunks")
            .withIndex("by_fileId_seq", (q) => q.eq("fileId", args.fileId))
            .collect();
    },
});
