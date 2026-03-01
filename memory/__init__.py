"""
Memory subsystem for GOVINDA V2 — Self-Evolving Architecture.

5 learning loops, each individually toggled:
  1. RAPTOR Index       — multi-resolution embedding + heat map
  2. User Memory        — per-user 3-tier memory (short/mid/long)
  3. Query Intelligence — retrieval pattern learning
  4. Retrieval Feedback — node reliability scoring (reinforce/decay)
  5. R2R Fallback       — hybrid search safety net

All loops are gated behind retrieval_mode='optimized' and individual
feature flags (e.g. enable_raptor_index). When retrieval_mode='legacy',
none of this code executes.

Entry point: memory.memory_manager.get_memory_manager()
"""
