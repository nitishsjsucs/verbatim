/**
 * Tailwind v4 Safelist — Dynamic Team Color Classes
 *
 * These classes are used dynamically from the database (team colors) and would
 * otherwise be purged by Tailwind since they don't appear as literal strings
 * in component source code. This file ensures they are detected by Tailwind's
 * content scanner.
 *
 * DO NOT IMPORT THIS FILE — it only needs to exist in the source tree.
 */

export const _SAFELIST = [
  // ── bg-{color}-500/10 (card backgrounds) ──
  "bg-purple-500/10",
  "bg-cyan-500/10",
  "bg-blue-500/10",
  "bg-pink-500/10",
  "bg-indigo-500/10",
  "bg-sky-500/10",
  "bg-violet-500/10",
  "bg-fuchsia-500/10",
  "bg-rose-500/10",
  "bg-teal-500/10",
  "bg-lime-500/10",
  "bg-orange-500/10",
  "bg-amber-500/10",
  "bg-emerald-500/10",
  "bg-red-500/10",
  "bg-zinc-500/10",

  // ── text-{color}-400 (text colors) ──
  "text-purple-400",
  "text-cyan-400",
  "text-blue-400",
  "text-pink-400",
  "text-indigo-400",
  "text-sky-400",
  "text-violet-400",
  "text-fuchsia-400",
  "text-rose-400",
  "text-teal-400",
  "text-lime-400",
  "text-orange-400",
  "text-amber-400",
  "text-emerald-400",
  "text-red-400",
  "text-zinc-400",

  // ── bg-{color}-500 (headers / dots) ──
  "bg-purple-500",
  "bg-cyan-500",
  "bg-blue-500",
  "bg-pink-500",
  "bg-indigo-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-fuchsia-500",
  "bg-rose-500",
  "bg-teal-500",
  "bg-lime-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-red-500",
  "bg-zinc-500",
] as const;
