import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const citationValidator = v.object({
    citation_id: v.string(),
    chunk_id: v.string(),
    file_id: v.string(),
    filename: v.string(),
    page_start: v.number(),
    page_end: v.number(),
    excerpt: v.string(),
    score: v.number(),
});

export const append = mutation({
    args: {
        conversationId: v.string(),
        role: v.string(),
        text: v.string(),
        citations: v.array(citationValidator),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("qwertyMessages", { ...args });
    },
});

export const byConversation = query({
    args: { conversationId: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("qwertyMessages")
            .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
            .collect();
    },
});
