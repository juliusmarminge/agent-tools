import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("messages").order("desc").take(50);
  },
});

export const send = mutation({
  args: { content: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    console.log("Sending message:", args.content);
    await ctx.db.insert("messages", {
      content: args.content,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const messages = await ctx.db.query("messages").collect();
    for (const message of messages) {
      await ctx.db.delete(message._id);
    }
  },
});
