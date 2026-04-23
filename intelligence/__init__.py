"""
Actionable Intelligence System (AIS) — parallel feature layer.

Extends the existing actionable extraction pipeline with:
  * classification (actionable vs notice board)
  * enrichment (priority, compliance risk 1-5, deadline, category, rewritten description)
  * semantic team assignment
  * functional / departmental / timeline grouping

Reuses (does NOT modify) existing services:
  * ingestion.pipeline.IngestionPipeline
  * tree.tree_store.TreeStore
  * agents.actionable_extractor.ActionableExtractor
  * utils.llm_client.LLMClient
  * utils.mongo (MongoDB singleton)

Data is stored in dedicated MongoDB collections (`intel_teams`, `intel_runs`)
so existing actionables/tracker/team-board collections are untouched.
"""
