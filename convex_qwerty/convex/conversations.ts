import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
    args: { title: v.string(), fileIds: v.array(v.string()) },
    handler: async (ctx, args) => {
        return await ctx.db.insert("qwertyConversations", { ...args });
    },
});

export const list = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("qwertyConversations").order("desc").collect();
    },
});

export const get = query({
    args: { id: v.id("qwertyConversations") },
    handler: async (ctx, args) => ctx.db.get(args.id),
});
