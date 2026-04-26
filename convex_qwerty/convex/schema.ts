import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    qwertyFiles: defineTable({
        fileId: v.string(),
        filename: v.string(),
        r2Key: v.string(),
        pageCount: v.number(),
        chunkCount: v.number(),
        sizeBytes: v.number(),
        status: v.string(),
        error: v.optional(v.string()),
    })
        .index("by_fileId", ["fileId"])
        .index("by_status", ["status"]),

    qwertyChunks: defineTable({
        fileId: v.string(),
        chunkId: v.string(),
        seq: v.number(),
        text: v.string(),
        pageStart: v.number(),
        pageEnd: v.number(),
        tokenCount: v.number(),
    })
        .index("by_chunkId", ["chunkId"])
        .index("by_fileId_seq", ["fileId", "seq"]),

    qwertyConversations: defineTable({
        title: v.string(),
        fileIds: v.array(v.string()),
    }),

    qwertyMessages: defineTable({
        conversationId: v.string(),
        role: v.string(), // "user" | "assistant"
        text: v.string(),
        citations: v.array(
            v.object({
                citation_id: v.string(),
                chunk_id: v.string(),
                file_id: v.string(),
                filename: v.string(),
                page_start: v.number(),
                page_end: v.number(),
                excerpt: v.string(),
                score: v.number(),
            }),
        ),
    }).index("by_conversation", ["conversationId"]),
});
